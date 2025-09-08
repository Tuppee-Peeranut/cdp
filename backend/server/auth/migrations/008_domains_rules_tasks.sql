BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Domains (per tenant)
CREATE TABLE IF NOT EXISTS public.domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  business_key text[] DEFAULT '{}'::text[] NOT NULL,
  current_version_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- Versions (snapshots from uploads)
CREATE TABLE IF NOT EXISTS public.domain_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES public.domains(id) ON DELETE CASCADE,
  file_path text,
  rows_count integer,
  columns jsonb,
  import_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Current data (Type 4 current table) stored as JSONB for flexibility
CREATE TABLE IF NOT EXISTS public.domain_data (
  domain_id uuid NOT NULL REFERENCES public.domains(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  key_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  record jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain_id, key_hash)
);

-- History (Type 4 history table)
CREATE TABLE IF NOT EXISTS public.domain_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES public.domains(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  key_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  record jsonb NOT NULL,
  version_at timestamptz NOT NULL DEFAULT now(),
  source_version_id uuid REFERENCES public.domain_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_domain_history_domain ON public.domain_history(domain_id);
CREATE INDEX IF NOT EXISTS idx_domain_data_domain ON public.domain_data(domain_id);

-- Rules (AI generated)
CREATE TABLE IF NOT EXISTS public.rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES public.domains(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'enabled',
  definition jsonb NOT NULL, -- JSON describing transformations/validations
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Rule runs (tasks)
CREATE TABLE IF NOT EXISTS public.rule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  domain_version_id uuid REFERENCES public.domain_versions(id),
  status text NOT NULL DEFAULT 'pending',
  metrics jsonb,
  output_version_id uuid REFERENCES public.domain_versions(id),
  started_at timestamptz,
  finished_at timestamptz
);

-- Generic tasks (optionally used by UI)
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  domain_id uuid,
  kind text NOT NULL, -- e.g., 'clean', 'profile', 'validate'
  status text NOT NULL DEFAULT 'pending',
  params jsonb,
  result jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_domain ON public.rules(domain_id);
CREATE INDEX IF NOT EXISTS idx_rule_runs_rule ON public.rule_runs(rule_id);
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON public.tasks(domain_id);

COMMIT;

