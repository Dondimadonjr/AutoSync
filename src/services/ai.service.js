require('dns').setDefaultResultOrder('ipv4first');
const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const logger = require('../config/logger');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

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

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
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

    logger.info('Propuesta generada exitosamente con gemini-3.6-flash', { producto });
    return parsed;

  } catch (error) {
    logger.error('Error procesando respuesta en ai.service:', { error: error.message || error });
    throw new Error(`Error en el motor de IA: ${error.message || error}`);
  }
}

module.exports = { generarPropuestaPublicacion };