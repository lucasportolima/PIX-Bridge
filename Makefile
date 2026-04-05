# ──────────────────────────────────────────────────────────────────────────────
# PIX-Bridge — Makefile
# ──────────────────────────────────────────────────────────────────────────────

COMPOSE  := docker compose
DC_FILE  := docker-compose.yml
PROJECT  := pix-bridge

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
	@echo "  Utilities"
	@echo "  ─────────────────────────────────────────"
	@echo "  make kafka-topics   List all Kafka topics"
	@echo "  make kafka-groups   List all Kafka consumer groups"
	@echo "  make mongo-rs       Show MongoDB replica set status"
	@echo "  make generate-jwt-keys  Generate RS256 key pair for Bank A JWT"
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
	@chmod +x infra/kafka/create-topics.sh
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
	@echo ""
	$(COMPOSE) ps
	@echo ""
	@echo "  Health:"
	@$(COMPOSE) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

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
	@echo "Kafka topics:"
	$(COMPOSE) exec kafka kafka-topics --bootstrap-server localhost:9092 --list

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
