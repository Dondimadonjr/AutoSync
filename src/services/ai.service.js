require('dns').setDefaultResultOrder('ipv4first');
const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const logger = require('../config/logger');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Modelos válidos en la SDK @google/genai para reintentos
const MODELOS_DISPONIBLES = [
  'gemini-3.6-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

/**
 * Función auxiliar para pausar la ejecución en ms
 */
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

  // Recorrer los modelos de respaldo
  for (const modelo of MODELOS_DISPONIBLES) {
    // Intentar hasta 2 veces por cada modelo
    for (let intento = 1; intento <= 2; intento++) {
      try {
        logger.info(`Intento ${intento} con modelo ${modelo}`);

        const response = await ai.models.generateContent({
          model: modelo,
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

        logger.info('Propuesta generada exitosamente con ' + modelo, { producto });
        return parsed;

      } catch (error) {
        ultimoError = error;
        logger.warn(`Error temporal en ${modelo} (Intento ${intento}): ${error.message}`);
        
        // Esperar 1.5 segundos antes de reintentar si el servidor está saturado
        if (intento < 2) await esperar(1500);
      }
    }
  }

  logger.error('Todos los modelos y reintentos fallaron:', { error: ultimoError?.message });
  throw new Error(`Los servidores de IA están saturados temporalmente. Por favor, reintenta en un momento.`);
}

module.exports = { generarPropuestaPublicacion };