/**
 * Logger estructurado para entorno Serverless / Cloud
 */
function formatLog(level, message, metadata = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(Object.keys(metadata).length > 0 ? { meta: metadata } : {}),
  };

  const output = JSON.stringify(entry);

  switch (level) {
    case 'ERROR':
      console.error(output);
      break;
    case 'WARN':
      console.warn(output);
      break;
    default:
      console.log(output);
      break;
  }
}

const logger = {
  info: (message, meta) => formatLog('INFO', message, meta),
  warn: (message, meta) => formatLog('WARN', message, meta),
  error: (message, meta) => formatLog('ERROR', message, meta),
  debug: (message, meta) => {
    if (process.env.NODE_ENV !== 'production') {
      formatLog('DEBUG', message, meta);
    }
  },
};

module.exports = logger;
