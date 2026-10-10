-- Optional read-only Astra feed. Review and apply separately from schema.sql.
-- No existing task, auth, or RLS policies are changed. Never use a service key
-- in Astra. Issuance/revocation require the signed-in user's normal session.
begin;
create table if not exists public.astra_readers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  revoked boolean not null default false
);
alter table public.astra_readers enable row level security;
revoke all on public.astra_readers from public, anon, authenticated;

create or replace function public.issue_astra_reader()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  token text;
  email text;
  expiry timestamptz := pg_catalog.now() + interval '180 days';
begin
  if uid is null then raise exception 'Sign in required' using errcode='28000'; end if;
  select u.email into email from public.users u where u.id=uid;
  if email is null then raise exception 'Synced Cadence profile required'; end if;
  token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
           pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into public.astra_readers(user_id, token_hash, expires_at, revoked)
    values(uid, pg_catalog.sha256(pg_catalog.convert_to(token,'UTF8')), expiry, false)
    on conflict(user_id) do update set token_hash=excluded.token_hash,
      expires_at=excluded.expires_at, revoked=false;
  return pg_catalog.jsonb_build_object('token',token,'account',email,'expires_at',expiry);
end $$;

create or replace function public.revoke_astra_reader()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='28000'; end if;
  update public.astra_readers set revoked=true where user_id=auth.uid();
end $$;

create or replace function public.astra_briefing_snapshot(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid; profile record; task_rows jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Reader unavailable' using errcode='28000';
  end if;
  select r.user_id into uid from public.astra_readers r
    where r.token_hash=pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8'))
      and not r.revoked and r.expires_at>pg_catalog.now();
  if uid is null then raise exception 'Reader unavailable' using errcode='28000'; end if;
  select u.email,u.goals,u.daily_plan into profile from public.users u where u.id=uid;
  if profile.email is null then raise exception 'Reader unavailable'; end if;
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,
      'deadline',t.deadline,'category',t.category,'recurrence',t.recurrence,
      'goal_id',t.goal_id,'life_pillar',t.life_pillar,'progress',t.progress,
      'last_completed_period',t.last_completed_period,'updated_at',t.updated_at,
      'subtasks',coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id',s.id,'title',s.title,'status',s.status,
          'level',s.level,'percent',s.percent,'deadline',s.deadline)
        order by s.subtask_order,s.id) from public.subtasks s where s.task_id=t.id), '[]'::jsonb)
    ) order by t.task_order,t.id),'[]'::jsonb) into task_rows
    from public.tasks t where t.user_id=uid;
  return pg_catalog.jsonb_build_object('version',1,'account',profile.email,
    'observed_at',pg_catalog.now(),'tasks',task_rows,
    'goals',coalesce(profile.goals,'[]'::jsonb),'daily_plan',profile.daily_plan);
end $$;

revoke all on function public.issue_astra_reader() from public, anon;
revoke all on function public.revoke_astra_reader() from public, anon;
revoke all on function public.astra_briefing_snapshot(text) from public;
grant execute on function public.issue_astra_reader() to authenticated;
grant execute on function public.revoke_astra_reader() to authenticated;
grant execute on function public.astra_briefing_snapshot(text) to anon, authenticated;
commit;
