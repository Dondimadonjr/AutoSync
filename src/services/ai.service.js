require('dns').setDefaultResultOrder('ipv4first');
const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const logger = require('../config/logger');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Lista de modelos válidos en orden de preferencia (fallback)
const MODELOS_DISPONIBLES = ['gemini-1.5-flash', 'gemini-1.5-pro'];
const MAX_INTENTOS_POR_MODELO = 3;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Genera una propuesta de copy, hashtags y sugerencia visual mediante Gemini API
 */
async function generarPropuestaPublicacion(input, descripcionCorta, redSocial = 'Instagram/TikTok') {
  let producto = input;
  let descripcion = descripcionCorta;

  // Normalización del parámetro de entrada en caso de ser objeto o string
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

  // Iterar modelo por modelo (Fallback)
  for (const nombreModelo of MODELOS_DISPONIBLES) {
    for (let intento = 1; intento <= MAX_INTENTOS_POR_MODELO; intento++) {
      try {
        logger.info(`Intento ${intento} con modelo ${nombreModelo}`);

        const response = await ai.models.generateContent({
          model: nombreModelo, // Se pasa una string individual
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          config: {
            responseMimeType: 'application/json',
          },
        });

        let rawText = response.text || '';
        
        // Limpieza defensiva de marcadores Markdown
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

        const parsed = JSON.parse(rawText);

        // Normalización del campo hashtags
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

        // Si el error es por cuota superada (429 / RESOURCE_EXHAUSTED) o alta demanda (503)
        const esErrorCuotaOServidor = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('503');

        if (intento < MAX_INTENTOS_POR_MODELO && esErrorCuotaOServidor) {
          const tiempoPausa = intento * 3000; // 3s en el primer intento, 6s en el segundo
          logger.info(`Pausando ${tiempoPausa}ms antes del siguiente intento...`);
          await esperar(tiempoPausa);
        } else {
          logger.error(`Fallaron los reintentos con ${nombreModelo}, pasando al modelo de respaldo...`);
          break; // Sale del ciclo de reintentos para probar el siguiente modelo en MODELOS_DISPONIBLES
        }
      }
    }
  }

  logger.error('Todos los modelos y reintentos fallaron:', { error: ultimoError?.message });
  throw new Error('Servidores de IA saturados temporalmente o límite de cuota alcanzado. Por favor, vuelve a intentar en un minuto.');
}

module.exports = { generarPropuestaPublicacion };