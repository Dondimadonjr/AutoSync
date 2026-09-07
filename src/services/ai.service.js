require('dns').setDefaultResultOrder('ipv4first');
const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const logger = require('../config/logger');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Nombres oficiales soportados por el SDK @google/genai en v1beta
const MODELOS_DISPONIBLES = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

const MAX_INTENTOS_POR_MODELO = 2;
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Genera una propuesta de copy, hashtags y sugerencia visual mediante Gemini API
 */
async function generarPropuestaPublicacion(input, descripcionCorta, redSocial = 'Instagram/TikTok') {
  let producto = input;
  let descripcion = descripcionCorta;

  if (typeof input === 'object' && input !== null) {
    producto = input.producto || input.nombreProducto || 'Producto';
    descripcion = input.descripcion || input.descripcionCorta || '';
  }

  const promptText = `
    Eres un experto en Marketing Digital y Copywriting para redes sociales especializado en e-commerce y productos del hogar/jardín.

    TU TAREA:
    Genera un post altamente atractivo, persuasivo y optimizado para ${redSocial}.

    CONTEXTO Y REGLAS DE CONTENIDO:
    - Producto/Tipo: ${producto}
    - Detalles del producto/imagen: ${descripcion}
    - REGLA DE ADAPTACIÓN CONTEXTUAL: Analiza cuidadosamente la descripción. NO asumas ubicaciones ni usos (por ejemplo, NO digas "para interiores" o "ideal para departamento/escritorio" si el producto es grande, rústico o está pensado para terrazas/jardines/exteriores). Acompáñate estricta y únicamente del contexto de uso inferido por el tamaño, material y detalles entregados.
    - Tono: Profesional, cercano, inspirador y adaptado al público objetivo del producto.

    INSTRUCCIONES DE FORMATO:
    Responde ÚNICAMENTE en formato JSON estricto sin bloques de texto adicional, texto introductorio ni formato Markdown fuera del objeto JSON:
    {
      "caption": "Texto llamativo con ganchos persuasivos, descripción adaptada al contexto real del producto, llamadas a la acción (CTA) efectivas y emojis acordes.",
      "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
      "sugerencia_visual": "Idea rápida de qué composición visual o encuadre potenciaría este post"
    }
  `;

  let ultimoError = null;

  for (const nombreModelo of MODELOS_DISPONIBLES) {
    for (let intento = 1; intento <= MAX_INTENTOS_POR_MODELO; intento++) {
      try {
        logger.info(`Intento ${intento} con modelo ${nombreModelo}`);

        const response = await ai.models.generateContent({
          model: nombreModelo,
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          config: {
            responseMimeType: 'application/json',
          },
        });

        let rawText = response.text || '';
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

        const parsed = JSON.parse(rawText);

        if (typeof parsed.hashtags === 'string') {
          parsed.hashtags = parsed.hashtags.split(/\s+/).filter(Boolean);
        } else if (!Array.isArray(parsed.hashtags)) {
          parsed.hashtags = [];
        }

        logger.info(`Propuesta generada exitosamente en el intento ${intento} con ${nombreModelo}`);
        return parsed;

      } catch (error) {
        ultimoError = error;
        const errorMsg = error.message || '';
        logger.warn(`Error temporal en ${nombreModelo} (Intento ${intento}/${MAX_INTENTOS_POR_MODELO}): ${errorMsg}`);

        // Si el modelo no existe (404), pasar de inmediato al siguiente modelo sin reintentar este
        if (errorMsg.includes('404') || errorMsg.includes('NOT_FOUND')) {
          break;
        }

        // Si es un error de cuota (429) o demanda (503), esperar antes de reintentar
        const esErrorCuotaOServidor = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('503');

        if (intento < MAX_INTENTOS_POR_MODELO && esErrorCuotaOServidor) {
          const tiempoPausa = intento * 3000;
          logger.info(`Pausando ${tiempoPausa}ms antes del siguiente intento...`);
          await esperar(tiempoPausa);
        }
      }
    }
  }

  logger.error('Todos los modelos y reintentos fallaron:', { error: ultimoError?.message });
  throw new Error('Servidores de IA saturados temporalmente o límite de cuota alcanzado. Por favor, vuelve a intentar en un minuto.');
}

module.exports = { generarPropuestaPublicacion };