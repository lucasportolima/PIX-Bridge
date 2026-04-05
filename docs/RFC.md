# RFC-001: PIX-Bridge — Simulador de Transferência Interbancária com GenAI e Arquitetura Orientada a Eventos

**Status:** Proposto  
**Autor:** Engenharia  
**Data:** 05/04/2026  
**Revisão:** 1.0.0

---

## Índice

1. [Resumo](#1-resumo)
2. [Motivação e Objetivos](#2-motivação-e-objetivos)
3. [Visão Geral da Arquitetura](#3-visão-geral-da-arquitetura)
4. [Diagrama de Componentes](#4-diagrama-de-componentes)
5. [Diagramas de Comunicação](#5-diagramas-de-comunicação)
6. [Modelos de Dados](#6-modelos-de-dados)
7. [Contratos de API](#7-contratos-de-api)
8. [Schemas de Eventos (Tópicos Kafka)](#8-schemas-de-eventos-tópicos-kafka)
9. [Padrões de Design Críticos](#9-padrões-de-design-críticos)
10. [Autenticação e Autorização](#10-autenticação-e-autorização)
11. [Observabilidade](#11-observabilidade)
12. [Histórias de Usuário Complementares](#12-histórias-de-usuário-complementares)
13. [Quebra de Tarefas](#13-quebra-de-tarefas)
14. [Plano de Deploy](#14-plano-de-deploy)
15. [Registro de Riscos](#15-registro-de-riscos)

---

## 1. Resumo

O PIX-Bridge simula uma transferência instantânea entre dois bancos independentes, inspirado no fluxo real do Pix/BACEN. O sistema demonstra coreografia de eventos, transações distribuídas, interpretação de comandos via GenAI, controle de concorrência, idempotência e observabilidade completa em uma arquitetura poliglota (Node.js, Python, Vue, React, MongoDB, PostgreSQL, Kafka, RabbitMQ).

---

## 2. Motivação e Objetivos

| Objetivo | Descrição |
|----------|-----------|
| **Arquitetura Orientada a Eventos** | Provar coreografia entre dois contextos delimitados independentes, sem orquestrador central |
| **Consistência Distribuída** | Garantir que nenhum centavo se perca ou seja duplicado entre dois bancos de dados e dois runtimes distintos |
| **Integração com GenAI** | LLM Function Calling como padrão real de UX para comandos financeiros em linguagem natural |
| **Resiliência** | O sistema deve sobreviver a falhas parciais com recuperação automática |
| **Observabilidade** | Propagação de trace completa desde o browser até o worker Python e de volta |

---

## 3. Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              SISTEMA PIX-BRIDGE                                     │
│                                                                                     │
│   ┌──────────────── DOMÍNIO BANCO A ──────────────────┐                             │
│   │                                                   │                             │
│   │   ┌───────────┐   GraphQL    ┌──────────────┐     │                             │
│   │   │  Vue.js 3  │◄──────────► │   NestJS     │     │                             │
│   │   │ (Frontend) │             │  (Backend)   │     │                             │
│   │   └───────────┘             └──────┬───────┘     │                             │
│   │                                    │              │                             │
│   │                          ┌─────────▼────────┐     │                             │
│   │                          │    MongoDB A     │     │                             │
│   │                          │  (usuários,      │     │                             │
│   │                          │   transações,    │     │                             │
│   │                          │   outbox)        │     │                             │
│   │                          └─────────┬────────┘     │                             │
│   │                                    │ Outbox        │                             │
│   │                          ┌─────────▼────────┐     │                             │
│   │                          │  Worker Outbox   │     │                             │
│   │                          │  (cron NestJS)   │     │                             │
│   └──────────────────────────┴──────────┬───────┘     │                             │
│                                         │              │                             │
│   ┌──────────────────── CLUSTER KAFKA ──┼──────────────────────────────┐             │
│   │          ("BACEN / Rede de Clearing") │                            │             │
│   │                                     │                             │             │
│   │   Tópicos:                          │  Produtores/Consumidores    │             │
│   │   ► pix.transfer.initiated ─────────┤◄──── NestJS Banco A         │             │
│   │   ► pix.transfer.completed ─────────┤──── ► NestJS Banco A        │             │
│   │   ► pix.transfer.failed    ─────────┤──── ► NestJS Banco A        │             │
│   │                                     │                             │             │
│   │                           ┌─────────┤◄──── FastAPI Banco B        │             │
│   │                           │         │                             │             │
│   └───────────────────────────┼─────────┴─────────────────────────────┘             │
│                               │                                                     │
│   ┌──────────────── DOMÍNIO BANCO B ────┼──────────────────────────┐                │
│   │                           │         │                          │                │
│   │   ┌──────────────────┐    │    ┌────▼──────────┐               │                │
│   │   │    RabbitMQ B    │◄───┘    │  FastAPI      │               │                │
│   │   │  (DLQ interna    │         │  Worker       │               │                │
│   │   │   & retry bus)   │────────►│  (Consumidor) │               │                │
│   │   └──────────────────┘         └──────┬────────┘               │                │
│   │                                       │                        │                │
│   │                             ┌─────────▼────────┐               │                │
│   │                             │  PostgreSQL B    │               │                │
│   │                             │ (contas,         │               │                │
│   │                             │  saldos,         │               │                │
│   │                             │  transações,     │               │                │
│   │                             │  idempotência)   │               │                │
│   │                             └──────────────────┘               │                │
│   │                                                                │                │
│   │   ┌───────────┐   REST/SSE   ┌──────────────┐                  │                │
│   │   │  React    │◄────────────►│  FastAPI     │                  │                │
│   │   │ Dashboard │             │  (API HTTP)  │                  │                │
│   │   └───────────┘             └──────────────┘                  │                │
│   └────────────────────────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Design da Ponte de Mensageria

O Banco A e o Banco B se conectam ao **mesmo cluster Kafka** (representando a rede de compensação interbancária / BACEN). O Banco B utiliza adicionalmente o **RabbitMQ internamente** para sua própria topologia de DLQ e retentativas, isolando o tratamento de falhas internas do protocolo interbancário.

```
Kafka (inter-banco)  ──────►  Consumidor Kafka Banco B  ──────►  RabbitMQ (interno B)
                                                                        │
                                                              ┌─────────▼──────────┐
                                                              │   Fila Principal   │
                                                              │   (process.pix)    │
                                                              └─────────┬──────────┘
                                                                        │ falha
                                                              ┌─────────▼──────────┐
                                                              │   Fila DLQ         │
                                                              │   (pix.dlq)        │
                                                              └────────────────────┘
```

---

## 4. Diagrama de Componentes

```mermaid
graph TB
    subgraph "Domínio Banco A"
        VUE[Vue.js 3<br/>Auth + Dashboard<br/>Input IA para Transferência]
        NESTJS[NestJS<br/>API GraphQL<br/>Módulo Auth<br/>Módulo Transferência<br/>Módulo IA<br/>Produtor/Consumidor Kafka<br/>Worker Outbox]
        MONGO[(MongoDB<br/>usuários<br/>contas<br/>transações<br/>outbox)]
        LLM[OpenAI / Gemini<br/>Function Calling]
    end

    subgraph "Rede de Clearing"
        KAFKA[Apache Kafka<br/>pix.transfer.initiated<br/>pix.transfer.completed<br/>pix.transfer.failed]
    end

    subgraph "Domínio Banco B"
        REACT[React Dashboard<br/>Extrato<br/>Saldo]
        FASTAPI_HTTP[FastAPI HTTP<br/>Endpoints Auth<br/>Endpoints Conta<br/>Endpoints Extrato]
        FASTAPI_WORKER[FastAPI Worker<br/>Consumidor Kafka<br/>Publicador RabbitMQ]
        RABBIT[RabbitMQ<br/>fila process.pix<br/>fila pix.dlq]
        PG[(PostgreSQL<br/>usuários<br/>contas<br/>saldos<br/>transações<br/>transferências_processadas)]
    end

    VUE -->|GraphQL HTTP/WS| NESTJS
    NESTJS -->|mongoose| MONGO
    NESTJS -->|HTTP| LLM
    NESTJS -->|produz| KAFKA
    KAFKA -->|consome| NESTJS
    KAFKA -->|consome| FASTAPI_WORKER
    FASTAPI_WORKER -->|publica internamente| RABBIT
    RABBIT -->|consome| FASTAPI_WORKER
    FASTAPI_WORKER -->|sqlalchemy| PG
    FASTAPI_WORKER -->|produz| KAFKA
    REACT -->|REST/SSE| FASTAPI_HTTP
    FASTAPI_HTTP -->|sqlalchemy| PG
```

---

## 5. Diagramas de Comunicação

### 5.1 Caminho Feliz — Transferência Bem-Sucedida

```mermaid
sequenceDiagram
    autonumber
    actor UsuarioA as Usuário A (Navegador)
    participant VUE as Vue.js Frontend
    participant NEST as NestJS (Banco A)
    participant LLM as LLM (OpenAI)
    participant MONGO as MongoDB A
    participant OUTBOX as Worker Outbox
    participant KAFKA as Cluster Kafka
    participant WORKER as Worker FastAPI (Banco B)
    participant RABBIT as RabbitMQ (Banco B)
    participant PG as PostgreSQL B
    participant REACT as React Dashboard (Banco B)

    UsuarioA->>VUE: Digita "Mande 100 reais para a conta B-001"
    VUE->>NEST: mutation initiateAITransfer(input: "Mande 100 reais para a conta B-001")
    Note over VUE,NEST: Header: x-trace-id = uuid_gerado_no_browser

    NEST->>LLM: POST /chat/completions (function_calling)<br/>tools: [parseTransferCommand]
    LLM-->>NEST: { toAccount: "B-001", amount: 10000, currency: "BRL" }

    NEST->>MONGO: session.startTransaction()
    NEST->>MONGO: findOneAndUpdate(conta, {$inc: {saldo: -10000}},<br/>{condição: saldo >= 10000}) [lock otimista via version]
    MONGO-->>NEST: conta atualizada (saldo: 90000 centavos)
    NEST->>MONGO: inserir transação { transferId, status: PROCESSING, traceId }
    NEST->>MONGO: inserir outbox { transferId, eventType: TRANSFER_INITIATED, payload }
    NEST->>MONGO: session.commitTransaction()
    MONGO-->>NEST: OK

    NEST-->>VUE: { transferId, status: "PROCESSING" }
    VUE-->>UsuarioA: "Transferência em processamento..."

    loop Polling Outbox (a cada 500ms)
        OUTBOX->>MONGO: buscar outbox onde publishedAt = null, limit 50
        MONGO-->>OUTBOX: [registros outbox]
        OUTBOX->>KAFKA: produzir pix.transfer.initiated<br/>{ transferId, fromAccount, toAccount, amount, traceId }
        OUTBOX->>MONGO: atualizar outbox { publishedAt: now }
    end

    KAFKA->>WORKER: consumir pix.transfer.initiated
    WORKER->>RABBIT: publicar na fila process.pix
    RABBIT->>WORKER: consumir process.pix

    WORKER->>PG: SELECT 1 FROM processed_transfers WHERE transfer_id = ?
    PG-->>WORKER: (vazio — ainda não processado)

    WORKER->>PG: BEGIN
    WORKER->>PG: SELECT * FROM balances WHERE account_id = 'B-001' FOR UPDATE
    PG-->>WORKER: { amount: 50000 centavos }
    WORKER->>PG: UPDATE balances SET amount = 60000 WHERE account_id = 'B-001'
    WORKER->>PG: INSERT INTO transactions (transfer_id, amount, status, trace_id)
    WORKER->>PG: INSERT INTO processed_transfers (transfer_id, processed_at)
    WORKER->>PG: COMMIT
    PG-->>WORKER: OK

    WORKER->>KAFKA: produzir pix.transfer.completed<br/>{ transferId, status: SUCCESS, traceId }

    KAFKA->>NEST: consumir pix.transfer.completed
    NEST->>MONGO: atualizar transação { status: COMPLETED, completedAt: now }
    MONGO-->>NEST: OK

    VUE->>NEST: subscription onTransactionUpdated(transferId)
    NEST-->>VUE: { status: "COMPLETED" }
    VUE-->>UsuarioA: "Transferência concluída!"

    REACT->>WORKER: GET /api/v1/accounts/B-001/statement (polling ou SSE)
    WORKER-->>REACT: [{ transferId, amount: +10000, status: COMPLETED, ... }]
```

---

### 5.2 Banco B Indisponível — Retentativa via Kafka + DLQ

```mermaid
sequenceDiagram
    autonumber
    participant OUTBOX as Worker Outbox (Banco A)
    participant KAFKA as Cluster Kafka
    participant WORKER as Worker FastAPI (Banco B)
    participant RABBIT as RabbitMQ DLQ

    Note over WORKER: Banco B está FORA DO AR

    OUTBOX->>KAFKA: produzir pix.transfer.initiated
    Note over KAFKA: Mensagem persistida no Kafka<br/>(retenção: 7 dias)

    loop Banco B indisponível
        WORKER--xKAFKA: Offset do consumer group não confirmado<br/>(Kafka retém a mensagem)
    end

    Note over WORKER: Banco B SE RECUPERA

    WORKER->>KAFKA: Consumidor reconecta, retoma a partir do último offset confirmado
    KAFKA->>WORKER: pix.transfer.initiated (reprocessado)
    WORKER->>RABBIT: publicar em process.pix

    Note over WORKER: Processamento prossegue normalmente
    WORKER->>KAFKA: produzir pix.transfer.completed
```

---

### 5.3 Mensagem Duplicada — Guarda de Idempotência

```mermaid
sequenceDiagram
    autonumber
    participant KAFKA as Cluster Kafka
    participant WORKER as Worker FastAPI (Banco B)
    participant PG as PostgreSQL B

    KAFKA->>WORKER: consumir pix.transfer.initiated (transfer_id: abc-123)
    WORKER->>PG: SELECT 1 FROM processed_transfers WHERE transfer_id = 'abc-123'
    PG-->>WORKER: (vazio)
    WORKER->>PG: BEGIN ... creditar ... INSERT processed_transfers ... COMMIT
    WORKER->>KAFKA: produzir pix.transfer.completed

    Note over KAFKA,WORKER: Falha de rede — offset não confirmado<br/>Kafka reenvia a mesma mensagem

    KAFKA->>WORKER: consumir pix.transfer.initiated (transfer_id: abc-123) [duplicado]
    WORKER->>PG: SELECT 1 FROM processed_transfers WHERE transfer_id = 'abc-123'
    PG-->>WORKER: (1 linha — já processado)
    WORKER-->>WORKER: IGNORAR — guarda de idempotência ativada, sem duplo crédito
    WORKER->>KAFKA: ACK (confirmar offset)
```

---

### 5.4 Falha na Transferência — Fluxo de Estorno

```mermaid
sequenceDiagram
    autonumber
    participant NEST as NestJS (Banco A)
    participant KAFKA as Cluster Kafka
    participant WORKER as Worker FastAPI (Banco B)
    participant PG as PostgreSQL B
    participant MONGO as MongoDB A

    KAFKA->>WORKER: consumir pix.transfer.initiated
    WORKER->>PG: BEGIN
    WORKER->>PG: SELECT * FROM balances FOR UPDATE
    Note over PG: Conta B-001 NÃO EXISTE ou está BLOQUEADA
    WORKER->>PG: ROLLBACK
    WORKER->>KAFKA: produzir pix.transfer.failed<br/>{ transferId, reason: "ACCOUNT_NOT_FOUND", traceId }

    KAFKA->>NEST: consumir pix.transfer.failed
    NEST->>MONGO: session.startTransaction()
    NEST->>MONGO: atualizar transação { status: FAILED }
    NEST->>MONGO: atualizar conta { $inc: { saldo: +10000 } }  ← estorno
    NEST->>MONGO: session.commitTransaction()
    NEST-->>NEST: emitir evento de subscription GraphQL (FAILED)
```

---

### 5.5 Transferência Iniciada pelo Banco B → Banco A (US13)

```mermaid
sequenceDiagram
    autonumber
    actor UsuarioB as Usuário B (Navegador)
    participant REACT as React Dashboard
    participant FASTAPI_HTTP as FastAPI HTTP (Banco B)
    participant PG as PostgreSQL B
    participant KAFKA as Cluster Kafka
    participant NEST as NestJS (Banco A)
    participant MONGO as MongoDB A
    participant VUE as Vue.js (Banco A)

    UsuarioB->>REACT: Preenche formulário: enviar R$50 para A-001
    REACT->>FASTAPI_HTTP: POST /api/v1/transfers { toAccount: "A-001", amount: 5000 }

    FASTAPI_HTTP->>PG: BEGIN
    FASTAPI_HTTP->>PG: SELECT * FROM balances WHERE account_id = 'B-001' FOR UPDATE
    PG-->>FASTAPI_HTTP: { amount: 60000 }
    FASTAPI_HTTP->>PG: UPDATE balances SET amount = 55000
    FASTAPI_HTTP->>PG: INSERT INTO transactions { status: PROCESSING, direction: OUTBOUND }
    FASTAPI_HTTP->>PG: COMMIT

    FASTAPI_HTTP->>KAFKA: produzir pix.transfer.initiated<br/>{ fromAccount: "B-001", toAccount: "A-001", amount: 5000 }
    FASTAPI_HTTP-->>REACT: { transferId, status: "PROCESSING" }

    KAFKA->>NEST: consumir pix.transfer.initiated (origem Banco B)
    NEST->>MONGO: BEGIN SESSION
    NEST->>MONGO: findOneAndUpdate conta A-001 { $inc: { saldo: +5000 } }
    NEST->>MONGO: INSERT transação { status: COMPLETED, direction: INBOUND }
    NEST->>MONGO: COMMIT SESSION

    NEST->>KAFKA: produzir pix.transfer.completed

    KAFKA->>FASTAPI_HTTP: consumir pix.transfer.completed
    FASTAPI_HTTP->>PG: UPDATE transactions SET status = 'COMPLETED'

    VUE-->>UsuarioA: Notificação via GraphQL Subscription: +R$50,00 recebido
```

---

## 6. Modelos de Dados

### 6.1 Banco A — Coleções MongoDB

#### Coleção: `users`

```typescript
interface UserDocument {
  _id: ObjectId;
  accountNumber: string;          // "A-001" — índice único
  fullName: string;
  email: string;                  // índice único
  passwordHash: string;           // bcrypt, rounds: 12
  balance: number;                // em centavos (inteiro) ex: 10000 = R$100,00
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  __v: number;                    // version key do Mongoose (lock otimista)
}
```

> **Nota de Concorrência:** O campo `__v` (Mongoose `versionKey`) é utilizado para controle de concorrência otimista. A operação de débito usa `findOneAndUpdate` com filtro `balance >= amount` + `$inc`, tornando-a atômica no nível do documento MongoDB.

#### Coleção: `transactions`

```typescript
type TransactionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

interface TransactionDocument {
  _id: ObjectId;
  transferId: string;             // UUID v4 — chave única global
  fromAccountNumber: string;      // conta do Banco A
  toAccountNumber: string;        // conta do Banco B
  amount: number;                 // em centavos
  currency: 'BRL';
  status: TransactionStatus;
  direction: 'OUTBOUND' | 'INBOUND';
  traceId: string;                // UUID propagado desde o browser
  failureReason?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
// Índices: { transferId: 1 } unique, { fromAccountNumber: 1 }, { status: 1 }
```

#### Coleção: `outbox`

```typescript
type OutboxEventType = 'TRANSFER_INITIATED' | 'TRANSFER_REVERSED';

interface OutboxDocument {
  _id: ObjectId;
  transferId: string;
  eventType: OutboxEventType;
  topic: string;                  // ex: "pix.transfer.initiated"
  payload: Record<string, unknown>;
  publishedAt?: Date;             // null = ainda não publicado
  retryCount: number;             // padrão 0
  lastError?: string;
  createdAt: Date;
}
// Índice: { publishedAt: 1 } para polling eficiente
// Índice TTL em publishedAt (limpeza após 30 dias)
```

---

### 6.2 Banco B — Schema PostgreSQL

```sql
-- ──────────────────────────────────────────
-- SCHEMA: bank_b
-- ──────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number  VARCHAR(20)  NOT NULL UNIQUE,   -- "B-001"
    full_name       VARCHAR(200) NOT NULL,
    email           VARCHAR(254) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,           -- bcrypt
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    account_number  VARCHAR(20)  NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Saldos em tabela SEPARADA para permitir lock granular por linha
CREATE TABLE balances (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID         NOT NULL UNIQUE REFERENCES accounts(id),
    amount          BIGINT       NOT NULL DEFAULT 0 CHECK (amount >= 0),  -- em centavos
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TYPE transaction_status AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED');
CREATE TYPE transaction_direction AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TABLE transactions (
    id                   UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id          VARCHAR(36)           NOT NULL UNIQUE,   -- UUID vindo do Banco A
    account_id           UUID                  NOT NULL REFERENCES accounts(id),
    counterpart_account  VARCHAR(20)           NOT NULL,
    amount               BIGINT                NOT NULL,          -- em centavos, sempre positivo
    direction            transaction_direction  NOT NULL,
    status               transaction_status     NOT NULL DEFAULT 'PROCESSING',
    trace_id             VARCHAR(36)           NOT NULL,
    failure_reason       TEXT,
    completed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_created ON transactions(created_at DESC);

-- Tabela de guarda de idempotência
CREATE TABLE processed_transfers (
    transfer_id     VARCHAR(36)  PRIMARY KEY,
    processed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    result          VARCHAR(20)  NOT NULL  -- 'SUCCESS' | 'FAILED'
);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at        BEFORE UPDATE ON users        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_balances_updated_at     BEFORE UPDATE ON balances      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON transactions  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Caminho crítico — Débito/Crédito com lock de linha:**

```sql
-- Lógica de crédito no Banco B (executada dentro do worker FastAPI)
BEGIN;

-- Lock no nível da linha — bloqueia atualizações concorrentes na mesma linha de saldo
SELECT amount
  FROM balances
 WHERE account_id = :account_id
   FOR UPDATE;

-- Variante NOWAIT usada na prática para falhar rápido sob contenção:
-- SELECT ... FOR UPDATE NOWAIT;

UPDATE balances
   SET amount = amount + :credit_amount
 WHERE account_id = :account_id;

INSERT INTO transactions
       (transfer_id, account_id, counterpart_account, amount, direction, status, trace_id)
VALUES (:transfer_id, :account_id, :from_account, :amount, 'INBOUND', 'COMPLETED', :trace_id);

INSERT INTO processed_transfers (transfer_id, result)
VALUES (:transfer_id, 'SUCCESS');

COMMIT;
```

---

## 7. Contratos de API

### 7.1 Banco A — Schema GraphQL

```graphql
# ─── Escalares ────────────────────────────────────────────
scalar DateTime
scalar Centavos  # Inteiro representando centavos de BRL

# ─── Auth ─────────────────────────────────────────────────
type AuthPayload {
  accessToken: String!
  expiresIn: Int!
  user: User!
}

type User {
  id: ID!
  accountNumber: String!
  fullName: String!
  email: String!
  balance: Centavos!
  createdAt: DateTime!
}

# ─── Transações ───────────────────────────────────────────
enum TransactionStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  REVERSED
}

enum TransactionDirection {
  INBOUND
  OUTBOUND
}

type Transaction {
  id: ID!
  transferId: String!
  fromAccountNumber: String!
  toAccountNumber: String!
  amount: Centavos!
  currency: String!
  status: TransactionStatus!
  direction: TransactionDirection!
  traceId: String!
  failureReason: String
  completedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}

type PaginatedTransactions {
  items: [Transaction!]!
  total: Int!
  page: Int!
  pageSize: Int!
}

# ─── Transferência via IA ──────────────────────────────────
type AITransferIntent {
  toAccountNumber: String!
  amount: Centavos!
  currency: String!
  confidence: Float!
  rawInput: String!
}

type InitiateTransferPayload {
  transaction: Transaction!
  aiIntent: AITransferIntent
}

# ─── Queries ───────────────────────────────────────────────
type Query {
  me: User!
  myTransactions(page: Int = 1, pageSize: Int = 20): PaginatedTransactions!
  transaction(transferId: String!): Transaction
}

# ─── Mutations ─────────────────────────────────────────────
input LoginInput {
  email: String!
  password: String!
}

input RegisterInput {
  fullName: String!
  email: String!
  password: String!
  initialBalance: Centavos
}

input TransferInput {
  toAccountNumber: String!
  amount: Centavos!
}

type Mutation {
  login(input: LoginInput!): AuthPayload!
  register(input: RegisterInput!): AuthPayload!

  # Transferência padrão (formulário estruturado)
  initiateTransfer(input: TransferInput!): InitiateTransferPayload!

  # Transferência via IA (texto livre)
  initiateAITransfer(rawCommand: String!): InitiateTransferPayload!
}

# ─── Subscriptions ─────────────────────────────────────────
type Subscription {
  onTransactionUpdated(transferId: String!): Transaction!
  onAccountBalanceUpdated: User!  # para o usuário autenticado
}
```

**Exemplo de Query — Listar minhas transações:**

```graphql
query GetMyTransactions {
  myTransactions(page: 1, pageSize: 10) {
    items {
      transferId
      amount
      direction
      status
      toAccountNumber
      createdAt
    }
    total
  }
}
```

**Exemplo de Mutation — Transferência via IA:**

```graphql
mutation AITransfer {
  initiateAITransfer(rawCommand: "Manda cem reais pra conta B-042 urgente") {
    aiIntent {
      toAccountNumber
      amount
      confidence
    }
    transaction {
      transferId
      status
      createdAt
    }
  }
}
```

**Exemplo de Subscription:**

```graphql
subscription WatchTransfer {
  onTransactionUpdated(transferId: "550e8400-e29b-41d4-a716-446655440000") {
    transferId
    status
    completedAt
    failureReason
  }
}
```

---

### 7.2 Banco B — Endpoints REST FastAPI

**Base URL:** `https://banco-b.dominio/api/v1`

#### Autenticação

```
POST /auth/register
POST /auth/login
POST /auth/refresh
```

**POST /auth/login — Requisição:**
```json
{
  "email": "ana@bancob.com",
  "password": "S3cure!Pass"
}
```
**Resposta 200:**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

#### Contas e Saldos

```
GET  /accounts/me                        → ContaComSaldo
GET  /accounts/{account_number}          → ResumoConta (consulta pública)
GET  /accounts/me/statement              → ExtratosPaginados
GET  /accounts/me/statement/stream       → SSE stream (atualizações em tempo real)
POST /transfers                          → IniciarTransferência (Banco B → Banco A)
```

**GET /accounts/me — Resposta 200:**
```json
{
  "accountNumber": "B-001",
  "fullName": "Ana Lima",
  "balance": 60000,
  "balanceFormatted": "R$ 600,00",
  "updatedAt": "2026-04-05T14:32:01Z"
}
```

**GET /accounts/me/statement?page=1&page_size=20 — Resposta 200:**
```json
{
  "items": [
    {
      "transferId": "550e8400-e29b-41d4-a716-446655440000",
      "counterpartAccount": "A-001",
      "amount": 10000,
      "amountFormatted": "R$ 100,00",
      "direction": "INBOUND",
      "status": "COMPLETED",
      "traceId": "a1b2c3d4-...",
      "completedAt": "2026-04-05T14:32:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

**POST /transfers — Requisição:**
```json
{
  "toAccountNumber": "A-001",
  "amount": 5000,
  "description": "Pagamento serviços"
}
```
**Resposta 202:**
```json
{
  "transferId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "status": "PROCESSING",
  "amount": 5000,
  "amountFormatted": "R$ 50,00",
  "toAccountNumber": "A-001",
  "createdAt": "2026-04-05T15:00:00Z"
}
```

---

### 7.3 Banco A — Módulo IA (LLM Function Calling)

**Definição da Tool enviada à OpenAI:**

```typescript
const parseTransferCommandTool = {
  type: "function",
  function: {
    name: "parseTransferCommand",
    description: "Extrai uma intenção de transferência PIX estruturada a partir de texto em português brasileiro.",
    parameters: {
      type: "object",
      properties: {
        toAccountNumber: {
          type: "string",
          description: "Número da conta destino (ex: 'B-001', 'B042')"
        },
        amount: {
          type: "integer",
          description: "Valor em centavos de BRL. 'cem reais' = 10000, '1,50' = 150"
        },
        currency: {
          type: "string",
          enum: ["BRL"],
          description: "Moeda, sempre BRL"
        },
        confidence: {
          type: "number",
          description: "Pontuação de confiança de 0.0 a 1.0"
        }
      },
      required: ["toAccountNumber", "amount", "currency", "confidence"]
    }
  }
};
```

**System Prompt:**
```
Você é um assistente financeiro de um banco brasileiro. Seu ÚNICO trabalho é chamar a
função parseTransferCommand para extrair a intenção de transferência da entrada do usuário.
Se o valor ou número de conta for ambíguo, defina confidence abaixo de 0.7.
O valor deve sempre estar em centavos de BRL (inteiro). Nunca invente números de conta.
```

**Tabela de exemplos Input → Output:**

| Entrada do Usuário | toAccountNumber | amount | confidence |
|---|---|---|---|
| "Manda 100 reais pra B-001" | "B-001" | 10000 | 0.99 |
| "cento e cinquenta pra conta B042" | "B-042" | 15000 | 0.92 |
| "manda uma grana pra joão" | — | — | 0.10 (rejeitado) |
| "transfere R$ 1.500,00 para B-007" | "B-007" | 150000 | 0.98 |
| "paga cinquenta reais pro B" | — | 5000 | 0.45 (rejeitado) |

> **Limiar:** Se `confidence < 0.7`, a API retorna erro `400 BAD_AI_CONFIDENCE` e solicita que o usuário reformule o comando.

---

## 8. Schemas de Eventos (Tópicos Kafka)

Todas as mensagens são serializadas como **JSON** com um schema de envelope:

```typescript
interface KafkaMessageEnvelope<T> {
  specversion: "1.0";                    // CloudEvents spec
  id: string;                            // UUID — chave da mensagem Kafka
  source: "bank-a" | "bank-b";
  type: string;                          // tipo do evento
  datacontenttype: "application/json";
  time: string;                          // ISO-8601
  traceparent: string;                   // W3C TraceContext (propagação do trace_id)
  data: T;
}
```

### Tópico: `pix.transfer.initiated`

**Produtor:** Banco A (Worker Outbox)  
**Consumidor:** Banco B (Worker FastAPI)  
**Chave de partição:** `toAccountNumber` (garante ordem por conta destino)

```json
{
  "specversion": "1.0",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "source": "bank-a",
  "type": "pix.transfer.initiated",
  "datacontenttype": "application/json",
  "time": "2026-04-05T14:30:00.000Z",
  "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  "data": {
    "transferId": "550e8400-e29b-41d4-a716-446655440000",
    "fromAccountNumber": "A-001",
    "toAccountNumber": "B-001",
    "amount": 10000,
    "currency": "BRL",
    "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "initiatedAt": "2026-04-05T14:30:00.000Z"
  }
}
```

### Tópico: `pix.transfer.completed`

**Produtor:** Banco B (Worker FastAPI)  
**Consumidor:** Banco A (NestJS)

```json
{
  "specversion": "1.0",
  "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "source": "bank-b",
  "type": "pix.transfer.completed",
  "time": "2026-04-05T14:30:01.500Z",
  "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  "data": {
    "transferId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "SUCCESS",
    "creditedAccountNumber": "B-001",
    "creditedAmount": 10000,
    "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "completedAt": "2026-04-05T14:30:01.500Z"
  }
}
```

### Tópico: `pix.transfer.failed`

**Produtor:** Banco B (Worker FastAPI)  
**Consumidor:** Banco A (NestJS)

```json
{
  "specversion": "1.0",
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "source": "bank-b",
  "type": "pix.transfer.failed",
  "time": "2026-04-05T14:30:01.000Z",
  "traceparent": "00-0af7651916cd43dd8448eb211c80319c-...",
  "data": {
    "transferId": "550e8400-e29b-41d4-a716-446655440000",
    "reason": "ACCOUNT_NOT_FOUND",
    "reasonDescription": "A conta B-999 não existe",
    "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "failedAt": "2026-04-05T14:30:01.000Z"
  }
}
```

**Códigos de razão de falha:**

| Código | Descrição |
|--------|-----------|
| `ACCOUNT_NOT_FOUND` | Conta destino não existe no Banco B |
| `ACCOUNT_BLOCKED` | Conta congelada/bloqueada |
| `PROCESSING_ERROR` | Erro interno do servidor no Banco B |
| `DUPLICATE_REJECTED` | Nunca deve ocorrer (idempotência trata) — código defensivo |

---

## 9. Padrões de Design Críticos

### 9.1 Transactional Outbox Pattern (Banco A)

**Problema:** Publicar no Kafka dentro de uma transação MongoDB é arriscado. Se o banco confirmar mas a publicação no Kafka falhar (ou vice-versa), os dados ficam inconsistentes.

**Solução:** Escrever na coleção `outbox` dentro da mesma transação MongoDB. Um worker de background independente lê o outbox e publica no Kafka. Isso garante entrega pelo menos uma vez vinculada ao commit do banco.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Transação MongoDB (atômica)                                         │
│                                                                      │
│  1. Debitar saldo da conta                                           │
│  2. Criar transação { status: PROCESSING }                           │
│  3. Inserir outbox { topic, payload, publishedAt: null }  ←── CHAVE  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
          ↓ Confirmada (commit)
┌──────────────────────────────────────────────────────────────────────┐
│  Worker Outbox (NestJS SchedulerRegistry independente / setInterval) │
│                                                                      │
│  LOOP a cada 500ms:                                                  │
│    registros = buscar outbox ONDE publishedAt = null LIMIT 50        │
│    PARA CADA registro:                                               │
│      kafka.produce(registro.topic, registro.payload)                 │
│      atualizar outbox SET publishedAt = now() WHERE _id = registro._id│
│                                                                      │
│  Em falha: incrementar retryCount, definir lastError                 │
│  Dead Letter: retryCount > 5 → alerta + intervenção manual           │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 Padrão de Idempotência (Banco B)

```python
# Pseudocódigo — Worker FastAPI Banco B
async def process_transfer(event: TransferInitiatedEvent, session: AsyncSession):
    # Guarda: verificar antes de adquirir qualquer lock
    existing = await session.execute(
        select(ProcessedTransfer).where(
            ProcessedTransfer.transfer_id == event.data.transfer_id
        )
    )
    if existing.scalar_one_or_none():
        logger.info("transferência_duplicada_ignorada", transfer_id=event.data.transfer_id)
        return  # ACK da mensagem, não fazer nada

    async with session.begin():
        # Lock de linha — bloqueia processamento concorrente da mesma conta
        balance = await session.execute(
            select(Balance)
            .where(Balance.account_id == account.id)
            .with_for_update()
        )
        # ... lógica de crédito ...
        session.add(ProcessedTransfer(
            transfer_id=event.data.transfer_id,
            result="SUCCESS"
        ))
    # COMMIT — registro de idempotência escrito atomicamente com o crédito
```

### 9.3 Controle de Concorrência Otimista (MongoDB — Banco A)

O MongoDB não suporta `SELECT ... FOR UPDATE`. Em vez disso, usamos uma atualização atômica com condição de filtro:

```typescript
// NestJS — Serviço de débito
const updated = await this.userModel.findOneAndUpdate(
  {
    accountNumber: fromAccountNumber,
    balance: { $gte: amountInCents },  // Pré-condição: deve ter saldo suficiente
    isActive: true,
  },
  {
    $inc: { balance: -amountInCents },
  },
  {
    new: true,
    session,  // Dentro da session/transaction MongoDB
  }
);

if (!updated) {
  throw new InsufficientBalanceException(fromAccountNumber, amountInCents);
}
```

### 9.4 Fluxo Completo de Tratamento de Erros

```
Erro de negócio (saldo insuficiente)
  └─► Retorno síncrono 400 — NUNCA publica no Kafka

Erro de infraestrutura (Kafka indisponível)
  └─► Outbox persiste → retry automático quando Kafka voltar

Erro no Banco B (conta não encontrada)
  └─► Publica pix.transfer.failed → NestJS faz estorno do débito

Erro de processamento no Banco B (crash do worker)
  └─► Offset não confirmado → Kafka reenvia → Idempotência guard protege

Retentativas esgotadas no RabbitMQ (> 3)
  └─► Vai para pix.dlq → alerta manual → investigação
```

---

## 10. Autenticação e Autorização

Cada banco mantém autenticação independente. Tokens JWT **não** são compartilhados entre bancos.

### Banco A (NestJS)

- **Estratégia:** JWT (RS256, chaves assimétricas)
- **TTL do Access Token:** 1 hora
- **TTL do Refresh Token:** 7 dias (armazenado em Redis para invalidação)
- **Guards:** `@UseGuards(JwtAuthGuard)` em todos os resolvers protegidos

### Banco B (FastAPI)

- **Estratégia:** JWT (HS256 ou RS256)
- **TTL do Access Token:** 1 hora
- **Dependência FastAPI:** `Depends(get_current_user)` nas rotas protegidas

### Estrutura do Payload JWT (ambos os bancos)

```typescript
interface JwtPayload {
  sub: string;           // userId (UUID)
  accountNumber: string; // "A-001" ou "B-001"
  email: string;
  iat: number;
  exp: number;
  jti: string;           // ID único do token (para revogação)
}
```

### Matriz de Endpoints Públicos vs. Protegidos

| Serviço | Endpoint | Proteção |
|---------|----------|----------|
| NestJS | `mutation login` | Público |
| NestJS | `mutation register` | Público |
| NestJS | `query me`, `mutation initiateTransfer` | JWT obrigatório |
| NestJS | `subscription onTransactionUpdated` | JWT via WS |
| FastAPI | `POST /auth/login` | Público |
| FastAPI | `POST /auth/register` | Público |
| FastAPI | `GET /accounts/me/**` | Bearer JWT |
| FastAPI | `POST /transfers` | Bearer JWT |

---

## 11. Observabilidade

### 11.1 Propagação do Trace ID

Um `traceId` (UUID v4) é gerado no Vue.js no momento da ação do usuário e propagado por todo o sistema:

```
Navegador (gera traceId)
    │
    ▼ HTTP Header: x-trace-id: <uuid>
NestJS (vincula a todos os logs, embute no payload Kafka data.traceId + header traceparent)
    │
    ▼ Header Kafka: traceparent
Worker FastAPI (extrai traceId da mensagem, vincula ao contexto structlog)
    │
    ▼ Todas as escritas PostgreSQL incluem coluna trace_id
    ▼ Todas as respostas HTTP incluem header x-trace-id (API HTTP Banco B)
```

### 11.2 Formato de Log Estruturado (JSON)

**NestJS (nestjs-pino / Winston):**
```json
{
  "level": "info",
  "timestamp": "2026-04-05T14:30:00.123Z",
  "service": "bank-a-api",
  "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "transferId": "550e8400-...",
  "accountNumber": "A-001",
  "event": "transfer_initiated",
  "amount": 10000,
  "durationMs": 42
}
```

**FastAPI (structlog):**
```json
{
  "level": "info",
  "timestamp": "2026-04-05T14:30:01.000Z",
  "service": "bank-b-worker",
  "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "transferId": "550e8400-...",
  "event": "transfer_credited",
  "amount": 10000,
  "durationMs": 15
}
```

### 11.3 Principais Métricas a Instrumentar

| Métrica | Tipo | Tags |
|---------|------|------|
| `transfer.initiated.total` | Contador | status, direction |
| `transfer.completed.duration_ms` | Histograma | — |
| `transfer.failed.total` | Contador | reason |
| `outbox.pending.count` | Gauge | — |
| `kafka.consumer.lag` | Gauge | topic, partition |
| `idempotency.guard.hits.total` | Contador | — |
| `llm.parse.duration_ms` | Histograma | confidence_bucket |
| `llm.parse.failures.total` | Contador | reason |
| `db.transaction.duration_ms` | Histograma | service, operation |

---

## 12. Quebra de Tarefas

**Legenda:**
- `[P0]` = Bloqueante (dependência crítica)
- `[P1]` = Feature core
- `[P2]` = Qualidade/refinamento
- **Est.** = Horas estimadas

---

### Fase 0 — Infraestrutura e Scaffolding

| Tarefa | Descrição | Est. | Dependências |
|--------|-----------|------|--------------|
| **TASK-01** | Docker Compose: Kafka (modo KRaft), MongoDB (replica set), PostgreSQL, RabbitMQ, RedPanda Console (UI Kafka), Redis | 4h | — |
| **TASK-02** | Scripts de criação de tópicos Kafka + probes de healthcheck para todos os serviços | 2h | TASK-01 |
| **TASK-03** | Estrutura monorepo: `/bank-a`, `/bank-b`, `/infra`, `docker-compose.yml`, `.env.example`, `Makefile` raiz | 2h | — |

**Total Fase 0: ~1 dia**

---

### Fase 1 — Backend Banco A (NestJS)

| Tarefa | Descrição | Est. | Dependências |
|--------|-----------|------|--------------|
| **TASK-04** | Init NestJS: estrutura de módulos (`AuthModule`, `AccountModule`, `TransferModule`, `AIModule`, `KafkaModule`, `OutboxModule`); conexão Mongoose; logger pino; config module | 4h | TASK-03 |
| **TASK-05** | Módulo Auth: mutations `register`, `login`; hash bcrypt; JWT RS256 sign/verify; `JwtAuthGuard`; decorator `CurrentUser` | 5h | TASK-04 |
| **TASK-06** | Módulo Account: resolver de leitura de saldo; schema `UserDocument` com lock otimista | 3h | TASK-05 |
| **TASK-07** | Módulo Transfer — Iniciar: lógica de débito com `findOneAndUpdate` atômico, criação de `TransactionDocument`, session MongoDB | 6h | TASK-06 |
| **TASK-08** | Transactional Outbox: schema `OutboxDocument`, `OutboxService` (escrita na mesma session do TASK-07), `OutboxWorkerService` (cron a cada 500ms: lê + publica no Kafka) | 5h | TASK-07 |
| **TASK-09** | Módulo Kafka Producer: `KafkaProducerService` encapsulando `kafkajs`; serialização do envelope de mensagem; retry em erros transitórios | 3h | TASK-08 |
| **TASK-10** | Módulo Kafka Consumer: consumir `pix.transfer.completed` + `pix.transfer.failed`; atualizar status da transação; estorno de saldo em falha; emitir evento GraphQL Subscription | 5h | TASK-09 |
| **TASK-11** | GraphQL Subscriptions: `onTransactionUpdated` usando `PubSub` (Redis-backed para prod); `onAccountBalanceUpdated` | 4h | TASK-10 |
| **TASK-12** | Módulo IA: `AIService` chamando OpenAI com Function Calling; verificação de limiar de confiança; integração com fluxo de transferência | 5h | TASK-07 |
| **TASK-13** | Observabilidade Banco A: extração de `traceId` dos headers HTTP; vinculação via `AsyncLocalStorage`; injeção em todos os logs, escritas MongoDB e mensagens Kafka | 3h | TASK-04 |

**Total Fase 1: ~4,5 dias**

---

### Fase 2 — Frontend Banco A (Vue.js 3)

| Tarefa | Descrição | Est. | Dependências |
|--------|-----------|------|--------------|
| **TASK-14** | Init Vue 3 (Vite, Pinia, Vue Router, Apollo Client para GraphQL, Tailwind CSS) | 3h | TASK-05 |
| **TASK-15** | Páginas de Auth: Login, Cadastro; armazenamento JWT em memória (não localStorage); fluxo de refresh de token | 4h | TASK-14 |
| **TASK-16** | Layout Dashboard: card de saldo, lista de transações recentes com paginação; Apollo `useQuery` | 4h | TASK-15 |
| **TASK-17** | Formulário de transferência: form estruturado + campo de texto livre para IA; UI de aviso de confiança; modal de confirmação | 5h | TASK-12, TASK-16 |
| **TASK-18** | Status em tempo real: Apollo `useSubscription` para `onTransactionUpdated`; notificações toast; atualização de UI otimista | 4h | TASK-11, TASK-17 |

**Total Fase 2: ~2,5 dias**

---

### Fase 3 — Backend Banco B (FastAPI + Python)

| Tarefa | Descrição | Est. | Dependências |
|--------|-----------|------|--------------|
| **TASK-19** | Init FastAPI: estrutura do projeto (`auth`, `accounts`, `worker`); SQLAlchemy async + Alembic; configuração structlog; schemas Pydantic | 4h | TASK-03 |
| **TASK-20** | Migrations Alembic: todas as tabelas PostgreSQL da Seção 6.2 | 3h | TASK-19 |
| **TASK-21** | Módulo Auth: endpoints register, login; JWT HS256; dependency `get_current_user` | 4h | TASK-20 |
| **TASK-22** | Endpoints Conta + Saldo: `GET /accounts/me`, `GET /accounts/me/statement` | 3h | TASK-21 |
| **TASK-23** | Endpoint SSE: `GET /accounts/me/statement/stream`; `asyncio.Queue` por conexão; push em nova transação | 4h | TASK-22 |
| **TASK-24** | Consumidor Kafka: consumir `pix.transfer.initiated` usando `aiokafka`; encaminhar para RabbitMQ (`aio-pika`) | 4h | TASK-20 |
| **TASK-25** | Worker RabbitMQ: consumir `process.pix`; verificação de idempotência; lógica de crédito com `SELECT FOR UPDATE`; publicar `pix.transfer.completed`/`failed` no Kafka; DLQ após 3 retentativas | 7h | TASK-24 |
| **TASK-26** | Transferência Banco B → A (US13): endpoint `POST /transfers`; débito + outbox → Kafka `pix.transfer.initiated`; consumir conclusão do Kafka; creditar conta A | 5h | TASK-25 |
| **TASK-27** | Observabilidade Banco B: extração de `traceId` dos headers da mensagem Kafka; vinculação via `contextvars` structlog; injeção nas escritas PostgreSQL | 3h | TASK-19 |

**Total Fase 3: ~4,5 dias**

---

### Fase 4 — Frontend Banco B (React)

| Tarefa | Descrição | Est. | Dependências |
|--------|-----------|------|--------------|
| **TASK-28** | Init React (Vite, React Query, React Router, Tailwind CSS, Axios) | 2h | TASK-22 |
| **TASK-29** | Páginas de Auth: Login, Cadastro; JWT; rotas protegidas | 4h | TASK-28 |
| **TASK-30** | Dashboard: exibição de saldo, extrato de transações com paginação e badges de direção | 4h | TASK-29 |
| **TASK-31** | Atualizações em tempo real: `EventSource` consumindo endpoint SSE; atualizar cache React Query em novo evento; notificação toast | 3h | TASK-23, TASK-30 |
| **TASK-32** | Formulário de transferência de saída (US13): selecionar conta origem, informar destino `A-xxx`, valor; submeter para `POST /transfers` | 4h | TASK-26, TASK-30 |

**Total Fase 4: ~2 dias**

---

### Fase 5 — Testes

| Tarefa | Descrição | Est. | Dependências |
|--------|-----------|------|--------------|
| **TASK-33** | Testes Unitários Banco A: `TransferService` (débito, estorno), `OutboxWorkerService`, `AIService` (mock LLM), `KafkaConsumerService` — Jest + mongodb-memory-server | 6h | TASK-12 |
| **TASK-34** | Testes Unitários Banco B: `process_transfer` worker (guarda de idempotência, lógica de crédito) — pytest + pytest-asyncio + testcontainers-python | 5h | TASK-25 |
| **TASK-35** | Testes de Integração Banco A: NestJS e2e com MongoDB real (testcontainers), Kafka mockado, testar fluxo completo débito+outbox | 5h | TASK-33 |
| **TASK-36** | Testes de Integração Banco B: FastAPI e2e com PostgreSQL real (testcontainers), verificar que idempotência previne duplo crédito | 4h | TASK-34 |
| **TASK-37** | Testes E2E — Caminho Feliz: teste Playwright: cadastrar A, cadastrar B, enviar transferência de A, verificar saldo B atualizado; validar mensagens Kafka | 6h | TASK-18, TASK-31 |
| **TASK-38** | Testes E2E — Cenários de Falha: saldo insuficiente; conta não encontrada; simulação Banco B fora do ar (parar container, reiniciar, verificar replay) | 5h | TASK-37 |

**Total Fase 5: ~3,9 dias**

---

### Fase 6 — Deploy

| Tarefa | Descrição | Est. | Dependências |
|--------|-----------|------|--------------|
| **TASK-39** | Docker Compose produção: builds multi-stage para todos os serviços; containers sem root; health checks; políticas de restart | 4h | Todas as fases |
| **TASK-40** | Pipeline CI/CD (GitHub Actions): lint → test → build → push imagens Docker para registry | 4h | TASK-39 |
| **TASK-41** | Deploy na nuvem (ver Seção 14) + SSL/TLS + secrets de ambiente | 4h | TASK-40 |

**Total Fase 6: ~1,5 dias**

---

### Tabela Resumo

| Fase | Tarefas | Tempo Estimado |
|------|---------|----------------|
| Fase 0 — Infraestrutura | TASK-01 → TASK-03 | **~1 dia** |
| Fase 1 — Backend Banco A | TASK-04 → TASK-13 | **~4,5 dias** |
| Fase 2 — Frontend Banco A | TASK-14 → TASK-18 | **~2,5 dias** |
| Fase 3 — Backend Banco B | TASK-19 → TASK-27 | **~4,5 dias** |
| Fase 4 — Frontend Banco B | TASK-28 → TASK-32 | **~2 dias** |
| Fase 5 — Testes | TASK-33 → TASK-38 | **~4 dias** |
| Fase 6 — Deploy | TASK-39 → TASK-41 | **~1,5 dias** |
| **TOTAL** | **41 tarefas** | **~20 dias úteis (1 dev)** |

> Com 2 desenvolvedores rodando Banco A e Banco B em paralelo: **~12 dias úteis**

---

### Caminho Crítico (deve-ser-feito-antes)

```
TASK-01 → TASK-03 → TASK-04 → TASK-05 → TASK-07 → TASK-08 → TASK-09 → TASK-10 → TASK-18
                              → TASK-19 → TASK-20 → TASK-24 → TASK-25 → TASK-31
                                                                         ↓
                                                               TASK-37 → TASK-38
```

---

## 13. Plano de Deploy

### Opção A — Demo Local (Docker Compose) ★ Recomendado para submissão do teste

**Custo:** R$ 0  
**Tempo de configuração:** 30 minutos

```yaml
# docker-compose.prod.yml (condensado)
services:
  kafka:
    image: confluentinc/cp-kafka:7.6.1
    # Modo KRaft — sem ZooKeeper necessário

  mongodb:
    image: mongo:7.0
    command: --replSet rs0  # replica set necessário para transações
    volumes:
      - mongo_data:/data/db

  postgres:
    image: postgres:16-alpine
    volumes:
      - pg_data:/var/lib/postgresql/data

  rabbitmq:
    image: rabbitmq:3.13-management-alpine

  redis:
    image: redis:7-alpine  # para PubSub GraphQL Subscriptions

  bank-a-api:
    build:
      context: ./bank-a
      dockerfile: Dockerfile
      target: production
    depends_on: [kafka, mongodb, redis]
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://mongodb:27017/bank_a?replicaSet=rs0
      - KAFKA_BROKERS=kafka:9092
      - REDIS_URL=redis://redis:6379
      - OPENAI_API_KEY=${OPENAI_API_KEY}

  bank-a-frontend:
    build: ./bank-a/frontend
    ports: ["3000:80"]

  bank-b-worker:
    build: ./bank-b
    command: python -m app.worker
    depends_on: [kafka, postgres, rabbitmq]

  bank-b-api:
    build: ./bank-b
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    depends_on: [postgres]

  bank-b-frontend:
    build: ./bank-b/frontend
    ports: ["3001:80"]

  redpanda-console:
    image: redpandadata/console:latest
    ports: ["8080:8080"]
```

```bash
make up      # docker compose -f docker-compose.prod.yml up -d
make logs    # docker compose logs -f
make down    # docker compose down -v
```

---

### Recomendação para este teste

**Use a Opção A (Docker Compose local)** para desenvolvimento e submissão final, com **Opção B** para URL pública se necessário para apresentação. Um `Makefile` com `make setup && make up` deve colocar qualquer avaliador rodando em menos de 5 minutos.

---

### Referência de Variáveis de Ambiente

```env
# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID_BANK_A=bank-a-consumer-group
KAFKA_GROUP_ID_BANK_B=bank-b-consumer-group

# Banco A - NestJS
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/bank_a?replicaSet=rs0
JWT_PRIVATE_KEY_PATH=./certs/private.pem
JWT_PUBLIC_KEY_PATH=./certs/public.pem
JWT_EXPIRES_IN=3600
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
LLM_CONFIDENCE_THRESHOLD=0.7
OUTBOX_POLL_INTERVAL_MS=500
OUTBOX_BATCH_SIZE=50

# Banco B - FastAPI
DATABASE_URL=postgresql+asyncpg://user:senha@localhost:5432/bank_b
RABBITMQ_URL=amqp://guest:guest@localhost:5672/
JWT_SECRET=sua-chave-secreta
JWT_ALGORITHM=HS256
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
RABBITMQ_QUEUE_NAME=process.pix
RABBITMQ_DLQ_NAME=pix.dlq
MAX_RETRY_ATTEMPTS=3
```

---

## 14. Registro de Riscos

| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|---------------|---------|-----------|
| R01 | MongoDB sem `SELECT FOR UPDATE` real — débitos concorrentes podem gerar race condition | Média | Alta | `findOneAndUpdate` atômico com pré-condição de saldo + session MongoDB (replica set obrigatório) |
| R02 | Latência da API LLM (OpenAI P99 > 3s) adiciona latência inaceitável de UX | Média | Média | Transmitir resposta (stream); exibir estado "interpretando..."; timeout de 5s com fallback para formulário manual |
| R03 | Mensagem Kafka entregue mas atualização de `publishedAt` no outbox falha | Baixa | Alta | Idempotência no produtor Kafka (config `enable.idempotence=true` + `acks=all`) |
| R04 | DLQ RabbitMQ cresce sem limite | Baixa | Média | Definir `x-max-length` na DLQ + alerta quando profundidade DLQ > 10 |
| R05 | GraphQL Subscription via WebSocket não escala horizontalmente | Média | Média | Usar `PubSubEngine` com Redis (ioredis) — permite múltiplas instâncias NestJS compartilharem eventos |
| R06 | Replica set MongoDB obrigatório para transações — configuração local complexa | Alta | Média | Usar imagem Docker `mongo:7.0` com `--replSet rs0` + script de init automático; documentar setup claramente |
| R07 | Conexões SSE vazam ao desconectar o cliente | Média | Baixa | Generator SSE do FastAPI usa `asyncio.CancelledError` para limpar entradas da fila |
| R08 | Custo da chave OpenAI explode durante testes | Baixa | Média | Usar `gpt-4o-mini` (mais barato); cache de inputs idênticos; rate limiting no endpoint de IA |

---
