-- ──────────────────────────────────────────────────────────────────────────────
-- PostgreSQL Init Script — Bank B
-- Runs automatically on first container startup (empty data dir).
-- Full schema is managed by Alembic migrations (TASK-20).
-- ──────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation (used in all PKs via gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable case-insensitive text (optional — used for email lookups)
CREATE EXTENSION IF NOT EXISTS "citext";
