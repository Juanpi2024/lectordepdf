import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración API
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Endpoint para consultas RAG
app.post('/api/query', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    try {
        // 1. Generar Vector de Consulta con OpenAI (768 dims)
        const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: query,
            dimensions: 768
        });
        const embedding = embeddingResponse.data[0].embedding;

        // 2. Buscar en Pinecone
        const index = pc.index(PINECONE_INDEX);
        const queryResponse = await index.namespace('manuals').query({
            vector: embedding,
            topK: 1,
            includeMetadata: true
        });

        if (queryResponse.matches.length === 0) {
            return res.json({ 
                answer: "Lo siento, no encontré información específica en los manuales para esa consulta.",
                capturePath: null 
            });
        }

        const match = queryResponse.matches[0];
        const { text, capturePath } = match.metadata;

        // 3. Generar Respuesta con GPT-4o-mini
        const chatResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Eres un experto en manuales técnicos. Responde a la pregunta basada únicamente en el contexto proporcionado.
                    IMPORTANTE: Responde siempre en ESPAÑOL de forma clara y precisa. Si el contexto original está en inglés, tradúcelo fielmente.`
                },
                {
                    role: "user",
                    content: `Contexto: ${text}\n\nPregunta: ${query}`
                }
            ]
        });

        const answer = chatResponse.choices[0].message.content;

        res.json({ answer, capturePath });

    } catch (error) {
        console.error('Error en /api/query:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Servidor iniciado en http://localhost:${port}`);
});
