const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

for (const envFile of ['.env', '.env.local']) {
  const envPath = path.join(__dirname, envFile);
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...rest] = trimmed.split('=');
        const v = rest.join('=').replace(/^["']|["']$/g, '');
        if (!process.env[k]) {
          process.env[k] = v;
        }
      }
    }
  }
}

const apiKey = process.env.api_key || process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI(apiKey ? { apiKey } : {});

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
