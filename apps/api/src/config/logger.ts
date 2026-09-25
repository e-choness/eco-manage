import pino, { DestinationStream, Logger } from 'pino';

// Never log credentials: request headers are not logged at all, and these paths are
// redacted in case an object carrying them is passed to the logger.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.accessToken',
  '*.refreshToken',
  '*.token',
];

export const createLogger = (level = process.env.LOG_LEVEL || 'info', destination?: DestinationStream): Logger =>
  pino({ level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, destination);

export const logger = createLogger(process.env.NODE_ENV === 'test' ? 'silent' : undefined);
