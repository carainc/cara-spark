-- Enable pgvector before the app pushes the schema (ReferralResource.embedding). Mounted into
-- the postgres container's docker-entrypoint-initdb.d. For non-Docker dev, run this once.
CREATE EXTENSION IF NOT EXISTS vector;
