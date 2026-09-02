const { z } = require('zod');

const GeminiPostProposalSchema = z.object({
  caption: z.string().min(5, 'El caption generado debe tener contenido válido'),
  hashtags: z.union([
    z.array(z.string()),
    z.string().transform((val) => val.split(' ').filter(Boolean)),
  ]).transform((val) => {
    // Normalizar hashtags para que todos comiencen con '#'
    return val.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
  }),
  sugerencia_visual: z.string().min(5, 'Debe incluir una sugerencia visual para el video'),
});

module.exports = {
  GeminiPostProposalSchema,
};
