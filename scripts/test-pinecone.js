import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const pc = new Pinecone({ apiKey: PINECONE_API_KEY });

async function testPinecone() {
    try {
        const indexes = await pc.listIndexes();
        console.log('Pinecone Indexes:', JSON.stringify(indexes, null, 2));
    } catch (error) {
        console.error('Error testing Pinecone:', error);
    }
}

testPinecone();
