BEGIN;

-- Expand public.users schema to include app metadata and status
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_url text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS locale text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS consents jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' NOT NULL;

-- Ensure role allows super_admin
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public' AND table_name = 'users' AND constraint_name = 'users_role_check'
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_role_check;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin','super_admin'));

-- Add status constraint if missing
DO $$ BEGIN
  ALTER TABLE public.users ADD CONSTRAINT users_status_check CHECK (status IN ('active','disabled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON public.users(deleted_at);

COMMIT;

