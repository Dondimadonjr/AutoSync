const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generarPropuestaPublicacion(nombreProducto, descripcionCorta, redSocial = 'Instagram/TikTok', retries = 3) {
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

  // Modelo activo estándar de Gemini en la SDK @google/genai
  const modelName = 'gemini-2.5-flash';

  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const parsed = JSON.parse(response.text);

      // Normalizar hashtags para garantizar que sea un array
      if (typeof parsed.hashtags === 'string') {
        parsed.hashtags = parsed.hashtags.split(' ').filter(Boolean);
      } else if (!Array.isArray(parsed.hashtags)) {
        parsed.hashtags = [];
      }

      return parsed;
    } catch (error) {
      console.warn(`Intento ${i + 1} fallido con ${modelName}: ${error.message}`);
      if (i < retries - 1) {
        await new Promise((res) => setTimeout(res, 2000));
      } else {
        throw new Error(`Error en el motor de IA: ${error.message}`);
      }
    }
  }
}

module.exports = { generarPropuestaPublicacion };
