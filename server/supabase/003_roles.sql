-- Roles table to manage page access per role
CREATE TABLE IF NOT EXISTS roles (
  name text PRIMARY KEY,
  pages jsonb DEFAULT '[]'::jsonb
);

-- Seed default roles
INSERT INTO roles (name) VALUES ('super_admin'), ('admin'), ('user')
ON CONFLICT (name) DO NOTHING;
