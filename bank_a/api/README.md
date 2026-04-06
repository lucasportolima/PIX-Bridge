# Bank A — API (NestJS)

Backend do Banco A. Expõe uma API GraphQL para o frontend Vue.js e se comunica com o Bank B via Kafka.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | NestJS 11 · Node.js 20 |
| API | GraphQL (Apollo Server 5) |
| Banco de Dados | MongoDB 7 (Mongoose) — replica set `rs0` |
| Mensageria | Kafka (KafkaJS) — Transactional Outbox |
| Auth | JWT RS256 (access 15m / refresh 7d) |
| Logger | Pino — JSON estruturado + `traceId` W3C |
| Config | `@nestjs/config` + validação Zod |
| AI | OpenAI Function Calling (`gpt-4o-mini`) |

## Módulos

```
src/
├── config/              # Zod env validation · TypedConfigService · Pino options
├── modules/
│   ├── account/         # UserSchema · AccountService · AccountResolver
│   ├── auth/            # JWT strategy · JwtAuthGuard · AuthService
│   ├── transfer/        # TransferSchema · TransferService (transação MongoDB)
│   ├── outbox/          # OutboxEventSchema · OutboxService (Transactional Outbox)
│   ├── kafka/           # KafkaService (producer lazy)
│   └── ai/              # AiService (LLM Function Calling)
└── app.module.ts        # Raiz: ConfigModule · LoggerModule · MongooseModule · GraphQLModule
```

## Pré-requisitos

- **Node.js** 20+ — `nvm use 20`
- Infra Docker rodando (`make up` na raiz)

## Configuração

```bash
# Copie o template
cp ../../.env.example .env

# Edite as variáveis obrigatórias
# MONGODB_URI, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, OPENAI_API_KEY
```

### Variáveis de ambiente

| Variável | Obrigatório | Padrão | Descrição |
|----------|-------------|--------|-----------|
| `NODE_ENV` | | `development` | Ambiente de execução |
| `PORT` | | `3000` | Porta HTTP |
| `MONGODB_URI` | ✓ | — | URI do MongoDB com `?replicaSet=rs0&directConnection=true` |
| `KAFKA_BROKERS` | ✓ | — | Lista separada por vírgula: `localhost:9092` |
| `JWT_PRIVATE_KEY` | ✓ | — | Chave privada RSA em PEM (com `\n` escapados) |
| `JWT_PUBLIC_KEY` | ✓ | — | Chave pública RSA em PEM (com `\n` escapados) |
| `OPENAI_API_KEY` | ✓ | — | API key da OpenAI |
| `REDIS_URL` | | `redis://localhost:6379` | URL do Redis |

## Desenvolvimento

```bash
# Instala dependências
npm install

# Inicia em watch mode (hot-reload)
npm run start:dev

# Ou via raiz do monorepo
npm run bank-a:dev
```

A API estará disponível em:
- **GraphQL Playground:** http://localhost:3000/graphql
- **Health check:** http://localhost:3000/health

## Testes

```bash
npm run test          # Unit tests (Jest)
npm run test:watch    # Watch mode
npm run test:cov      # Coverage report
npm run test:e2e      # End-to-end tests
```

## Lint e Formatação

```bash
npm run lint          # ESLint (flat config)
npm run lint:fix      # ESLint com auto-fix
npm run format        # Prettier
```

## Design Patterns Implementados

### Transactional Outbox

O `TransferService.initiateOutbound()` executa dentro de uma transação MongoDB que atomicamente:
1. Debita o saldo do remetente (`findOneAndUpdate` com `$gte` — check-and-set atômico)
2. Cria o documento `Transfer`
3. Cria o `OutboxEvent` com o payload Kafka

Um worker futuro (TASK-06) lê os eventos `status: pending` e os publica no Kafka, garantindo entrega at-least-once sem dual-write.

### Optimistic Locking

O campo `__v` do Mongoose (version key) previne conflitos de escrita concorrente no saldo — se dois processos tentarem debitar o mesmo saldo simultaneamente, apenas um vence.
