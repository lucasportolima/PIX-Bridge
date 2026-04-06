import { Params } from 'nestjs-pino';

/**
 * Pino logger configuration.
 *
 * - In development: pretty-print for human readability.
 * - In production: structured JSON with W3C traceparent header propagation.
 *
 * The `traceId` field is extracted from the `traceparent` header so every
 * log line can be correlated across services without a separate APM agent.
 */
export function buildPinoOptions(isDevelopment: boolean): Params {
  return {
    pinoHttp: {
      level: isDevelopment ? 'debug' : 'info',
      transport: isDevelopment
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: false } }
        : undefined,
      // Serialize req/res without sensitive headers
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            // Do NOT log Authorization headers
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
      // Propagate traceId from W3C traceparent header into every log line
      customProps(req) {
        const traceparent = (req.headers['traceparent'] as string) ?? '';
        const traceId = traceparent ? traceparent.split('-')[1] : undefined;
        return traceId ? { traceId } : {};
      },
      // Suppress health-check endpoint noise
      autoLogging: {
        ignore(req) {
          return req.url === '/health';
        },
      },
    },
  };
}
