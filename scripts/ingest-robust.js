import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { PDFDocument } from 'pdf-lib';
import pdfParse from 'pdf-parse';
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
        return JSON.parse(data);
    }
    return { processedFiles: {} };
}

async function saveJournal(journal) {
    await fs.writeFile(JOURNAL_FILE, JSON.stringify(journal, null, 2));
}

async function ingest() {
    console.log('--- Iniciando Ingesta con OpenAI (Alta Velocidad) ---');
    
    const journal = await loadJournal();
    const docsDir = path.resolve('docs');
    const capturesDir = path.resolve('public/captures');
    if (!existsSync(capturesDir)) await fs.mkdir(capturesDir, { recursive: true });

    const files = await fs.readdir(docsDir);
    const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    if (pdfs.length === 0) {
        console.log('No se encontraron PDFs en la carpeta /docs.');
        return;
    }

    const index = pc.index(INDEX_NAME);

    for (const file of pdfs) {
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
                console.log(`- Página ${pageNum}/${pageCount} ya procesada.`);
                continue;
            }

            console.log(`- Procesando página ${pageNum}/${pageCount}...`);

            try {
                // 1. Extraer página
                const newDoc = await PDFDocument.create();
                const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
                newDoc.addPage(copiedPage);
                const pdfBytes = await newDoc.save();
                
                const captureName = `${path.parse(file).name}_p${pageNum}.pdf`;
                const capturePath = path.join(capturesDir, captureName);
                await fs.writeFile(capturePath, pdfBytes);

                const pageData = await pdfParse(Buffer.from(pdfBytes));
                const pageText = pageData.text;

                if (!pageText.trim()) {
                    journal.processedFiles[file].completedPages.push(pageNum);
                    await saveJournal(journal);
                    continue;
                }

                // 2. Analizar/Traducir con GPT-4o-mini
                const completion = await callWithRetry(async () => {
                    return await openai.chat.completions.create({
                        model: "gpt-4o-mini",
                        messages: [
                            { role: "system", content: "Analiza este texto de un manual técnico. Si está en inglés, tradúcelo al español de forma técnica. Mantén especificaciones y datos exactos." },
                            { role: "user", content: pageText }
                        ]
                    });
                }, `OpenAI Analysis p${pageNum}`);

                const refinedText = completion.choices[0].message.content;

                // 3. Vectorizar con OpenAI (768 dimensiones)
                const embeddingRes = await callWithRetry(async () => {
                    return await openai.embeddings.create({
                        model: "text-embedding-3-small",
                        input: refinedText,
                        dimensions: 768
                    });
                }, `OpenAI Embedding p${pageNum}`);

                const embedding = embeddingRes.data[0].embedding;

                // 4. Upsert a Pinecone
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
                await saveJournal(journal);
                
                // Delay mínimo (OpenAI pagado aguanta mucho más)
                await sleep(100);

            } catch (err) {
                console.error(`  X Error fatal en página ${pageNum}:`, err.message);
                await saveJournal(journal);
                throw err;
            }
        }
    }

    console.log('\n--- Ingesta con OpenAI completada ---');
}

ingest().catch(err => {
    console.error('\nError global:', err);
});
