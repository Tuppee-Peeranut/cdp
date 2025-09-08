BEGIN;

-- Enable gen_random_uuid if not already
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Access policies for roles and resources
CREATE TABLE IF NOT EXISTS public.access_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  resource text NOT NULL CHECK (resource IN ('dashboard','domain','rules')),
  can_create boolean NOT NULL DEFAULT false,
  can_update boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  UNIQUE (role, resource)
);

CREATE INDEX IF NOT EXISTS idx_access_policies_role ON public.access_policies(role);

-- Audit logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  actor_id uuid,
  action text NOT NULL,           -- e.g., create, update, delete
  resource text NOT NULL,         -- e.g., tenant, user, policy
  resource_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant ON public.audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.audit_logs(created_at DESC);

-- Adjust tenants plan constraint to remove 'free'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='tenants' AND constraint_name='tenants_active_plan_check'
  ) THEN
    ALTER TABLE public.tenants DROP CONSTRAINT tenants_active_plan_check;
  END IF;
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_active_plan_check CHECK (active_plan IS NULL OR active_plan IN ('pro','enterprise'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

