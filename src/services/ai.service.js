const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = 'gemini-3.6-flash';
const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esErrorTemporal(error) {
  const status = Number(error?.status || error?.statusCode || error?.code);
  return [429, 500, 502, 503, 504].includes(status);
}

function obtenerEspera(intento) {
  const base = 2000 * Math.pow(2, intento);
  // Pequeña variación (jitter) para evitar estampidas concurrentes
  const jitter = Math.floor(Math.random() * 1000);
  return base + jitter;
}

async function generarPropuestaPublicacion(
  nombreProducto,
  descripcionCorta,
  redSocial = 'Instagram/TikTok'
) {
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

  for (let intento = 0; intento < MAX_ATTEMPTS; intento++) {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error(
          `La API de Gemini tardó más de ${TIMEOUT_MS / 1000} segundos en responder.`
        );
        error.name = 'TimeoutError';
        error.statusCode = 504;
        error.code = 'GATEWAY_TIMEOUT';
        reject(error);
      }, TIMEOUT_MS);
    });

    try {
      console.log(`🤖 Gemini - intento ${intento + 1}/${MAX_ATTEMPTS}`);

      const apiCallPromise = ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const response = await Promise.race([
        apiCallPromise,
        timeoutPromise,
      ]);

      clearTimeout(timeoutId);

      if (!response?.text) {
        throw new Error('Gemini devolvió una respuesta vacía.');
      }

      let parsed;
      try {
        parsed = JSON.parse(response.text);
      } catch (_jsonError) {
        const error = new Error(
          'Gemini devolvió una respuesta que no tiene formato JSON válido.'
        );
        error.statusCode = 502;
        error.code = 'BAD_GATEWAY';
        throw error;
      }

      // Normalizar hashtags
      if (typeof parsed.hashtags === 'string') {
        parsed.hashtags = parsed.hashtags
          .split(/\s+/)
          .filter(Boolean);
      }

      if (!Array.isArray(parsed.hashtags)) {
        parsed.hashtags = [];
      }

      return parsed;

    } catch (error) {
      clearTimeout(timeoutId);

      const status = Number(
        error?.status ||
        error?.statusCode ||
        error?.code
      );

      console.error(`❌ Gemini intento ${intento + 1}/${MAX_ATTEMPTS}`, {
        status,
        name: error?.name,
        message: error?.message,
      });

      /*
       * TIMEOUT: No hacemos retry para no acumular latencia excesiva
       */
      if (error.name === 'TimeoutError' || error.statusCode === 504) {
        throw error;
      }

      /*
       * ERRORES TEMPORALES (503 alta demanda, 429 rate limit, 500/502)
       */
      if (esErrorTemporal(error) && intento < MAX_ATTEMPTS - 1) {
        const espera = obtenerEspera(intento);
        console.warn(
          `⏳ Gemini temporalmente no disponible (${status}). Reintentando en ${espera}ms...`
        );
        await esperar(espera);
        continue;
      }

      /*
       * Error definitivo o último intento fallido
       */
      const nuevoError = new Error(
        `Error en el motor de IA: ${error?.message || error}`
      );
      nuevoError.statusCode = status || 500;
      nuevoError.code = error.code || (status === 503 ? 'SERVICE_UNAVAILABLE' : undefined);
      throw nuevoError;
    }
  }

  const error = new Error(
    'Gemini no pudo generar la propuesta después de varios intentos.'
  );
  error.statusCode = 503;
  error.code = 'SERVICE_UNAVAILABLE';
  throw error;
}

module.exports = {
  generarPropuestaPublicacion,
};