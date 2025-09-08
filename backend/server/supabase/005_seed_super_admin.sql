-- Seed default super admin user
-- Uses pgcrypto to hash password
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
SELECT
  gen_random_uuid(),
  'skywalker@panya.io',
  crypt('I@my0urfather', gen_salt('bf')),
  now(),
  jsonb_build_object('role', 'super_admin', 'username', 'skywalker')
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'skywalker@panya.io'
);

INSERT INTO users (id, username, role)
SELECT id, 'skywalker', 'super_admin'
FROM auth.users
WHERE email = 'skywalker@panya.io'
ON CONFLICT (id) DO NOTHING;
