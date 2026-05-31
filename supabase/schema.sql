-- Morphly Voice Console Supabase schema.
-- Every app-owned table ends with "w" so it can live beside existing tables.

create table if not exists public.userw (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  voice_credits integer not null default 10 check (voice_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.userw alter column voice_credits set default 10;

create table if not exists public.walletw (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.userw(id) on delete cascade,
  balance numeric(12, 2) not null default 0 check (balance >= 0),
  currency text not null default 'NGN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walletw_unique_user unique (user_id)
);

create table if not exists public.creditw (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.userw(id) on delete cascade,
  amount integer not null,
  balance_after integer,
  transaction_type text not null check (transaction_type in ('starter_grant', 'purchase', 'grant', 'usage', 'refund')),
  description text,
  provider text,
  provider_reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptionw (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.userw(id) on delete cascade,
  plan_id text not null default 'free',
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'paused')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptionw_unique_user unique (user_id)
);

alter table public.subscriptionw alter column current_period_end drop not null;

create table if not exists public.paymentw (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.userw(id) on delete cascade,
  plan_id text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'NGN',
  credits integer not null check (credits >= 0),
  provider text not null default 'flutterwave',
  provider_reference text,
  tx_ref text,
  status text not null default 'pending' check (status in ('pending', 'successful', 'failed', 'canceled')),
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.paymentw add column if not exists tx_ref text;

create unique index if not exists paymentw_flutterwave_reference_unique
  on public.paymentw(provider, provider_reference)
  where provider_reference is not null;

create unique index if not exists paymentw_flutterwave_tx_ref_unique
  on public.paymentw(provider, tx_ref)
  where tx_ref is not null;

create table if not exists public.usage_sessionw (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.userw(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_billed_at timestamptz not null default now(),
  billed_minutes integer not null default 1 check (billed_minutes >= 0),
  credits_spent integer not null default 0 check (credits_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_atw()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_userw_updated_at on public.userw;
create trigger touch_userw_updated_at
before update on public.userw
for each row execute function public.touch_updated_atw();

drop trigger if exists touch_walletw_updated_at on public.walletw;
create trigger touch_walletw_updated_at
before update on public.walletw
for each row execute function public.touch_updated_atw();

drop trigger if exists touch_subscriptionw_updated_at on public.subscriptionw;
create trigger touch_subscriptionw_updated_at
before update on public.subscriptionw
for each row execute function public.touch_updated_atw();

drop trigger if exists touch_paymentw_updated_at on public.paymentw;
create trigger touch_paymentw_updated_at
before update on public.paymentw
for each row execute function public.touch_updated_atw();

drop trigger if exists touch_usage_sessionw_updated_at on public.usage_sessionw;
create trigger touch_usage_sessionw_updated_at
before update on public.usage_sessionw
for each row execute function public.touch_updated_atw();

create or replace function public.bootstrap_user_accountw()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.walletw where user_id = new.id) then
    insert into public.walletw (user_id)
    values (new.id);
  end if;

  if not exists (select 1 from public.subscriptionw where user_id = new.id) then
    insert into public.subscriptionw (user_id, plan_id, status)
    values (new.id, 'free', 'active');
  end if;

  if new.voice_credits > 0 then
    insert into public.creditw (user_id, amount, balance_after, transaction_type, description)
    values (new.id, new.voice_credits, new.voice_credits, 'starter_grant', '10 free starter credits');
  end if;

  return new;
end;
$$;

drop trigger if exists bootstrap_user_accountw_on_insert on public.userw;
create trigger bootstrap_user_accountw_on_insert
after insert on public.userw
for each row execute function public.bootstrap_user_accountw();

alter table public.userw enable row level security;
alter table public.walletw enable row level security;
alter table public.creditw enable row level security;
alter table public.subscriptionw enable row level security;
alter table public.paymentw enable row level security;
alter table public.usage_sessionw enable row level security;

revoke update on public.userw from authenticated;
grant update (email, display_name, updated_at) on public.userw to authenticated;
revoke insert, update on public.paymentw from authenticated;

drop policy if exists "userw_select_own" on public.userw;
create policy "userw_select_own"
  on public.userw for select to authenticated using (auth.uid() = id);

drop policy if exists "userw_insert_own" on public.userw;
create policy "userw_insert_own"
  on public.userw for insert to authenticated with check (auth.uid() = id);

drop policy if exists "userw_update_own" on public.userw;
create policy "userw_update_own"
  on public.userw for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "walletw_select_own" on public.walletw;
create policy "walletw_select_own"
  on public.walletw for select to authenticated using (auth.uid() = user_id);

drop policy if exists "creditw_select_own" on public.creditw;
create policy "creditw_select_own"
  on public.creditw for select to authenticated using (auth.uid() = user_id);

drop policy if exists "subscriptionw_select_own" on public.subscriptionw;
create policy "subscriptionw_select_own"
  on public.subscriptionw for select to authenticated using (auth.uid() = user_id);

drop policy if exists "paymentw_select_own" on public.paymentw;
create policy "paymentw_select_own"
  on public.paymentw for select to authenticated using (auth.uid() = user_id);

drop policy if exists "paymentw_insert_own" on public.paymentw;
drop policy if exists "usage_sessionw_select_own" on public.usage_sessionw;
create policy "usage_sessionw_select_own"
  on public.usage_sessionw for select to authenticated using (auth.uid() = user_id);

drop function if exists public.increment_voice_creditsw(integer);
drop function if exists public.apply_flutterwave_paymentw(uuid, text, numeric, text, integer, text, text, jsonb);
drop function if exists public.apply_flutterwave_paymentw(uuid, text, numeric, text, integer, integer, text, text, jsonb);

create or replace function public.apply_flutterwave_paymentw(target_user_id uuid, p_plan_id text, p_amount numeric, p_currency text, p_credits integer, p_subscription_days integer, p_provider_reference text, p_tx_ref text, p_raw_response jsonb)
returns public.userw
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_payment public.paymentw;
  updated_profile public.userw;
  locked_subscription public.subscriptionw;
  credit_amount integer := greatest(0, coalesce(p_credits, 0));
  subscription_days integer := greatest(0, coalesce(p_subscription_days, 0));
  subscription_base timestamptz;
  subscription_end timestamptz;
begin
  select *
  into locked_payment
  from public.paymentw
  where provider = 'flutterwave'
    and tx_ref = p_tx_ref
    and user_id = target_user_id
  for update;

  if locked_payment.id is not null and locked_payment.status = 'successful' then
    select * into updated_profile from public.userw where id = target_user_id;
    return updated_profile;
  end if;

  if locked_payment.id is null then
    insert into public.paymentw (
      user_id,
      plan_id,
      amount,
      currency,
      credits,
      provider,
      provider_reference,
      tx_ref,
      status,
      raw_response
    )
    values (
      target_user_id,
      p_plan_id,
      p_amount,
      p_currency,
      credit_amount,
      'flutterwave',
      p_provider_reference,
      p_tx_ref,
      'successful',
      p_raw_response
    );
  else
    update public.paymentw
    set provider_reference = p_provider_reference,
        status = 'successful',
        raw_response = p_raw_response,
        amount = p_amount,
        currency = p_currency,
        credits = credit_amount,
        plan_id = p_plan_id
    where id = locked_payment.id;
  end if;

  update public.userw
  set voice_credits = voice_credits + credit_amount
  where id = target_user_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'No userw profile found for payment user';
  end if;

  if subscription_days > 0 then
    select *
    into locked_subscription
    from public.subscriptionw
    where user_id = target_user_id
    for update;

    subscription_base := greatest(now(), coalesce(locked_subscription.current_period_end, now()));
    subscription_end := subscription_base + make_interval(days => subscription_days);

    if locked_subscription.id is null then
      insert into public.subscriptionw (user_id, plan_id, status, current_period_start, current_period_end)
      values (target_user_id, p_plan_id, 'active', now(), subscription_end);
    else
      update public.subscriptionw
      set plan_id = p_plan_id,
          status = 'active',
          current_period_start = now(),
          current_period_end = subscription_end
      where id = locked_subscription.id;
    end if;
  end if;

  if credit_amount > 0 then
    insert into public.creditw (
      user_id,
      amount,
      balance_after,
      transaction_type,
      description,
      provider,
      provider_reference
    )
    values (
      target_user_id,
      credit_amount,
      updated_profile.voice_credits,
      'purchase',
      'Flutterwave voice credit top-up',
      'flutterwave',
      p_provider_reference
    );
  end if;

  return updated_profile;
end;
$$;

revoke execute on function public.apply_flutterwave_paymentw(uuid, text, numeric, text, integer, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_flutterwave_paymentw(uuid, text, numeric, text, integer, integer, text, text, jsonb) to service_role;

create or replace function public.start_voice_usagew(target_user_id uuid, credits_per_minute integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  debit_amount integer := greatest(1, coalesce(credits_per_minute, 2));
  current_profile public.userw;
  updated_profile public.userw;
  active_subscription public.subscriptionw;
  usage_id uuid;
begin
  select *
  into current_profile
  from public.userw
  where id = target_user_id
  for update;

  if current_profile.id is null then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;

  select *
  into active_subscription
  from public.subscriptionw
  where user_id = target_user_id
    and plan_id = 'unlimited_monthly'
    and status = 'active'
    and current_period_end > now()
  limit 1;

  if active_subscription.id is not null then
    insert into public.usage_sessionw (user_id, billed_minutes, credits_spent, last_billed_at)
    values (target_user_id, 1, 0, now())
    returning id into usage_id;

    return jsonb_build_object(
      'ok', true,
      'sessionId', usage_id,
      'chargedCredits', 0,
      'creditsPerMinute', debit_amount,
      'subscriptionActive', true,
      'subscriptionEndsAt', active_subscription.current_period_end,
      'profile', to_jsonb(current_profile)
    );
  end if;

  if current_profile.voice_credits < debit_amount then
    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CREDITS', 'profile', to_jsonb(current_profile), 'requiredCredits', debit_amount);
  end if;

  update public.userw
  set voice_credits = voice_credits - debit_amount
  where id = target_user_id
  returning * into updated_profile;

  insert into public.usage_sessionw (user_id, billed_minutes, credits_spent, last_billed_at)
  values (target_user_id, 1, debit_amount, now())
  returning id into usage_id;

  insert into public.creditw (user_id, amount, balance_after, transaction_type, description)
  values (target_user_id, -debit_amount, updated_profile.voice_credits, 'usage', 'Voice conversion started minute');

  return jsonb_build_object(
    'ok', true,
    'sessionId', usage_id,
    'chargedCredits', debit_amount,
    'creditsPerMinute', debit_amount,
    'profile', to_jsonb(updated_profile)
  );
end;
$$;

revoke execute on function public.start_voice_usagew(uuid, integer) from public, anon, authenticated;
grant execute on function public.start_voice_usagew(uuid, integer) to service_role;

create or replace function public.bill_voice_usagew(target_user_id uuid, usage_session_id uuid, credits_per_minute integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  debit_amount integer := greatest(1, coalesce(credits_per_minute, 2));
  current_profile public.userw;
  updated_profile public.userw;
  locked_session public.usage_sessionw;
  active_subscription public.subscriptionw;
begin
  select *
  into locked_session
  from public.usage_sessionw
  where id = usage_session_id
    and user_id = target_user_id
  for update;

  if locked_session.id is null or locked_session.status <> 'active' then
    select * into current_profile from public.userw where id = target_user_id;
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_ACTIVE', 'profile', to_jsonb(current_profile));
  end if;

  select *
  into current_profile
  from public.userw
  where id = target_user_id
  for update;

  select *
  into active_subscription
  from public.subscriptionw
  where user_id = target_user_id
    and plan_id = 'unlimited_monthly'
    and status = 'active'
    and current_period_end > now()
  limit 1;

  if active_subscription.id is not null then
    update public.usage_sessionw
    set last_billed_at = now(),
        billed_minutes = billed_minutes + 1
    where id = usage_session_id;

    return jsonb_build_object(
      'ok', true,
      'sessionId', usage_session_id,
      'chargedCredits', 0,
      'creditsPerMinute', debit_amount,
      'subscriptionActive', true,
      'subscriptionEndsAt', active_subscription.current_period_end,
      'profile', to_jsonb(current_profile)
    );
  end if;

  if current_profile.voice_credits < debit_amount then
    update public.usage_sessionw
    set status = 'ended',
        ended_at = coalesce(ended_at, now())
    where id = usage_session_id;

    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CREDITS', 'profile', to_jsonb(current_profile), 'requiredCredits', debit_amount);
  end if;

  update public.userw
  set voice_credits = voice_credits - debit_amount
  where id = target_user_id
  returning * into updated_profile;

  update public.usage_sessionw
  set last_billed_at = now(),
      billed_minutes = billed_minutes + 1,
      credits_spent = credits_spent + debit_amount
  where id = usage_session_id;

  insert into public.creditw (user_id, amount, balance_after, transaction_type, description)
  values (target_user_id, -debit_amount, updated_profile.voice_credits, 'usage', 'Voice conversion additional minute');

  return jsonb_build_object(
    'ok', true,
    'sessionId', usage_session_id,
    'chargedCredits', debit_amount,
    'creditsPerMinute', debit_amount,
    'profile', to_jsonb(updated_profile)
  );
end;
$$;

revoke execute on function public.bill_voice_usagew(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.bill_voice_usagew(uuid, uuid, integer) to service_role;

create or replace function public.stop_voice_usagew(target_user_id uuid, usage_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.userw;
begin
  update public.usage_sessionw
  set status = 'ended',
      ended_at = coalesce(ended_at, now())
  where id = usage_session_id
    and user_id = target_user_id
    and status = 'active';

  select * into current_profile from public.userw where id = target_user_id;

  return jsonb_build_object(
    'ok', true,
    'sessionId', usage_session_id,
    'profile', to_jsonb(current_profile)
  );
end;
$$;

revoke execute on function public.stop_voice_usagew(uuid, uuid) from public, anon, authenticated;
grant execute on function public.stop_voice_usagew(uuid, uuid) to service_role;

-- Give existing zero-credit profiles the new starter amount, not the previous testing grant.
update public.userw
set voice_credits = 10
where voice_credits = 0;

insert into public.walletw (user_id)
select u.id
from public.userw u
where not exists (
  select 1
  from public.walletw w
  where w.user_id = u.id
);

insert into public.subscriptionw (user_id, plan_id, status)
select u.id, 'free', 'active'
from public.userw u
where not exists (
  select 1
  from public.subscriptionw s
  where s.user_id = u.id
);

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.userw to service_role;
grant select, insert, update, delete on table public.walletw to service_role;
grant select, insert, update, delete on table public.creditw to service_role;
grant select, insert, update, delete on table public.subscriptionw to service_role;
grant select, insert, update, delete on table public.paymentw to service_role;
grant select, insert, update, delete on table public.usage_sessionw to service_role;
grant execute on all functions in schema public to service_role;

notify pgrst, 'reload schema';
