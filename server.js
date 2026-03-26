// server.js
import express from 'express';
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'path';

const app = express();
app.use(express.json());
app.use(express.static('.'));

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;
const INDEX_NAME = process.env.PINECONE_INDEX || 'manuals-reader';

const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

app.post('/api/query', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).send({ error: 'Query required' });

    try {
        // 1. Generate Query Embedding
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const result = await model.embedContent(query);
        const embedding = result.embedding.values;

        // 2. Query Pinecone
        const index = pc.index(INDEX_NAME);
        const queryResponse = await index.namespace('manuals').query({
            topK: 1,
            vector: embedding,
            includeMetadata: true,
        });

        if (queryResponse.matches.length === 0) {
            return res.send({
                answer: "No encontré información específica en los manuales procesados.",
                capture: null
            });
        }

        const match = queryResponse.matches[0];
        const { text, capturePath } = match.metadata;

        // 3. Generate Answer based on context
        const responseModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const chatResult = await responseModel.generateContent([
            `Eres un experto en manuales técnicos. Responde a la pregunta basada únicamente en el contexto proporcionado.
            IMPORTANTE: Si el contexto está en inglés, interprétalo para responder con total precisión en ESPAÑOL. No respondas en inglés bajo ninguna circunstancia.
            Contexto del manual: ${text}
            Pregunta del usuario: ${query}`
        ]);

        res.send({
            answer: chatResult.response.text(),
            capture: capturePath // e.g., 'public/captures/manual_p5.png'
        });

    } catch (error) {
        console.error(error);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
