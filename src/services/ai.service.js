require('dns').setDefaultResultOrder('ipv4first');
const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const logger = require('../config/logger');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const MODELO_OFICIAL = 'gemini-3.6-flash';
const MAX_INTENTOS = 3;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generarPropuestaPublicacion(input, descripcionCorta, redSocial = 'Instagram/TikTok') {
  let producto = input;
  let descripcion = descripcionCorta;

  if (typeof input === 'object' && input !== null) {
    producto = input.producto || input.nombreProducto || 'Producto';
    descripcion = input.descripcion || input.descripcionCorta || '';
  }

  const promptText = `
Eres un experto en Marketing Digital para redes sociales.
Genera un post optimizado para la siguiente publicación:
Producto/Tipo: ${producto}
Detalles: ${descripcion}
Plataforma: ${redSocial}

Responde ÚNICAMENTE en formato JSON estricto sin bloques de texto adicional:
{
  "caption": "Texto llamativo con llamadas a la acción (CTA) e emojis",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "sugerencia_visual": "Idea rápida de qué debe mostrar la imagen o video"
}
`;

  let ultimoError = null;

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      logger.info(`Intento ${intento} con modelo ${MODELO_OFICIAL}`);

      const response = await ai.models.generateContent({
        model: MODELO_OFICIAL,
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        config: {
          responseMimeType: 'application/json',
        },
      });

      let rawText = response.text || '';
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

      const parsed = JSON.parse(rawText);

      if (typeof parsed.hashtags === 'string') {
        parsed.hashtags = parsed.hashtags.split(/\s+/).filter(Boolean);
      } else if (!Array.isArray(parsed.hashtags)) {
        parsed.hashtags = [];
      }

      logger.info(`Propuesta generada exitosamente con ${MODELO_OFICIAL}`, { producto });
      return parsed;

    } catch (error) {
      ultimoError = error;
      logger.warn(`Error temporal en ${MODELO_OFICIAL} (Intento ${intento}/${MAX_INTENTOS}): ${error.message}`);

      // Si es un error 503 (Servidor saturado), esperamos tiempo progresivo (2s, 4s) antes de reintentar
      if (intento < MAX_INTENTOS) {
        const tiempoEspera = intento * 2000;
        logger.info(`Pausando ${tiempoEspera}ms antes del siguiente intento...`);
        await esperar(tiempoEspera);
      }
    }
  }

  logger.error(`Todos los reintentos fallaron con ${MODELO_OFICIAL}:`, { error: ultimoError?.message });
  throw new Error(`Los servidores de IA están saturados temporalmente (503). Por favor, intenta de nuevo en un par de minutos.`);
}

module.exports = { generarPropuestaPublicacion };