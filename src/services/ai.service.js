const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generarPropuestaPublicacion(nombreProducto, descripcionCorta, redSocial = 'Instagram/TikTok') {
  const prompt = `
Eres un experto en Marketing Digital para redes sociales.
Genera un post optimizado para un video corto (5 segundos) sobre el siguiente producto:
Producto: ${nombreProducto}
Detalles: ${descripcionCorta}
Plataforma objetivo: ${redSocial}

Responde ÚNICAMENTE en formato JSON estricto con la siguiente estructura:
{
  "caption": "Texto llamativo con llamadas a la acción (CTA) e emojis",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "sugerencia_visual": "Idea rápida de qué debe mostrar el video de 5 segundos"
}
`;

  const timeoutMs = 15000;
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`La API de Gemini excedió el tiempo límite (${timeoutMs / 1000}s).`);
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
  });

  try {
    const apiCallPromise = ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const response = await Promise.race([apiCallPromise, timeoutPromise]);
    clearTimeout(timeoutId);

    const text = response.text;
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;

    // Normalizar hashtags
    if (typeof parsed.hashtags === 'string') {
      parsed.hashtags = parsed.hashtags.split(' ').filter(Boolean);
    } else if (!Array.isArray(parsed.hashtags)) {
      parsed.hashtags = [];
    }

    return parsed;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Error en Gemini:', error.message || error);
    throw new Error(`Error en el motor de IA: ${error.message || error}`);
  }
}

module.exports = { generarPropuestaPublicacion };