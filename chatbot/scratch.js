const { GoogleGenAI } = require('@google/genai');
require('dotenv').config({ path: '.env.local' });

const ai = new GoogleGenAI({});

const models = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it'
];

async function test() {
  for (const model of models) {
    try {
      console.log(`Testing ${model}...`);
      const interaction = await ai.interactions.create({
        model: model,
        input: 'Hello'
      });
      console.log(`✅ ${model} worked.`);
    } catch (error) {
      console.error(`❌ ${model} failed:`, error.message);
    }
  }
}

test();
