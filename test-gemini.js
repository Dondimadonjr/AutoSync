require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');

const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function test() {
  console.time('Gemini');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: 'Responde solamente: OK',
      config: {
        responseMimeType: 'text/plain',
      },
    });

    console.timeEnd('Gemini');
    console.log('Respuesta:', response.text);
  } catch (error) {
    console.timeEnd('Gemini');
    console.error('ERROR GEMINI');
    console.error('message:', error?.message);
    console.error('cause:', error?.cause);       // <-- esto es lo que faltaba
    console.error('cause.code:', error?.cause?.code);
    console.error('cause.errno:', error?.cause?.errno);
    console.error('stack:', error?.stack);
  }
}

test();