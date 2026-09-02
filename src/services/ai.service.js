const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const logger = require('../config/logger');
const { GeminiPostProposalSchema } = require('../schemas/gemini.schema');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Lista ordenada de modelos para fallback en caso de 503 / cuota agotada
const MODELS_FALLBACK = ['gemini-2.5-flash', 'gemini-1.5-flash'];

/**
 * Genera propuesta creativa de publicación con Gemini, reintentos y validación Zod
 * @param {string} nombreProducto
 * @param {string} descripcionCorta
 * @param {string} redSocial
 * @returns {Promise<{caption: string, hashtags: string[], sugerencia_visual: string}>}
 */
async function generarPropuestaPublicacion(nombreProducto, descripcionCorta, redSocial = 'Instagram Reels / TikTok') {
  const systemInstruction = `
Eres un Director Creativo Senior de Marketing Digital experto en Viralidad y Conversión en redes sociales.
Tu objetivo es redactar un guion breve y copy de alto impacto para un video de 5 a 10 segundos.
Debes responder ÚNICAMENTE en formato JSON válido que cumpla con el siguiente esquema:
{
  "caption": "Copy persuasivo con gancho en primera línea, cuerpo, llamada a la acción (CTA) clara y emojis adecuados",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "sugerencia_visual": "Descripción cinematográfica y dinámica de qué debe verse en el video"
}
`;

  const prompt = `
Producto/Servicio: ${nombreProducto}
Detalles clave: ${descripcionCorta}
Plataforma objetivo: ${redSocial}
`;

  let lastError = null;

  for (const model of MODELS_FALLBACK) {
    let delayMs = 1500;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info(`Solicitando generación a Gemini`, { model, attempt, producto: nombreProducto });

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        });

        const rawText = response.text;
        if (!rawText) {
          throw new Error('Respuesta vacía recibida del modelo de IA');
        }

        const parsedJson = JSON.parse(rawText);

        // Validación estricta en runtime con Zod
        const validatedProposal = GeminiPostProposalSchema.parse(parsedJson);

        logger.info('Propuesta generada y validada exitosamente con Gemini', {
          model,
          hashtagsCount: validatedProposal.hashtags.length,
        });

        return validatedProposal;
      } catch (err) {
        lastError = err;
        logger.warn(`Error en llamada a Gemini [${model}, intento ${attempt}]`, {
          error: err.message,
        });

        // Esperar antes del siguiente intento si no es el último
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2; // Backoff exponencial
        }
      }
    }
  }

  logger.error('Todos los modelos y reintentos de Gemini fallaron', { error: lastError?.message });
  throw new Error(`Error en el motor de IA tras agotar fallbacks: ${lastError?.message}`);
}

module.exports = {
  generarPropuestaPublicacion,
};
