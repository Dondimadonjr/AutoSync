const { z } = require('zod');

const GenerarPostSchema = z.object({
  clienteId: z.string().uuid('clienteId debe ser un UUID válido'),
  producto: z.string().min(2, 'El nombre del producto debe tener al menos 2 caracteres'),
  descripcion: z.string().min(5, 'La descripción debe tener al menos 5 caracteres'),
  mediaUrl: z.string().url('mediaUrl debe ser una URL válida (ej. video en Supabase Storage o CDN)'),
  chatId: z.union([z.string(), z.number()]).optional(),
  plataformas: z.array(z.enum(['instagram', 'tiktok', 'facebook'])).default(['instagram']),
});

module.exports = {
  GenerarPostSchema,
};
