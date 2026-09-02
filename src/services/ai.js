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

  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      return JSON.parse(response.text);
    } catch (error) {
      console.warn(`Intento ${i + 1} fallido por error en Gemini: ${error.message}`);
      // Si el error es 503 (alta demanda) y quedan reintentos, esperamos 2 segundos y reintentamos
      if (i < retries - 1 && (error.status === 503 || error.message?.includes('503'))) {
        console.log(`⏳ Esperando 2 segundos antes de reintentar (intento ${i + 2}/${retries})...`);
        await new Promise(res => setTimeout(res, 2000));
      } else {
        throw error;
      }
    }
  }
}

module.exports = { generarPropuestaPublicacion };