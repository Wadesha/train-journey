-- =====================================================
-- 铁旅 · Supabase 数据库结构（预留蓝图，当前不执行、不影响本地运行）
-- 启用步骤：
--   1) 在 storage.js 顶部把 BACKEND 改为 'supabase'
--   2) 在 storage.js 的 SupabaseAdapter 填入项目 URL / anon key
--   3) 到 Supabase 控制台 SQL Editor 执行本文件建表
--   4) 开启行级安全策略（见文末注释）后接入认证
-- =====================================================

-- 用户档案：认证由 Supabase Auth 承载（auth.users），这里存游戏内档案与云存档
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  photo_url    text,
  cloud_save   jsonb,                -- 游戏全程存档，对齐 storage.js 的 saveSave 数据结构
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 乘车旅程记录（用户生成内容，未来用于手账 / 分享）
create table public.journeys (
  id         bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  train_no   text,
  departure  text,
  arrival    text,
  seat       text,
  km         numeric,
  date       date,
  payload    jsonb,
  created_at timestamptz default now()
);

-- 足迹打卡：站点维度（同站只记一次）
create table public.checkins (
  id         bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  station    text not null,
  at         timestamptz default now(),
  unique (profile_id, station)
);

-- 排行榜：按范围(scope)与指标(metric)聚合
create table public.rankings (
  profile_id uuid references public.profiles(id) on delete cascade not null,
  scope      text not null,          -- friend / nation / weekly
  metric     text not null,          -- stations / km / lines
  value      numeric not null default 0,
  updated_at timestamptz default now(),
  primary key (profile_id, scope, metric)
);

-- 建议索引
create index if not exists journeys_profile_idx on public.journeys(profile_id, created_at desc);
create index if not exists checkins_profile_idx on public.checkins(profile_id);
create index if not exists rankings_scope_idx  on public.rankings(scope, metric, value desc);

-- 行级安全（RLS）：正式启用认证后再打开，例如：
-- alter table public.profiles enable row level security;
-- create policy "own profile" on public.profiles
--   for all using (auth.uid() = id) with check (auth.uid() = id);
-- （journeys / checkins / rankings 同理按 auth.uid() 或 scope 授权）