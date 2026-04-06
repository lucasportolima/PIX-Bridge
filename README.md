# PIX-Bridge

Monorepo que simula uma transferência PIX entre dois bancos independentes, demonstrando arquitetura de microsserviços com mensageria assíncrona, GenAI e observabilidade.

## Estrutura

```
pix-bridge/
├── bank_a/
│   ├── api/          # Backend — NestJS · GraphQL · MongoDB
│   └── client/       # Frontend — Vue.js 3 (TASK-08)
├── bank_b/
│   ├── api/          # Backend — FastAPI · REST · PostgreSQL (TASK-10)
│   └── client/       # Frontend — React (TASK-09)
├── infra/
│   ├── kafka/        # Script de criação de tópicos
│   ├── mongo/        # Init replica set
│   ├── postgres/     # Init extensions
│   ├── rabbitmq/     # Configuração RabbitMQ
│   └── healthcheck.sh
├── docs/
│   ├── RFC.md        # Decisões arquiteturais
│   └── PRD.md        # Product Requirements
├── docker-compose.yml
├── .env.example
└── Makefile
```

## Stack de Infraestrutura

| Serviço | Tecnologia | Porta |
|---------|-----------|-------|
| Kafka (KRaft) | Confluent Platform 7.6 | 9092 |
| MongoDB | 7.0 (replica set `rs0`) | 27017 |
| PostgreSQL | 16 | 5432 |
| RabbitMQ | 3.13 management | 5672 / 15672 |
| Redis | 7 | 6379 |
| Redpanda Console | v2.4 | 8080 |

## Pré-requisitos

- **Node.js** >= 20 (`nvm use 20`)
- **Docker** >= 24 + **Docker Compose** v2
- **npm** >= 10

## Quick Start

```bash
# 1. Sobe toda a infra
make up

# 2. Aguarda todos os serviços ficarem healthy
make wait

# 3. Verifica saúde dos serviços
make health

# 4. Inicia o Bank A em modo desenvolvimento
npm run bank-a:dev
```

## Commits

Este projeto usa [Conventional Commits](https://www.conventionalcommits.org/).

```bash
# Commit interativo via Commitizen
npm run commit
```

**Escopos válidos:** `bank-a` · `bank-b` · `infra` · `ci` · `docs` · `deps` · `release`

**Exemplos:**

```
feat(bank-a): adiciona mutation initiateTransfer no GraphQL
fix(infra): corrige healthcheck do RabbitMQ
docs(docs): atualiza RFC com diagrama de falha
chore(deps): atualiza NestJS para v11
```

## Comandos úteis

```bash
make up           # Sobe a infra completa
make down         # Para a infra
make reset        # Para + limpa volumes + sobe novamente
make health       # Verifica todos os serviços
make logs s=kafka # Logs de um serviço específico
make mongo-shell  # Abre shell do MongoDB

npm run bank-a:dev    # Inicia Bank A em watch mode
npm run bank-a:test   # Roda testes do Bank A
npm run infra:health  # Healthcheck completo
```

## Documentação

- [RFC — Decisões Arquiteturais](docs/RFC.md)
- [PRD — Requisitos do Produto](docs/PRD.md)
