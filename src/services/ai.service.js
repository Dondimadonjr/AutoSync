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

      logger.info(`Propuesta generada exitosamente en el intento ${intento} con ${MODELO_OFICIAL}`);
      return parsed;

    } catch (error) {
      ultimoError = error;
      logger.warn(`Error temporal en ${MODELO_OFICIAL} (Intento ${intento}/${MAX_INTENTOS}): ${error.message}`);

      if (intento < MAX_INTENTOS) {
        logger.info(`Pausando 1000ms antes del siguiente intento...`);
        await esperar(1000);
      }
    }
  }

  logger.error(`Todos los reintentos fallaron con ${MODELO_OFICIAL}:`, { error: ultimoError?.message });
  throw new Error(`Servidores de IA saturados temporalmente tras ${MAX_INTENTOS} intentos. Por favor, vuelve a enviar la imagen en unos segundos.`);
}

module.exports = { generarPropuestaPublicacion };