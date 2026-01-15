-- Add creator terms acceptances table
CREATE TABLE IF NOT EXISTS creator_terms_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version VARCHAR(50) NOT NULL,
  accepted_ip VARCHAR(45) NOT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_terms_acceptances_creator_id
  ON creator_terms_acceptances(creator_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_creator_terms_acceptances_creator_version
  ON creator_terms_acceptances(creator_id, terms_version);
