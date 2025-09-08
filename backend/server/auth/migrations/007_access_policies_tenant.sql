BEGIN;

-- Add tenant scoping to access_policies
ALTER TABLE public.access_policies ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Drop old unique if present and set new scoped unique
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='access_policies' AND indexname='access_policies_role_resource_key'
  ) THEN
    ALTER TABLE public.access_policies DROP CONSTRAINT access_policies_role_resource_key;
  END IF;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE public.access_policies ADD CONSTRAINT access_policies_tenant_role_resource_key UNIQUE (tenant_id, role, resource);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_access_policies_tenant ON public.access_policies(tenant_id);

COMMIT;

