import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  Kafka,
  Partitioners,
  Producer,
  KafkaJSConnectionError,
} from 'kafkajs';
import { TypedConfigService } from '../../config';
import type { KafkaEnvelope, ProducerMetrics, PublishResult } from './kafka.interfaces';
import { classifyKafkaError, KafkaPermanentError, KafkaTransientError } from './kafka.errors';

/** Tempo de espera antes de tentar reconectar após queda de conexão */
const RECONNECT_DELAY_MS = 300;

/**
 * `KafkaProducerService` — produtor Kafka com:
 *
 *   - Envelope CloudEvents 1.0 tipado (serialize + headers automáticos)
 *   - Conexão lazy: conecta apenas na primeira publicação, não no startup
 *   - Retry automático em erros de conexão (uma reconexão por publicação)
 *   - Classificação de erros: KafkaTransientError vs KafkaPermanentError
 *   - Métricas internas: contadores e latência da última publicação
 *   - Serialização segura com captura de erros de JSON
 *
 * DESIGN DE RETRY EM DUAS CAMADAS:
 * ──────────────────────────────────────────────────────────────────────────
 *
 *   Camada 1 — KafkaJS (interno, configurável via `retry`):
 *     Lida com erros de protocolo Kafka transientes (leader election,
 *     LEADER_NOT_AVAILABLE, throttling). Cada `producer.send()` pode
 *     realizar até N retries internamente antes de lançar uma exceção.
 *
 *   Camada 2 — KafkaProducerService (reconexão):
 *     Lida com quedas de conexão TCP após o producer já estar conectado.
 *     Se `producer.send()` lançar `KafkaJSConnectionError`, o producer
 *     reseta a flag `connected`, aguarda RECONNECT_DELAY_MS, reconecta
 *     e tenta novamente UMA VEZ. Se falhar de novo, lança a exceção
 *     classificada.
 *
 *   Camada 3 — OutboxWorkerService (outbox pattern):
 *     Lida com falhas persistentes. Se o KafkaProducerService lançar
 *     KafkaTransientError, o OutboxWorker marca o evento como PENDING
 *     (voltará na próxima rodada). Se lançar KafkaPermanentError,
 *     move o evento diretamente para DEAD.
 *
 * POR QUE NÃO ADICIONAR MAIS CAMADAS?
 *   Cada camada de retry adiciona latência e complexidade. O Outbox Pattern
 *   já garante durabilidade — se o Kafka está down por minutos, o evento
 *   ficará em PENDING e será publicado quando o Kafka voltar. Retry
 *   agressivo no producer apenas atrasaria o ciclo do worker.
 */
@Injectable()
export class KafkaProducerService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly producer: Producer;

  private connected = false;
  private readonly metrics: ProducerMetrics = {
    publishedTotal: 0,
    errorsTotal: 0,
    reconnectsTotal: 0,
    lastPublishLatencyMs: null,
    connected: false,
  };

  constructor(private readonly config: TypedConfigService) {
    const brokers = this.config.get('KAFKA_BROKERS').split(',');
    const clientId = this.config.get('KAFKA_CLIENT_ID');

    const kafka = new Kafka({
      clientId,
      brokers,
      /**
       * Retry do KafkaJS — Camada 1.
       *
       * `retries: 5` com `initialRetryTime: 300ms` e multiplicador padrão (2×):
       *   Tentativa 1: imediata
       *   Tentativa 2: ~300ms
       *   Tentativa 3: ~600ms
       *   Tentativa 4: ~1200ms
       *   Tentativa 5: ~2400ms
       *   Total: ~4.5s antes de lançar KafkaJSNumberOfRetriesExceeded
       *
       * `maxRetryTime: 10_000` impede retries indefinidamente longos em
       * casos extremos (ex: broker indisponível por muito tempo).
       */
      retry: {
        retries: 5,
        initialRetryTime: 300,
        maxRetryTime: 10_000,
        factor: 2,
      },
      /**
       * Timeout de conexão: se o broker não responder em 10s no startup,
       * a conexão falha imediatamente ao invés de prender o processo.
       */
      connectionTimeout: 10_000,
    });

    this.producer = kafka.producer({
      /**
       * LegacyPartitioner: distribui mensagens baseado em hash da key.
       * Garante que mensagens com a mesma key (transferId) vão para a
       * mesma partição, preservando a ordem de eventos por transfer.
       *
       * O DefaultPartitioner do KafkaJS 2.x usa sticky partitioning,
       * que maximiza throughput mas quebra a ordenação por key.
       */
      createPartitioner: Partitioners.LegacyPartitioner,
      /**
       * allowAutoTopicCreation: false — falha explicitamente se o tópico
       * não existe ao invés de criar silenciosamente com configurações padrão.
       * Tópicos devem ser criados com configurações específicas (replication,
       * retention, etc.) via script de infraestrutura.
       */
      allowAutoTopicCreation: false,
      /**
       * idempotent: true garante exatamente-uma entrega mesmo com retries.
       * Requer que o broker tenha `enable.idempotence=true` (padrão no Kafka 3+).
       * Com idempotência, o broker deduplica mensagens com o mesmo sequence number,
       * prevenindo duplicatas causadas por retries de rede.
       *
       * Nota: idempotência do producer é por sessão, não persistente.
       * O Outbox Pattern garante durabilidade de ponta-a-ponta.
       */
      idempotent: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.connected = false;
      this.metrics.connected = false;
      this.logger.log(
        { metrics: this.getMetrics() },
        'Kafka producer disconnected',
      );
    }
  }

  /**
   * Publica uma mensagem CloudEvents no Kafka.
   *
   * SERIALIZAÇÃO:
   *   1. Serializa `cloudEvent` como JSON (value da mensagem)
   *   2. Extrai campos CloudEvents para headers Kafka (ce-*)
   *   3. Mescla com `extraHeaders` do caller
   *
   * RETRY:
   *   Se ocorrer KafkaJSConnectionError (queda de conexão), reconecta
   *   uma vez e tenta novamente. Demais erros são classificados e lançados.
   *
   * @param envelope - envelope tipado com topic, key e cloudEvent
   * @returns PublishResult com partition, offset e latência
   * @throws KafkaTransientError se o erro é recuperável (OutboxWorker vai retentar)
   * @throws KafkaPermanentError se o erro é permanente (OutboxWorker vai para DEAD)
   */
  async publish<T>(envelope: KafkaEnvelope<T>): Promise<PublishResult> {
    const serialized = this.serialize(envelope.cloudEvent);
    const headers = this.buildHeaders(envelope);

    return this.sendWithReconnect(envelope.topic, envelope.key, serialized, headers);
  }

  /** Retorna uma cópia dos contadores de saúde do producer */
  getMetrics(): ProducerMetrics {
    return { ...this.metrics };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IMPLEMENTAÇÃO INTERNA
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Tenta enviar uma mensagem, reconectando UMA VEZ se a conexão caiu.
   *
   * POR QUE APENAS UMA RECONEXÃO?
   *   Dois cenários ao enviar:
   *     a) Conexão ok → envia normalmente
   *     b) Conexão caiu → reconecta → tenta → se falhar de novo, é sinal de
   *        problema maior (Kafka down, network partition) → propaga o erro
   *
   *   Mais reconexões criariam latência desnecessária. O Outbox Pattern
   *   cuidará da reentrega quando o Kafka voltar.
   */
  private async sendWithReconnect(
    topic: string,
    key: string,
    value: string,
    headers: Record<string, string>,
  ): Promise<PublishResult> {
    try {
      await this.ensureConnected();
      return await this.doSend(topic, key, value, headers);
    } catch (err) {
      // Reconexão: apenas para erros de conexão TCP
      if (err instanceof KafkaJSConnectionError) {
        this.logger.warn(
          { topic, key, error: err.message },
          'Kafka connection lost — attempting reconnect',
        );

        this.connected = false;
        this.metrics.connected = false;

        await sleep(RECONNECT_DELAY_MS);

        try {
          await this.ensureConnected();
          this.metrics.reconnectsTotal++;
          return await this.doSend(topic, key, value, headers);
        } catch (reconnectErr) {
          this.metrics.errorsTotal++;
          throw classifyKafkaError(reconnectErr);
        }
      }

      this.metrics.errorsTotal++;
      throw classifyKafkaError(err);
    }
  }

  /**
   * Executa o `producer.send()` e constrói o `PublishResult`.
   * Mede a latência da operação.
   */
  private async doSend(
    topic: string,
    key: string,
    value: string,
    headers: Record<string, string>,
  ): Promise<PublishResult> {
    const start = Date.now();

    const results = await this.producer.send({
      topic,
      messages: [{ key, value, headers }],
    });

    const latencyMs = Date.now() - start;
    this.metrics.publishedTotal++;
    this.metrics.lastPublishLatencyMs = latencyMs;

    const record = results[0];
    const partition = record?.partition ?? -1;
    const offset = record?.offset ?? '-1';

    this.logger.debug(
      { topic, key, partition, offset, latencyMs },
      'Message published to Kafka',
    );

    return { topic, partition, offset, latencyMs };
  }

  /**
   * Serializa o envelope CloudEvents para JSON.
   *
   * Lança KafkaPermanentError se o payload não for serializável — isso
   * evita que o OutboxWorker entre em loop infinito tentando serializar
   * um objeto com referências circulares.
   */
  private serialize(cloudEvent: unknown): string {
    try {
      return JSON.stringify(cloudEvent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new KafkaPermanentError(
        `Failed to serialize CloudEvent payload: ${message}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * Constrói os headers Kafka da mensagem.
   *
   * CloudEvents Protocol Binding para Kafka (https://cloudevents.io/):
   *   - Cada atributo do envelope CloudEvents vira um header `ce-{attribute}`
   *   - O `value` da mensagem contém apenas o campo `data`
   *
   * Headers permitem que consumidores façam routing sem desserializar o body,
   * útil para filtros no Kafka Streams ou no próprio consumer antes de processar.
   */
  private buildHeaders(envelope: KafkaEnvelope<unknown>): Record<string, string> {
    const { cloudEvent, extraHeaders } = envelope;
    return {
      'ce-specversion': cloudEvent.specversion,
      'ce-id': cloudEvent.id,
      'ce-type': cloudEvent.type,
      'ce-source': cloudEvent.source,
      'ce-time': cloudEvent.time,
      'ce-datacontenttype': cloudEvent.datacontenttype,
      ...extraHeaders,
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
    this.metrics.connected = true;
    this.logger.log('Kafka producer connected');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-exporta os erros para facilitar imports no OutboxWorkerService
export { KafkaTransientError, KafkaPermanentError };
