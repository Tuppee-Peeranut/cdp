-- Reset basic auth tables
DROP TABLE IF EXISTS super_admins;
DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin')) DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS super_admins (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL
);

