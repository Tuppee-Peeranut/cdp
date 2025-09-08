-- Add subscription and settings columns to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_start timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_end timestamptz,
  ADD COLUMN IF NOT EXISTS active_plan text,
  ADD COLUMN IF NOT EXISTS trial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
