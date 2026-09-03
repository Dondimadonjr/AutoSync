require('dns').setDefaultResultOrder('ipv4first');
const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const logger = require('../config/logger');

// Inicializar la SDK oficial moderna usando la clave configurada en env
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

/**
 * Genera una propuesta de post en formato JSON utilizando Gemini AI.
 * Soporta desestructuración de objeto { producto, descripcion } o argumentos posicionales.
 */
async function generarPropuestaPublicacion(input, descripcionCorta, redSocial = 'Instagram/TikTok') {
  // Manejo flexible de parámetros para mantener compatibilidad con todo el proyecto
  let producto = input;
  let descripcion = descripcionCorta;

  if (typeof input === 'object' && input !== null) {
    producto = input.producto || input.nombreProducto || 'Producto';
    descripcion = input.descripcion || input.descripcionCorta || '';
  }

  const prompt = `
Eres un experto en Marketing Digital para redes sociales.
Genera un post optimizado para un video corto sobre el siguiente producto:
Producto: ${producto}
Detalles: ${descripcion}
Plataforma objetivo: ${redSocial}

Responde ÚNICAMENTE en formato JSON estricto con la siguiente estructura:
{
  "caption": "Texto llamativo con llamadas a la acción (CTA) e emojis",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "sugerencia_visual": "Idea rápida de qué debe mostrar el video"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash', // Modelo estable actual con baja latencia
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let rawText = response.text || '';

    // Limpiar marcas de formato Markdown por si la IA las incluye
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(rawText);

    // Normalizar hashtags para garantizar que sea un array válido
    if (typeof parsed.hashtags === 'string') {
      parsed.hashtags = parsed.hashtags.split(/\s+/).filter(Boolean);
    } else if (!Array.isArray(parsed.hashtags)) {
      parsed.hashtags = [];
    }

    logger.info('Propuesta de contenido generada exitosamente por Gemini', {
      producto,
      hashtagsCount: parsed.hashtags.length,
    });

    return parsed;
  } catch (error) {
    logger.error('Error al generar propuesta con Gemini:', {
      error: error.message || error,
    });
    throw new Error(`Error en el motor de IA: ${error.message || error}`);
  }
}

module.exports = { generarPropuestaPublicacion };