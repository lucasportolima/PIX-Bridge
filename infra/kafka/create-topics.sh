#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Kafka Topics Init Script
# Executado dentro do container kafka-init (one-shot) após o Kafka estar healthy.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BROKER="kafka:29092"
REPLICATION_FACTOR=1
RETENTION_MS=604800000   # 7 dias em ms

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[kafka-init] $*"; }
ok()   { echo "[kafka-init] ✓ $*"; }
fail() { echo "[kafka-init] ✗ $*" >&2; exit 1; }

wait_for_kafka() {
  log "Aguardando broker Kafka em ${BROKER}..."
  local retries=30
  until kafka-topics --bootstrap-server "$BROKER" --list &>/dev/null; do
    retries=$((retries - 1))
    [ "$retries" -eq 0 ] && fail "Kafka não ficou disponível a tempo."
    sleep 2
  done
  ok "Kafka disponível."
}

create_topic() {
  local name=$1
  local partitions=${2:-3}
  local retention=${3:-$RETENTION_MS}

  kafka-topics \
    --bootstrap-server "$BROKER" \
    --create \
    --if-not-exists \
    --topic "$name" \
    --replication-factor "$REPLICATION_FACTOR" \
    --partitions "$partitions" \
    --config "retention.ms=${retention}" \
    --config "min.insync.replicas=1"

  ok "Tópico criado: ${name} (partições: ${partitions}, retenção: ${retention}ms)"
}

verify_topic() {
  local name=$1
  log "Verificando configurações do tópico: ${name}"

  # Confirma que o tópico existe e mostra partições + líder
  kafka-topics \
    --bootstrap-server "$BROKER" \
    --describe \
    --topic "$name" \
    | grep -E "Topic:|PartitionCount:|ReplicationFactor:|Configs:"

  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────

wait_for_kafka

log "──────────────────────────────────────────"
log "Criando tópicos do PIX-Bridge..."
log "──────────────────────────────────────────"

# Eventos de transferência interbancária (chave de partição = toAccountNumber)
create_topic "pix.transfer.initiated"  3 "$RETENTION_MS"
create_topic "pix.transfer.completed"  3 "$RETENTION_MS"
create_topic "pix.transfer.failed"     3 "$RETENTION_MS"

log ""
log "──────────────────────────────────────────"
log "Verificando configurações dos tópicos..."
log "──────────────────────────────────────────"

verify_topic "pix.transfer.initiated"
verify_topic "pix.transfer.completed"
verify_topic "pix.transfer.failed"

log "Lista final de tópicos no cluster:"
kafka-topics --bootstrap-server "$BROKER" --list

log "──────────────────────────────────────────"
ok "Todos os tópicos criados e verificados com sucesso."
