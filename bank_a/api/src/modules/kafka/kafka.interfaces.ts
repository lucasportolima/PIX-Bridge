/**
 * Envelope CloudEvents 1.0 para publicação no Kafka.
 *
 * Segue a especificação: https://cloudevents.io/
 *
 * O type parameter `T` representa o payload de domínio — o campo `data`.
 * Tipando `T`, o compilador garante que o payload está correto antes de
 * enviar, prevenindo bugs de serialização em tempo de execução.
 *
 * Exemplo:
 *   interface PixTransferInitiatedData {
 *     transferId: string;
 *     senderAccountNumber: string;
 *     receiverPixKey: string;
 *     amountCents: number;
 *   }
 *   const envelope: CloudEventEnvelope<PixTransferInitiatedData> = { ... }
 */
export interface CloudEventEnvelope<T = Record<string, unknown>> {
  /** Versão da especificação CloudEvents — sempre '1.0' */
  specversion: '1.0';
  /**
   * Tipo do evento em notação reversa de domínio.
   * Exemplo: 'pix.transfer.initiated', 'pix.transfer.completed'
   */
  type: string;
  /**
   * URI que identifica o produtor.
   * Exemplo: '/bank-a/transfer', '/bank-b/credit'
   */
  source: string;
  /**
   * UUID v4 do evento — chave de idempotência.
   * DEVE ser igual ao `transferId` para permitir deduplicação no consumidor.
   */
  id: string;
  /** Data e hora de criação do evento em ISO 8601 UTC */
  time: string;
  /** Tipo MIME do campo `data` — sempre 'application/json' */
  datacontenttype: 'application/json';
  /** Payload de domínio tipado */
  data: T;
}

/**
 * Estrutura de entrada para `KafkaProducerService.publish()`.
 *
 * Separa as responsabilidades de transporte (topic, key) do conteúdo do evento (cloudEvent).
 * O `key` é obrigatório para garantir ordenação de eventos do mesmo aggregate:
 *   - Transferências do mesmo `transferId` sempre vão para a mesma partição
 *   - Bank B processa eventos da mesma transferência em ordem FIFO
 */
export interface KafkaEnvelope<T = Record<string, unknown>> {
  /** Tópico Kafka de destino — ex: 'pix.transfer.initiated' */
  topic: string;
  /**
   * Chave de particionamento.
   * Use o `transferId` (UUID) para distribuição uniforme e ordenação por transfer.
   */
  key: string;
  /** Evento CloudEvents tipado */
  cloudEvent: CloudEventEnvelope<T>;
  /**
   * Headers adicionais além dos CloudEvents padrão.
   * Use para propagação de contexto de rastreamento (ex: W3C traceparent).
   */
  extraHeaders?: Record<string, string>;
}

/**
 * Metadados de uma publicação bem-sucedida.
 * Retornado por `KafkaProducerService.publish()`.
 */
export interface PublishResult {
  topic: string;
  partition: number;
  /** Offset atribuído pelo broker — útil para rastreamento de logs */
  offset: string;
  /** Latência da operação em ms — útil para métricas de observabilidade */
  latencyMs: number;
}

/**
 * Contadores de saúde do producer.
 * Retornado por `KafkaProducerService.getMetrics()`.
 */
export interface ProducerMetrics {
  /** Total de mensagens publicadas com sucesso */
  publishedTotal: number;
  /** Total de erros de publicação */
  errorsTotal: number;
  /** Total de reconexões realizadas */
  reconnectsTotal: number;
  /** Latência da última publicação em ms (null se nenhuma ainda) */
  lastPublishLatencyMs: number | null;
  /** Indica se o producer está conectado ao Kafka */
  connected: boolean;
}
