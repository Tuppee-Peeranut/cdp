BEGIN;

-- Ensure expected columns exist on public.tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subscription_start timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subscription_end timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subscription_active boolean DEFAULT false NOT NULL;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subscription_period_months smallint;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS active_plan text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS trial boolean DEFAULT false NOT NULL;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb NOT NULL;

-- Optional: constrain plan values if you prefer a fixed set
DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_active_plan_check CHECK (active_plan IS NULL OR active_plan IN ('free','pro','enterprise'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_subscription_period_check CHECK (
    subscription_period_months IS NULL OR subscription_period_months IN (6,12,18,24)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_active_plan ON public.tenants(active_plan);
CREATE INDEX IF NOT EXISTS idx_tenants_trial ON public.tenants(trial);
CREATE INDEX IF NOT EXISTS idx_tenants_subscription_active ON public.tenants(subscription_active);

COMMIT;
