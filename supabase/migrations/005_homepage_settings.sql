-- Mimetta Expense Portal — homepage announcements
--
-- Cannot be applied via `supabase db push` from the agent environment (no
-- SUPABASE_ACCESS_TOKEN / linked project available) — run this manually
-- against the project's Supabase instance (SQL editor, or `supabase db
-- push` with real credentials), same as 004_new_features.sql.

create table if not exists announcements (
  id bigserial primary key,
  title text not null,
  message text,
  is_pinned boolean default false,
  is_active boolean default true,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists announcements_pinned_active_idx on announcements (is_active, is_pinned, created_at desc);

insert into announcements (title, message, is_pinned)
values (
  'ยินดีต้อนรับสู่ Mimetta Expense Portal',
  'ระบบเบิกจ่ายใหม่พร้อมใช้งานแล้ว กรุณาติดต่อ admin หากมีปัญหา',
  true
);

alter table announcements enable row level security;
