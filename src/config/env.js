require('dotenv').config();
const { z } = require('zod');
const logger = require('./logger');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3000'),
  SUPABASE_URL: z.string().url('SUPABASE_URL debe ser una URL válida'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY es requerida'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY es requerida'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN es requerido'),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8, 'TELEGRAM_WEBHOOK_SECRET debe tener al menos 8 caracteres').optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.error('Error de configuración en variables de entorno:', {
    errors: parsed.error.format(),
  });
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Variables de entorno inválidas. Revisa los logs.');
  }
}

module.exports = parsed.data || process.env;
