require('dns').setDefaultResultOrder('ipv4first');
const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const logger = require('../config/logger');

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Lista de modelos ordenados por preferencia (Principal -> Secundarios)
const MODELOS_DISPONIBLES = [
  'gemini-3.6-flash',
  'gemini_2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

async function generarPropuestaPublicacion(input, descripcionCorta, redSocial = 'Instagram/TikTok') {
  let producto = input;
  let descripcion = descripcionCorta;

  if (typeof input === 'object' && input !== null) {
    producto = input.producto || input.nombreProducto || 'Producto';
    descripcion = input.descripcion || input.descripcionCorta || '';
  }

  const prompt = `
Eres un experto en Marketing Digital para redes sociales.
Genera un post optimizado sobre el siguiente producto/contenido:
Tipo/Producto: ${producto}
Detalles: ${descripcion}
Plataforma objetivo: ${redSocial}

Responde ÚNICAMENTE en formato JSON estricto con la siguiente estructura:
{
  "caption": "Texto llamativo con llamadas a la acción (CTA) e emojis",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "sugerencia_visual": "Idea rápida de qué debe mostrar la imagen o video"
}
`;

  let ultimoError = null;

  // Reintentar dinámicamente en los modelos de respaldo
  for (const modelo of MODELOS_DISPONIBLES) {
    try {
      logger.info(`Generando propuesta con modelo: ${modelo}`);
      
      const response = await ai.models.generateContent({
        model: modelo,
        contents: prompt,
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

      return parsed; // Éxito: retorna la propuesta al controlador

    } catch (error) {
      logger.warn(`Fallo temporal con el modelo ${modelo}:`, { error: error.message });
      ultimoError = error;
      // Continúa el ciclo 'for' e intenta con el siguiente modelo de la lista
    }
  }

  // Si todos los modelos de la lista fallan, lanza el error final
  throw new Error(`Los servidores de IA están saturados temporalmente. Por favor, reintenta en un momento.`);
}

module.exports = { generarPropuestaPublicacion };