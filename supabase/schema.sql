-- Supabase 대시보드 → SQL Editor에 이 파일 전체를 붙여넣고 실행한다.
-- 유저별 링크를 보관하는 테이블 + RLS(본인 행만 접근) + 삭제 전파용 tombstone.

create table if not exists public.links (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  title text not null,
  memo text not null default '',
  tags jsonb not null default '[]'::jsonb,
  image text,
  favicon text,
  site_name text,
  pinned boolean not null default false,
  created_at bigint not null,
  -- 클라이언트가 기록한 수정 시각(ms) — 기기 간 last-write-wins 비교에 사용
  updated_at bigint not null,
  -- 삭제 시각(tombstone). null이면 활성, 값이 있으면 어느 기기에서든 삭제된 것
  deleted_at bigint,
  primary key (user_id, id)
);

alter table public.links enable row level security;

create policy "links owner access"
  on public.links
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
