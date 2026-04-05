#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Kafka Topics Init Script
# Runs inside the kafka-init one-shot container after Kafka is healthy.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BROKER="kafka:29092"
REPLICATION_FACTOR=1
RETENTION_MS=604800000  # 7 days

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[kafka-init] $*"; }

wait_for_kafka() {
  log "Waiting for Kafka broker at ${BROKER}..."
  until kafka-topics --bootstrap-server "$BROKER" --list &>/dev/null; do
    sleep 2
  done
  log "Kafka is ready."
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

  log "✓ Topic ready: ${name} (partitions: ${partitions}, retention: ${retention}ms)"
}

# ── Main ──────────────────────────────────────────────────────────────────────

wait_for_kafka

log "Creating PIX-Bridge topics..."

# Inter-bank transfer events (partitioned by toAccountNumber)
create_topic "pix.transfer.initiated"  3 "$RETENTION_MS"
create_topic "pix.transfer.completed"  3 "$RETENTION_MS"
create_topic "pix.transfer.failed"     3 "$RETENTION_MS"

log ""
log "All topics created successfully:"
kafka-topics --bootstrap-server "$BROKER" --list
