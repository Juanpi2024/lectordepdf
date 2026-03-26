import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { PDFDocument } from 'pdf-lib';
import pdfParse from 'pdf-parse';
import crypto from 'crypto';
import 'dotenv/config';

// Configuración
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INDEX_NAME = 'manuals-reader';
const JOURNAL_FILE = 'ingestion_journal_openai.json';

const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callWithRetry(fn, label, retries = 5, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            console.error(`  ! Error in ${label}: ${error.message}`);
            if (error.status === 429 && i < retries - 1) {
                console.log(`  ! Quota/Rate limit hit. Waiting ${delay/1000}s...`);
                await sleep(delay);
                continue;
            }
            throw error;
        }
    }
}

async function loadJournal() {
    if (existsSync(JOURNAL_FILE)) {
        const data = await fs.readFile(JOURNAL_FILE, 'utf8');
        const journal = JSON.parse(data);
        if (!journal.processedHashes) journal.processedHashes = {};
        return journal;
    }
    return { processedFiles: {}, processedHashes: {} };
}

async function saveJournal(journal) {
    await fs.writeFile(JOURNAL_FILE, JSON.stringify(journal, null, 2));
}

function getHash(text) {
    // Normalizamos texto (letras minúsculas, sin espacios extras) para mejor detección de duplicados
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    return crypto.createHash('md5').update(normalized).digest('hex');
}

async function ingest() {
    console.log('--- Iniciando Ingesta Inteligente (OpenAI + Deduplicación) ---');
    
    const journal = await loadJournal();
    const docsDir = path.resolve('docs');
    const capturesDir = path.resolve('public/captures');
    if (!existsSync(capturesDir)) await fs.mkdir(capturesDir, { recursive: true });

    const files = await fs.readdir(docsDir);
    let pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    // Priorizar Merida según pedido
    const prioritizedFile = 'merida-instruction-manual-mtb-2015.pdf';
    if (pdfs.includes(prioritizedFile)) {
        pdfs = [prioritizedFile]; 
    }

    if (pdfs.length === 0) {
        console.log('No se encontraron PDFs válidos.');
        return;
    }

    const index = pc.index(INDEX_NAME);
    const file = pdfs[0];

    console.log(`\nProcesando archivo: ${file}`);
    
    if (!journal.processedFiles[file]) {
        journal.processedFiles[file] = { completedPages: [] };
    }

    const pdfPath = path.join(docsDir, file);
    const dataBuffer = await fs.readFile(pdfPath);
    const srcDoc = await PDFDocument.load(dataBuffer);
    const pageCount = srcDoc.getPageCount();

    for (let i = 0; i < pageCount; i++) {
        const pageNum = i + 1;
        
        if (journal.processedFiles[file].completedPages.includes(pageNum)) {
            console.log(`- Página ${pageNum}/${pageCount} ya marcada como completada.`);
            continue;
        }

        console.log(`- Procesando página ${pageNum}/${pageCount}...`);

        try {
            // 1. Extraer texto original
            const newDoc = await PDFDocument.create();
            const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
            newDoc.addPage(copiedPage);
            const pdfBytes = await newDoc.save();
            const pageData = await pdfParse(Buffer.from(pdfBytes));
            const pageText = pageData.text;

            if (!pageText.trim()) {
                journal.processedFiles[file].completedPages.push(pageNum);
                await saveJournal(journal);
                continue;
            }

            // 2. Analizar/Traducir con GPT-4o-mini
            // En el prompt pedimos brevedad si es algo que parece repetido (aunque el hash es mejor después de analizar)
            const completion = await callWithRetry(async () => {
                return await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: "Traduce este texto técnico al ESPAÑOL. Sé preciso. Si el texto es una repetición exacta de instrucciones ya comunes, mantén el formato estándar." },
                        { role: "user", content: pageText }
                    ]
                });
            }, `OpenAI Analysis p${pageNum}`);

            const refinedText = completion.choices[0].message.content;
            const textHash = getHash(refinedText);

            // 3. Verificar deduplicación (inteligencia para ahorrar tokens de Pinecone y evitar ruido)
            if (journal.processedHashes[textHash]) {
                console.log(`  ! Información duplicada detectada (Hash: ${textHash}). Saltando vectorización.`);
                journal.processedFiles[file].completedPages.push(pageNum);
                await saveJournal(journal);
                continue;
            }

            // 4. Vectorizar (Solo si es información nueva/única)
            const embeddingRes = await callWithRetry(async () => {
                return await openai.embeddings.create({
                    model: "text-embedding-3-small",
                    input: refinedText,
                    dimensions: 768
                });
            }, `OpenAI Embedding p${pageNum}`);

            const embedding = embeddingRes.data[0].embedding;

            // 5. Upsert a Pinecone
            const captureName = `${path.parse(file).name}_p${pageNum}.pdf`;
            const capturePath = path.join(capturesDir, captureName);
            await fs.writeFile(capturePath, pdfBytes);

            await index.namespace('manuals').upsert([{
                id: `${file}-p${pageNum}`,
                values: embedding,
                metadata: {
                    fileName: file,
                    page: pageNum,
                    text: refinedText,
                    capturePath: `public/captures/${captureName}`
                }
            }]);

            journal.processedFiles[file].completedPages.push(pageNum);
            journal.processedHashes[textHash] = true;
            await saveJournal(journal);
            
            console.log(`  + Página ${pageNum} agregada al índice.`);
            await sleep(100);

        } catch (err) {
            console.error(`  X Error fatal en página ${pageNum}:`, err.message);
            await saveJournal(journal);
            throw err;
        }
    }

    console.log('\n--- Ingesta Inteligente completada ---');
}

ingest().catch(err => {
    console.error('\nError global:', err);
});
