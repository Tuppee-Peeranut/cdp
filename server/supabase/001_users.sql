create table if not exists users (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  role text not null default 'user',
  tenant_id uuid
);
