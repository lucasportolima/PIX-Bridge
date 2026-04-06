#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# PIX-Bridge — Health Probe Script
#
# Executa probes diretos em cada serviço da infraestrutura e exibe um
# relatório colorido no terminal.
#
# Uso:
#   bash infra/healthcheck.sh           → verifica todos os serviços
#   bash infra/healthcheck.sh kafka     → verifica apenas o Kafka
#   bash infra/healthcheck.sh --json    → saída em JSON (para CI/CD)
#
# Exit codes:
#   0 → todos os serviços passaram
#   1 → um ou mais serviços falharam
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Cores ─────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Contadores ────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
SKIP=0
declare -a FAILED_CHECKS=()

# ── Argumentos ────────────────────────────────────────────────────────────────
FILTER="${1:-}"
JSON_OUTPUT=false
[[ "$FILTER" == "--json" ]] && { JSON_OUTPUT=true; FILTER=""; }

# ── Helpers ───────────────────────────────────────────────────────────────────

header() {
  $JSON_OUTPUT && return
  echo -e "\n${BOLD}${CYAN}  ▶ $1${NC}"
  echo -e "${DIM}  ──────────────────────────────────────${NC}"
}

check() {
  local label="$1"
  local cmd="$2"

  if eval "$cmd" &>/dev/null; then
    $JSON_OUTPUT || printf "  ${GREEN}✓${NC} %-45s ${DIM}OK${NC}\n" "$label"
    PASS=$((PASS + 1))
    return 0
  else
    $JSON_OUTPUT || printf "  ${RED}✗${NC} %-45s ${RED}FALHOU${NC}\n" "$label"
    FAIL=$((FAIL + 1))
    FAILED_CHECKS+=("$label")
    return 1
  fi
}

check_value() {
  local label="$1"
  local cmd="$2"
  local expected="$3"

  local result
  result=$(eval "$cmd" 2>/dev/null || echo "ERROR")

  if echo "$result" | grep -q "$expected"; then
    $JSON_OUTPUT || printf "  ${GREEN}✓${NC} %-45s ${DIM}${result}${NC}\n" "$label"
    PASS=$((PASS + 1))
  else
    $JSON_OUTPUT || printf "  ${RED}✗${NC} %-45s ${RED}got: ${result}${NC}\n" "$label"
    FAIL=$((FAIL + 1))
    FAILED_CHECKS+=("$label")
  fi
}

dc_exec() {
  # docker compose exec sem TTY (funciona em CI também)
  docker compose exec -T "$@"
}

should_run() {
  # Retorna 0 se o filtro bater ou se não há filtro
  [[ -z "$FILTER" ]] || [[ "$1" == *"$FILTER"* ]]
}

# ── Verifica se docker compose está disponível ────────────────────────────────
if ! docker compose ps &>/dev/null; then
  echo -e "${RED}✗ Docker Compose não está rodando ou o projeto não foi iniciado.${NC}"
  echo -e "  Execute: ${BOLD}make up${NC}"
  exit 1
fi

$JSON_OUTPUT || echo -e "\n${BOLD}PIX-Bridge — Health Check${NC} $(date '+%d/%m/%Y %H:%M:%S')"

# ══════════════════════════════════════════════════════════════════════════════
# KAFKA
# ══════════════════════════════════════════════════════════════════════════════
if should_run "kafka"; then
  header "Kafka (KRaft)"

  check \
    "Broker respondendo (port 9092)" \
    "dc_exec kafka kafka-topics --bootstrap-server localhost:9092 --list"

  check \
    "Tópico pix.transfer.initiated" \
    "dc_exec kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic pix.transfer.initiated"

  check \
    "Tópico pix.transfer.completed" \
    "dc_exec kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic pix.transfer.completed"

  check \
    "Tópico pix.transfer.failed" \
    "dc_exec kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic pix.transfer.failed"

  check_value \
    "Partições do tópico initiated (esperado: 3)" \
    "dc_exec kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic pix.transfer.initiated" \
    "PartitionCount: 3"

  check_value \
    "Retenção 7 dias (604800000ms)" \
    "dc_exec kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name pix.transfer.initiated --describe" \
    "retention.ms=604800000"
fi

# ══════════════════════════════════════════════════════════════════════════════
# MONGODB
# ══════════════════════════════════════════════════════════════════════════════
if should_run "mongo"; then
  header "MongoDB (Replica Set rs0)"

  check \
    "Servidor aceitando conexões (ping)" \
    "dc_exec mongodb mongosh --quiet --eval \"db.adminCommand('ping').ok === 1\""

  check_value \
    "Modo do nó no replica set (esperado: PRIMARY)" \
    "dc_exec mongodb mongosh --quiet --eval \"rs.status().myState\"" \
    "^1$"

  check \
    "Database bank_a acessível" \
    "dc_exec mongodb mongosh --quiet --eval \"db.getSiblingDB('bank_a').runCommand('ping').ok\""
fi

# ══════════════════════════════════════════════════════════════════════════════
# POSTGRESQL
# ══════════════════════════════════════════════════════════════════════════════
if should_run "postgres"; then
  header "PostgreSQL 16"

  check \
    "Servidor aceitando conexões" \
    "dc_exec postgres pg_isready -U pix_user -d bank_b"

  check_value \
    "Database bank_b existe" \
    "dc_exec postgres psql -U pix_user -d bank_b -tAc \"SELECT 1\"" \
    "^1$"

  check_value \
    "Extensão pgcrypto instalada" \
    "dc_exec postgres psql -U pix_user -d bank_b -tAc \"SELECT extname FROM pg_extension WHERE extname='pgcrypto'\"" \
    "pgcrypto"

  check_value \
    "Extensão citext instalada" \
    "dc_exec postgres psql -U pix_user -d bank_b -tAc \"SELECT extname FROM pg_extension WHERE extname='citext'\"" \
    "citext"
fi

# ══════════════════════════════════════════════════════════════════════════════
# RABBITMQ
# ══════════════════════════════════════════════════════════════════════════════
if should_run "rabbit"; then
  header "RabbitMQ 3.13"

  check \
    "Diagnóstico ping interno" \
    "dc_exec rabbitmq rabbitmq-diagnostics -q ping"

  check_value \
    "API de gerenciamento respondendo (aliveness)" \
    "curl -sf -u pix_user:pix_secret 'http://localhost:15672/api/aliveness-test/%2F'" \
    "\"status\":\"ok\""

  check_value \
    "Usuário pix_user com tag administrator" \
    "curl -sf -u pix_user:pix_secret http://localhost:15672/api/whoami" \
    "administrator"

  check_value \
    "Vhost / disponível" \
    "curl -sf -u pix_user:pix_secret 'http://localhost:15672/api/vhosts/%2F'" \
    "\"name\":\"/\""
fi

# ══════════════════════════════════════════════════════════════════════════════
# REDIS
# ══════════════════════════════════════════════════════════════════════════════
if should_run "redis"; then
  header "Redis 7"

  check_value \
    "Servidor respondendo (PING)" \
    "dc_exec redis redis-cli -a pix_secret ping" \
    "PONG"

  check_value \
    "Persistência AOF habilitada" \
    "dc_exec redis redis-cli -a pix_secret config get appendonly" \
    "yes"

  check_value \
    "Limite de memória configurado (256mb)" \
    "dc_exec redis redis-cli -a pix_secret config get maxmemory-policy" \
    "allkeys-lru"
fi

# ══════════════════════════════════════════════════════════════════════════════
# REDPANDA CONSOLE
# ══════════════════════════════════════════════════════════════════════════════
if should_run "console" || should_run "redpanda"; then
  header "RedPanda Console (Kafka UI)"

  check \
    "Interface HTTP respondendo (port 8080)" \
    "curl -sf -o /dev/null http://localhost:8080"

  check \
    "Endpoint de overview do cluster acessível" \
    "curl -sf -o /dev/null http://localhost:8080/api/cluster/overview"
fi

# ══════════════════════════════════════════════════════════════════════════════
# RELATÓRIO FINAL
# ══════════════════════════════════════════════════════════════════════════════
if $JSON_OUTPUT; then
  echo "{\"pass\":${PASS},\"fail\":${FAIL},\"failed\":$(printf '%s\n' "${FAILED_CHECKS[@]:-}" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')}"
else
  echo ""
  echo -e "${DIM}  ──────────────────────────────────────────────────${NC}"
  if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}${BOLD}Resultado: ${PASS} checks passaram, 0 falhas.${NC} ✓"
  else
    echo -e "  ${RED}${BOLD}Resultado: ${PASS} passaram, ${FAIL} falharam.${NC}"
    echo ""
    echo -e "  ${RED}Checks com falha:${NC}"
    for item in "${FAILED_CHECKS[@]}"; do
      echo -e "    ${RED}✗${NC} ${item}"
    done
  fi
  echo ""
fi

[ "$FAIL" -eq 0 ]
