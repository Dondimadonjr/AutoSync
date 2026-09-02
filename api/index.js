const express = require('express');
const routes = require('../src/routes');
const { errorHandler, notFoundHandler } = require('../src/middlewares/error.middleware');
const logger = require('../src/config/logger');
const env = require('../src/config/env');

const app = express();

// Parsear JSON entrante con límite seguro
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Log estructurado de solicitudes entrantes
app.use((req, res, next) => {
  logger.info(`HTTP ${req.method} ${req.originalUrl}`);
  next();
});

// Rutas principales de la API
app.use('/', routes);

// Manejadores de 404 y excepciones globales
app.use(notFoundHandler);
app.use(errorHandler);

// Servidor local para desarrollo (solo si se ejecuta directamente con node api/index.js)
if (require.main === module && !process.env.VERCEL) {
  const PORT = env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`🚀 Servidor SocialSync corriendo localmente en el puerto ${PORT}`);
  });
}

module.exports = app;