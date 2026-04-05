# ──────────────────────────────────────────────────────────────────────────────
# PIX-Bridge — Makefile
# ──────────────────────────────────────────────────────────────────────────────

COMPOSE  := docker compose
DC_FILE  := docker-compose.yml
PROJECT  := pix-bridge

SCRIPTS_DIR := infra

.DEFAULT_GOAL := help

# ── Help ──────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "  PIX-Bridge · Available commands"
	@echo ""
	@echo "  Infrastructure"
	@echo "  ─────────────────────────────────────────"
	@echo "  make setup          First-time setup: copy .env, chmod scripts"
	@echo "  make up             Start all infrastructure services"
	@echo "  make down           Stop all services (preserve volumes)"
	@echo "  make reset          Wipe all volumes and restart from scratch"
	@echo "  make status         Show health status of all containers"
	@echo "  make logs           Tail logs from all services"
	@echo "  make logs s=kafka   Tail logs from a specific service"
	@echo ""
	@echo "  Shells"
	@echo "  ─────────────────────────────────────────"
	@echo "  make kafka-shell    Open Kafka CLI shell"
	@echo "  make mongo-shell    Open MongoDB shell (mongosh)"
	@echo "  make postgres-shell Open PostgreSQL psql shell"
	@echo "  make redis-shell    Open Redis CLI"
	@echo "  make rabbit-shell   Open RabbitMQ management shell"
	@echo ""
	@echo "  Health"
	@echo "  ─────────────────────────────────────────"
	@echo "  make health         Probe completo de todos os serviços"
	@echo "  make health s=kafka Probe de um serviço específico"
	@echo "  make wait           Aguarda todos os serviços ficarem healthy"
	@echo ""
	@echo "  Utilities"
	@echo "  ─────────────────────────────────────────"
	@echo "  make kafka-topics        Listar tópicos Kafka"
	@echo "  make topics-describe     Detalhar configurações dos tópicos PIX"
	@echo "  make kafka-groups        Listar consumer groups"
	@echo "  make mongo-rs            Status do replica set MongoDB"
	@echo "  make generate-jwt-keys   Gerar par de chaves RS256 para JWT"
	@echo ""

# ── First-time Setup ──────────────────────────────────────────────────────────
.PHONY: setup
setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✓ .env created from .env.example — fill in your secrets."; \
	else \
		echo "✓ .env already exists. Skipping copy."; \
	fi
	@chmod +x $(SCRIPTS_DIR)/kafka/create-topics.sh
	@chmod +x $(SCRIPTS_DIR)/healthcheck.sh
	@mkdir -p orange-bank purple-bank
	@echo "✓ Setup complete. Run 'make up' to start the stack."

# ── Stack Lifecycle ───────────────────────────────────────────────────────────
.PHONY: up
up:
	$(COMPOSE) up -d
	@echo ""
	@echo "  Services starting up..."
	@echo "  ┌──────────────────────────────────────────┐"
	@echo "  │  Kafka UI    → http://localhost:8080      │"
	@echo "  │  RabbitMQ UI → http://localhost:15672     │"
	@echo "  │  Kafka       → localhost:9092             │"
	@echo "  │  MongoDB     → localhost:27017            │"
	@echo "  │  PostgreSQL  → localhost:5432             │"
	@echo "  │  RabbitMQ    → localhost:5672             │"
	@echo "  │  Redis       → localhost:6379             │"
	@echo "  └──────────────────────────────────────────┘"
	@echo ""
	@echo "  Run 'make status' to check service health."

.PHONY: down
down:
	$(COMPOSE) down
	@echo "✓ All services stopped. Volumes preserved."

.PHONY: reset
reset:
	@echo "⚠ This will DELETE all data volumes. Continue? [y/N] " && read ans && [ $${ans:-N} = y ]
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) up -d
	@echo "✓ Stack reset complete."

.PHONY: status
status:
	@$(COMPOSE) ps

# Probe completo: verifica conectividade e configurações de cada serviço.
# Uso: make health            → todos os serviços
#      make health s=kafka    → apenas kafka
#      make health s=mongo    → apenas mongo
.PHONY: health
health:
	@chmod +x $(SCRIPTS_DIR)/healthcheck.sh
ifdef s
	@bash $(SCRIPTS_DIR)/healthcheck.sh $(s)
else
	@bash $(SCRIPTS_DIR)/healthcheck.sh
endif

# Bloqueia até que todos os containers principais estejam healthy.
# Útil para scripts de CI que precisam garantir que a infra está pronta
# antes de rodar testes de integração.
.PHONY: wait
wait:
	@echo "Aguardando todos os serviços ficarem healthy..."
	@while docker compose ps | grep -E "starting|unhealthy" | grep -qv "kafka-init\|mongo-init"; do \
		printf "."; sleep 3; \
	done
	@echo ""
	@$(MAKE) health

# ── Logs ──────────────────────────────────────────────────────────────────────
.PHONY: logs
logs:
ifdef s
	$(COMPOSE) logs -f $(s)
else
	$(COMPOSE) logs -f
endif

# ── Shells ────────────────────────────────────────────────────────────────────
.PHONY: kafka-shell
kafka-shell:
	$(COMPOSE) exec kafka bash

.PHONY: mongo-shell
mongo-shell:
	$(COMPOSE) exec mongodb mongosh --host localhost:27017

.PHONY: postgres-shell
postgres-shell:
	$(COMPOSE) exec postgres psql -U pix_user -d bank_b

.PHONY: redis-shell
redis-shell:
	$(COMPOSE) exec redis redis-cli -a pix_secret

.PHONY: rabbit-shell
rabbit-shell:
	$(COMPOSE) exec rabbitmq rabbitmqctl status

# ── Kafka Utilities ───────────────────────────────────────────────────────────
.PHONY: kafka-topics
kafka-topics:
	@echo "Tópicos no cluster Kafka:"
	@$(COMPOSE) exec kafka kafka-topics --bootstrap-server localhost:9092 --list

# Mostra configurações detalhadas (partições, retenção, líder) de cada tópico PIX.
.PHONY: topics-describe
topics-describe:
	@echo ""
	@echo "=== pix.transfer.initiated ==="
	@$(COMPOSE) exec kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic pix.transfer.initiated
	@echo ""
	@echo "=== pix.transfer.completed ==="
	@$(COMPOSE) exec kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic pix.transfer.completed
	@echo ""
	@echo "=== pix.transfer.failed ==="
	@$(COMPOSE) exec kafka kafka-topics --bootstrap-server localhost:9092 --describe --topic pix.transfer.failed
	@echo ""

.PHONY: kafka-groups
kafka-groups:
	@echo "Kafka consumer groups:"
	$(COMPOSE) exec kafka kafka-consumer-groups --bootstrap-server localhost:9092 --list

.PHONY: kafka-offsets
kafka-offsets:
ifndef group
	@echo "Usage: make kafka-offsets group=<consumer-group-id>"
else
	$(COMPOSE) exec kafka kafka-consumer-groups \
		--bootstrap-server localhost:9092 \
		--describe \
		--group $(group)
endif

# ── MongoDB Utilities ─────────────────────────────────────────────────────────
.PHONY: mongo-rs
mongo-rs:
	$(COMPOSE) exec mongodb mongosh --quiet --eval "rs.status()"

# ── JWT Key Generation ────────────────────────────────────────────────────────
.PHONY: generate-jwt-keys
generate-jwt-keys:
	@mkdir -p orange-bank/certs
	openssl genrsa -out orange-bank/certs/private.pem 2048
	openssl rsa -in orange-bank/certs/private.pem -pubout -out orange-bank/certs/public.pem
	@echo ""
	@echo "✓ Keys generated:"
	@echo "  Private: orange-bank/certs/private.pem"
	@echo "  Public:  orange-bank/certs/public.pem"
	@echo ""
	@echo "  Add to .env:"
	@echo "  JWT_PRIVATE_KEY=\"\$$(awk 'NF {sub(/\\r/, ""); printf "%s\\\\n",$$0;}' orange-bank/certs/private.pem)\""
	@echo "  JWT_PUBLIC_KEY=\"\$$(awk 'NF {sub(/\\r/, ""); printf "%s\\\\n",$$0;}' orange-bank/certs/public.pem)\""
