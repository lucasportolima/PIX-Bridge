import {
  KafkaJSConnectionError,
  KafkaJSError,
  KafkaJSNonRetriableError,
  KafkaJSNumberOfRetriesExceeded,
  KafkaJSProtocolError,
  KafkaJSRequestTimeoutError,
} from 'kafkajs';

/**
 * Códigos de erro do protocolo Kafka que indicam falha permanente.
 *
 * Esses erros NÃO devem ser retentados pelo OutboxWorker — indicam problemas
 * de configuração ou payload que não se resolverão com novas tentativas.
 *
 * Referência: https://kafka.apache.org/protocol.html#protocol_error_codes
 */
const PERMANENT_PROTOCOL_CODES = new Set([
  3,  // UNKNOWN_TOPIC_OR_PARTITION — tópico não existe
  10, // MESSAGE_TOO_LARGE          — payload excede max.message.bytes do broker
  17, // ILLEGAL_GENERATION          — rebalance de consumer (não aplicável ao producer)
  29, // TOPIC_AUTHORIZATION_FAILED  — sem permissão para publicar no tópico
  37, // CLUSTER_AUTHORIZATION_FAILED
  41, // DELEGATION_TOKEN_AUTH_DISABLED
]);

// ─────────────────────────────────────────────────────────────────────────────
// ERROS DE DOMÍNIO DO PRODUTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erro transitório: falha temporária de rede, timeout ou broker em eleição.
 *
 * O OutboxWorker DEVE retentar o evento após um backoff.
 * O `retryCount` no OutboxEvent já controla o limite máximo de retentativas.
 *
 * Exemplos:
 *   - KafkaJSConnectionError (queda de rede)
 *   - KafkaJSRequestTimeoutError (broker lento)
 *   - KafkaJSNumberOfRetriesExceeded (KafkaJS esgotou os retries internos)
 */
export class KafkaTransientError extends Error {
  readonly retriable = true as const;

  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'KafkaTransientError';
  }
}

/**
 * Erro permanente: problema de configuração ou payload inválido.
 *
 * O OutboxWorker NÃO deve retentar — deve mover o evento para status DEAD
 * diretamente, pois mais tentativas não resolverão o problema.
 *
 * Exemplos:
 *   - Tópico não existe (UNKNOWN_TOPIC_OR_PARTITION)
 *   - Sem autorização (TOPIC_AUTHORIZATION_FAILED)
 *   - Mensagem muito grande (MESSAGE_TOO_LARGE)
 *   - Erro de serialização do payload
 */
export class KafkaPermanentError extends Error {
  readonly retriable = false as const;

  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'KafkaPermanentError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICADOR DE ERROS KAFKAJS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converte um erro cru do KafkaJS em KafkaTransientError ou KafkaPermanentError.
 *
 * REGRAS DE CLASSIFICAÇÃO (em ordem de precedência):
 *
 *   1. `KafkaJSNonRetriableError` → Permanente
 *      Subclasse de KafkaJSError com semântica de "nunca retentar".
 *      Inclui: KafkaJSSASLAuthenticationError, KafkaJSServerDoesNotSupportApiKey, etc.
 *
 *   2. `KafkaJSProtocolError` com código na lista de permanentes → Permanente
 *      Erros de protocolo Kafka com códigos conhecidos como não-recuperáveis.
 *
 *   3. `KafkaJSConnectionError` → Transitório
 *      Queda de conexão TCP. O produtor pode se reconectar.
 *
 *   4. `KafkaJSRequestTimeoutError` → Transitório
 *      Broker não respondeu no tempo esperado. Geralmente transitório.
 *
 *   5. `KafkaJSNumberOfRetriesExceeded` → Transitório
 *      KafkaJS esgotou seus retries internos mas o erro original era transitório.
 *      O OutboxWorker tem seu próprio limite (retryCount), então ainda vale retentar.
 *
 *   6. `KafkaJSError` com `retriable: false` → Permanente
 *
 *   7. `KafkaJSError` com `retriable: true` ou desconhecido → Transitório
 *
 * @param err - qualquer erro lançado pelo produtor KafkaJS
 * @returns KafkaTransientError | KafkaPermanentError
 */
export function classifyKafkaError(err: unknown): KafkaTransientError | KafkaPermanentError {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err : undefined;

  // 1. Erros explicitamente não-retriable do KafkaJS
  if (err instanceof KafkaJSNonRetriableError) {
    return new KafkaPermanentError(`Non-retriable Kafka error: ${message}`, cause);
  }

  // 2. Protocolo Kafka com código de erro permanente
  if (err instanceof KafkaJSProtocolError) {
    const code = (err as KafkaJSProtocolError).code;
    if (PERMANENT_PROTOCOL_CODES.has(code)) {
      return new KafkaPermanentError(
        `Permanent Kafka protocol error (code ${code}): ${message}`,
        cause,
      );
    }
    // Outros erros de protocolo (ex: LEADER_NOT_AVAILABLE) são transitórios
    return new KafkaTransientError(`Transient Kafka protocol error (code ${code}): ${message}`, cause);
  }

  // 3. Erros de conexão → sempre transitório
  if (err instanceof KafkaJSConnectionError) {
    return new KafkaTransientError(`Kafka connection error: ${message}`, cause);
  }

  // 4. Timeout → transitório
  if (err instanceof KafkaJSRequestTimeoutError) {
    return new KafkaTransientError(`Kafka request timeout: ${message}`, cause);
  }

  // 5. KafkaJS esgotou retries internos → ainda transitório (OutboxWorker vai retentar)
  if (err instanceof KafkaJSNumberOfRetriesExceeded) {
    return new KafkaTransientError(
      `Kafka retries exhausted after ${err.retryCount} attempts: ${message}`,
      cause,
    );
  }

  // 6–7. KafkaJSError genérico: usa a propriedade `retriable` do próprio erro
  if (err instanceof KafkaJSError) {
    if (!err.retriable) {
      return new KafkaPermanentError(`Non-retriable Kafka error: ${message}`, cause);
    }
    return new KafkaTransientError(`Transient Kafka error: ${message}`, cause);
  }

  // Erro desconhecido (não é do KafkaJS) — tratado como transitório por segurança
  return new KafkaTransientError(`Unknown Kafka error: ${message}`, cause);
}

/** Type guard para verificar se um erro é retentável */
export function isRetriableKafkaError(
  err: unknown,
): err is KafkaTransientError {
  return err instanceof KafkaTransientError;
}
