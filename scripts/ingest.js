// scripts/ingest.js
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pdfParse from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;
const INDEX_NAME = process.env.PINECONE_INDEX || 'manuals-reader';

const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callWithRetry(fn, retries = 5, delay = 10000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (error.status === 429 && i < retries - 1) {
                console.log(`  ! Rate limited. Retrying in ${delay/1000}s...`);
                await sleep(delay);
                delay *= 2; // Exponential backoff
                continue;
            }
            throw error;
        }
    }
}

async function ingest() {
    console.log('--- Iniciando Ingesta (Modo Compatible) ---');
    
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
        console.log(`Procesando archivo: ${file}`);
        const pdfPath = path.join(docsDir, file);
        const dataBuffer = await fs.readFile(pdfPath);
        
        const srcDoc = await PDFDocument.load(dataBuffer);
        const pageCount = srcDoc.getPageCount();

        for (let i = 0; i < pageCount; i++) {
            const pageNum = i + 1;
            console.log(`- Procesando página ${pageNum}/${pageCount}...`);

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
                console.log(`  ! Página ${pageNum} parece estar vacía o es solo imagen.`);
                continue;
            }

            // 4. Analizar con Gemini (Traducción si es necesario)
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const prompt = `Analiza este texto de un manual técnico. Si está en inglés,tradúcelo al español de forma técnica. 
            Asegúrate de capturar todas las instrucciones y especificaciones.
            Texto original: ${pageText}`;
            
            const refinedText = await callWithRetry(async () => {
                const result = await model.generateContent(prompt);
                return result.response.text();
            });

            // 5. Generar Vector
            const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
            const embedding = await callWithRetry(async () => {
                const embeddingResult = await embedModel.embedContent(refinedText);
                return embeddingResult.embedding.values;
            });

            // 6. Upsert a Pinecone
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
            
            // Artificial delay to avoid 429
            await sleep(1000);
        }
    }

    console.log('--- Ingesta completada con éxito ---');
}

ingest().catch(err => {
    console.error('Error durante la ingesta:', err);
});
