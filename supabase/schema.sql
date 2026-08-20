-- =====================================================
-- 铁旅 · 高铁模拟 —— Supabase 建表脚本（最终可执行版）
-- 项目：enterprise（Wadesha's Org，多应用共用账号池）
--
-- 用途：一套 Supabase Auth 账号被多个应用共用；
--       每张业务表带 app_id 字段，数据按应用隔离（本游戏 app_id = 'train_journey'）。
--
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴本文件全部内容 → Run
-- 前置：先到 Authentication → Sign In / Providers 开启 Email 与匿名登录
-- 特点：所有语句均为"幂等"写法，重复执行不会报错。
-- =====================================================

-- 1) 应用登记表：登记哪些应用共用这套账号（以后新增应用只加一行）
create table if not exists public.app_meta (
  app_id text primary key,
  name   text not null
);
insert into public.app_meta(app_id, name)
values ('train_journey', '铁旅·高铁模拟')
on conflict (app_id) do nothing;

-- 2) 用户档案：每个登录用户一条（跨应用共享昵称/头像），认证由 Supabase Auth 托管
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  cloud_save   jsonb,                -- 游戏全程存档（对齐 storage.js 的 saveSave 数据结构）
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 3) 业务表：均带 app_id，数据按应用隔离
--    乘车手账
create table if not exists public.journeys (
  id         bigint generated always as identity primary key,
  app_id     text not null references public.app_meta(app_id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  train_no   text,
  departure  text,
  arrival    text,
  seat       text,
  km         numeric,
  date       date,
  payload    jsonb,
  created_at timestamptz default now()
);

--    站点打卡（同一用户在同一个应用内，同站只记一次）
create table if not exists public.checkins (
  id         bigint generated always as identity primary key,
  app_id     text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  station    text not null,
  at         timestamptz default now(),
  unique (app_id, profile_id, station)
);

--    排行榜（friend / nation / weekly × stations / km / lines）
create table if not exists public.rankings (
  app_id     text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  scope      text not null,
  metric     text not null,
  value      numeric not null default 0,
  updated_at timestamptz default now(),
  primary key (app_id, profile_id, scope, metric)
);

-- 4) 常用索引
create index if not exists journeys_profile_idx on public.journeys(app_id, profile_id, created_at desc);
create index if not exists checkins_profile_idx on public.checkins(app_id, profile_id);
create index if not exists rankings_scope_idx  on public.rankings(app_id, scope, metric, value desc);

-- 5) 行级安全（RLS）——必须开启，否则任何人能读写全表
alter table public.app_meta  enable row level security;
alter table public.profiles  enable row level security;
alter table public.journeys  enable row level security;
alter table public.checkins  enable row level security;
alter table public.rankings  enable row level security;

-- 说明：PostgreSQL 的 CREATE POLICY 不支持 IF NOT EXISTS（表和索引才支持），
--       所以用 DO 块先查 pg_policies 判断是否已存在，再创建，保证重复执行不报错。
do $$
begin
  -- 应用登记表：登录用户可读（前端需要它知道 app_id 是否合法）
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_meta' and policyname='app_meta_read') then
    create policy "app_meta_read" on public.app_meta for select using (true);
  end if;

  -- 档案：只能读写自己的行
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='own_profile') then
    create policy "own_profile" on public.profiles
      for all using (auth.uid() = id) with check (auth.uid() = id);
  end if;

  -- 手账：只能读写自己的行
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='journeys' and policyname='own_journeys') then
    create policy "own_journeys" on public.journeys
      for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
  end if;

  -- 打卡：只能读写自己的行
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='checkins' and policyname='own_checkins') then
    create policy "own_checkins" on public.checkins
      for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
  end if;

  -- 排行榜：所有人可读，写入只能写自己的行（insert 与 update 必须各建一条 policy）
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rankings' and policyname='rank_read') then
    create policy "rank_read" on public.rankings for select using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rankings' and policyname='rank_write_insert') then
    create policy "rank_write_insert" on public.rankings
      for insert with check (auth.uid() = profile_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rankings' and policyname='rank_write_update') then
    create policy "rank_write_update" on public.rankings
      for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
  end if;
end $$;
