import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_STUDIO_API_KEY);

const models = [
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash',
    'gemini-3.1-flash-live-preview'
];

async function testModels() {
    for (const modelName of models) {
        console.log(`Testing model: ${modelName}`);
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hola, esto es una prueba rápida.");
            console.log(`  SUCCESS: ${result.response.text().substring(0, 30)}...`);
        } catch (error) {
            console.error(`  FAILURE: ${error.message}`);
        }
    }
}

testModels();
