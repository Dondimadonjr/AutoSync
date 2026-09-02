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
      const is503 = error.message?.includes('503') || error.status === 503;

      // Si es un error 503 por alta demanda y aún quedan reintentos, esperamos 2.5 segundos
      if (is503 && i < retries - 1) {
        console.warn(`Intento ${i + 1} fallido por saturación de Gemini (503). Reintentando en 2.5s...`);
        await new Promise(res => setTimeout(res, 2500));
      } else {
        console.error('Error definitivo en Gemini:', error.message || error);
        throw new Error(`Error en el motor de IA: ${error.message || error}`);
      }
    }
  }
}

module.exports = { generarPropuestaPublicacion };