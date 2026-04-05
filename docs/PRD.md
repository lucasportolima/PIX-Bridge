# PRD — PIX-Bridge

**Tipo:** Teste de Conhecimento Técnico  
**Status:** Em desenvolvimento  
**Última atualização:** 05/04/2026

---

## 1. Título do Projeto

**PIX-Bridge:** Simulador de Transferência Interbancária com GenAI e Arquitetura Orientada a Eventos.

---

## 2. Visão Geral

O PIX-Bridge simula o fluxo de uma transferência instantânea entre duas instituições financeiras distintas. O objetivo é garantir que o dinheiro saia de uma conta (Banco A) e chegue na outra (Banco B) — e vice-versa — lidando com concorrência, possíveis falhas de rede e retentativas automáticas, tudo orquestrado por mensageria.

Ambos os bancos possuem **frontend e backend independentes**, com autenticação própria em cada domínio.

---

## 3. Arquitetura e Stack Tecnológica

A solução utiliza o padrão de **Microsserviços com Coreografia de Eventos**.

### Domínio Banco A — Emissor e Receptor

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Vue.js 3 |
| Backend | NestJS (Node.js) · API GraphQL |
| Banco de Dados | MongoDB |
| Feature de IA | Endpoint NestJS integrado a LLM via Function Calling — interpreta comandos de texto livre e transforma em payloads GraphQL |

### Mensageria — "Banco Central" Simulado

| Componente | Tecnologia |
|-----------|-----------|
| Broker Banco A | Apache Kafka |
| Broker Banco B | RabbitMQ ou Redis |

### Domínio Banco B — Emissor e Receptor

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React (Dashboard) |
| Backend / Worker | Python · FastAPI |
| Banco de Dados | PostgreSQL |

---

## 4. Histórias de Usuário

### Fluxo Principal

| ID | História | Critério de Aceite |
|----|----------|-------------------|
| **US01** | Como usuário do Banco A, quero escrever `"Mande 100 reais para a conta B"` em um campo de texto para que o sistema entenda via IA e inicie a transferência sem formulários complexos. | IA interpreta o comando, extrai conta destino e valor, e inicia o fluxo automaticamente. |
| **US02** | Como sistema, quero garantir que ao iniciar a transferência o valor seja debitado do saldo do remetente e o status fique como `PROCESSANDO`, usando locks para evitar saldo negativo. | Débito atômico com `findOneAndUpdate` + condição de saldo; status salvo como `PROCESSING`. |
| **US03** | Como sistema, quero que o pedido de transferência seja enviado para uma fila e, se o Banco B estiver fora do ar, a mensagem permaneça na fila com retentativas automáticas. | Kafka retém a mensagem; offset não confirmado enquanto o consumidor estiver indisponível. |
| **US04** | Como worker do Banco B, quero ler a fila, creditar o valor na conta destino de forma idempotente e publicar um evento de `SUCESSO`. | Verificação em `processed_transfers` antes do crédito; duplo consumo não gera duplo crédito. |
| **US05** | Como usuário do Banco B, quero abrir o dashboard e ver a transação no extrato com o saldo atualizado. | Extrato atualiza via SSE; novo item aparece sem reload. |
| **US06** | Como sistema, quero que o NestJS ouça o evento de `SUCESSO`, altere a transação para `CONCLUÍDO` e libere o histórico final no frontend Vue. | GraphQL Subscription emite evento `COMPLETED`; frontend atualiza sem polling. |

### Fluxos Complementares

| ID | História | Critério de Aceite |
|----|----------|-------------------|
| **US07** | Como novo usuário do Banco A, quero me registrar e receber saldo inicial para testar transferências. | Cadastro cria conta com saldo padrão de R$1.000; JWT retornado imediatamente. |
| **US08** | Como usuário do Banco A, quero ver atualização em tempo real do status da transferência sem recarregar a página. | GraphQL Subscription emite mudanças de status: `PROCESSING` → `COMPLETED` / `FAILED`. |
| **US09** | Como usuário do Banco A, quero que minha transferência seja rejeitada imediatamente se não houver saldo suficiente. | Erro síncrono `400` retornado antes de qualquer publicação no Kafka. |
| **US10** | Como usuário do Banco A, quero uma mensagem de erro clara quando a IA não entender meu comando. | Se `confidence < 0.7`, retornar erro estruturado solicitando reformulação. |
| **US11** | Como usuário do Banco B, quero receber atualizações em tempo real no dashboard quando um crédito chegar. | Endpoint SSE empurra novos eventos de transação; React escuta via `EventSource`. |
| **US12** | Como usuário do Banco A, quero que meu saldo seja automaticamente restaurado se uma transferência falhar. | No evento `pix.transfer.failed`, NestJS reverte o débito atomicamente. |
| **US13** | Como usuário do Banco B, quero poder enviar dinheiro de volta para o Banco A. | Dashboard React expõe formulário de transferência; FastAPI produz para `pix.transfer.initiated`; worker do Banco A credita. |
| **US14** | Como engenheiro, quero que mensagens Kafka com falha caiam em uma DLQ com contexto completo. | Após 3 tentativas no RabbitMQ, mensagem vai para `pix.dlq` com metadados do erro. |
| **US15** | Como engenheiro, quero consultar qualquer transação nos dois bancos usando apenas o `traceId`. | Ambos os sistemas aceitam `GET /debug/trace/:traceId` retornando todos os eventos associados. |
| **US16** | Como usuário do Banco A, quero ver o histórico de transferências recebidas do Banco B. | `myTransactions` retorna transações com `direction: INBOUND`. |
| **US17** | Como usuário de qualquer banco, quero que minha sessão expire e seja renovada automaticamente. | Refresh token silencioso no frontend antes de cada requisição quando o access token expirar em menos de 5 minutos. |

---

## 5. Requisitos Não Funcionais (NFRs)

### Consistência de Dados (ACID)
Uso obrigatório de transações explícitas no PostgreSQL e `SELECT ... FOR UPDATE` ao manipular tabelas de saldo, evitando race conditions em operações concorrentes.

### Tolerância a Falhas
Uso obrigatório do **Transactional Outbox Pattern** no Banco A. A publicação no Kafka/RabbitMQ não deve ocorrer diretamente dentro da transação do banco de dados — se o banco executar rollback, nenhuma mensagem deve ser enviada.

### Idempotência
O worker Python deve registrar o `transfer_id` em uma tabela separada (`processed_transfers`). Antes de creditar o saldo, deve verificar se aquele ID já foi processado, garantindo que uma mensagem reentregue não gere duplo crédito.

### Observabilidade
Uso de **logs estruturados (JSON)** nos serviços NestJS e Python. Um `trace_id` gerado na origem (Vue.js) deve ser propagado pelo NestJS, pela fila Kafka e chegar ao worker Python, permitindo rastreamento completo de ponta a ponta.
