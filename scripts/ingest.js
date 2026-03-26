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

async function ingest() {
    console.log('--- Iniciando Ingesta (Modo Compatible) ---');
    
    const docsDir = path.resolve('docs');
    const capturesDir = path.resolve('public/captures'); // Usaremos PDFs de una página como captura
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
        
        // 1. Extraer texto completo para procesar por páginas
        // Nota: pdf-parse agrupa todo, pero podemos intentar separar por \f o similar si el PDF lo permite.
        // Pero para ser precisos, usaremos pdf-lib para separar y procesar página a página.
        const srcDoc = await PDFDocument.load(dataBuffer);
        const pageCount = srcDoc.getPageCount();

        for (let i = 0; i < pageCount; i++) {
            const pageNum = i + 1;
            console.log(`- Procesando página ${pageNum}/${pageCount}...`);

            // 2. Crear un min-PDF de una sola página como "Captura"
            const newDoc = await PDFDocument.create();
            const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
            newDoc.addPage(copiedPage);
            const pdfBytes = await newDoc.save();
            
            const captureName = `${path.parse(file).name}_p${pageNum}.pdf`;
            const capturePath = path.join(capturesDir, captureName);
            await fs.writeFile(capturePath, pdfBytes);

            // 3. Extraer texto de esta página específica
            // (Usamos pdf-parse en el buffer de la página individual)
            const pageData = await pdfParse(Buffer.from(pdfBytes));
            const pageText = pageData.text;

            if (!pageText.trim()) {
                console.log(`  ! Página ${pageNum} parece estar vacía o es solo imagen.`);
                continue;
            }

            // 4. Analizar con Gemini (Traducción si es necesario)
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const prompt = `Analiza este texto de un manual técnico. Si está en inglés,tradúcelo al español de forma técnica. 
            Asegúrate de capturar todas las instrucciones y especificaciones.
            Texto original: ${pageText}`;
            
            const result = await model.generateContent(prompt);
            const refinedText = result.response.text();

            // 5. Generar Vector
            const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
            const embeddingResult = await embedModel.embedContent(refinedText);
            const embedding = embeddingResult.embedding.values;

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
        }
    }

    console.log('--- Ingesta completada con éxito ---');
}

ingest().catch(err => {
    console.error('Error durante la ingesta:', err);
});
