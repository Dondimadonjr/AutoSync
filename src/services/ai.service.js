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

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text;
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;

    // Normalizar hashtags para garantizar que sea un array
    if (typeof parsed.hashtags === 'string') {
      parsed.hashtags = parsed.hashtags.split(/\s+/).filter(Boolean);
    } else if (!Array.isArray(parsed.hashtags)) {
      parsed.hashtags = [];
    }

    return parsed;
  } catch (error) {
    console.error('Error directo en Gemini:', error.message || error);
    throw new Error(`Error en el motor de IA: ${error.message || error}`);
  }
}

module.exports = { generarPropuestaPublicacion };