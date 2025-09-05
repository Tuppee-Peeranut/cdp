BEGIN;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS trial_days smallint;

DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_trial_days_check CHECK (
    trial_days IS NULL OR trial_days IN (7,14)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

