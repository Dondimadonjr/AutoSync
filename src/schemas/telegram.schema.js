const { z } = require('zod');

const TelegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: z.object({
    id: z.number(),
    first_name: z.string().optional(),
    username: z.string().optional(),
  }),
  message: z.object({
    message_id: z.number(),
    chat: z.object({
      id: z.number(),
    }),
  }),
  data: z.string().min(1, 'El callback_data no puede estar vacío'),
});

const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({
        id: z.number(),
      }),
      text: z.string().optional(),
    })
    .optional(),
  callback_query: TelegramCallbackQuerySchema.optional(),
});

module.exports = {
  TelegramUpdateSchema,
  TelegramCallbackQuerySchema,
};
