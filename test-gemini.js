require('dotenv').config();

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
    console.error('status:', error?.status);
    console.error('code:', error?.code);
    console.error('message:', error?.message);
  }
}

test();