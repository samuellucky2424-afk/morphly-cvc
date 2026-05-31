-- Morphly cloud repair patch.
-- Run this entire file in Supabase SQL Editor for the same project used by Vercel
-- if health shows RPC permission errors or profile/credit/payment requests return 500.

alter table public.subscriptionw alter column current_period_end drop not null;
alter table public.paymentw add column if not exists tx_ref text;
alter table public.creditw add column if not exists balance_after integer;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.userw to service_role;
grant select, insert, update, delete on table public.walletw to service_role;
grant select, insert, update, delete on table public.creditw to service_role;
grant select, insert, update, delete on table public.subscriptionw to service_role;
grant select, insert, update, delete on table public.paymentw to service_role;
grant select, insert, update, delete on table public.usage_sessionw to service_role;

grant execute on all functions in schema public to service_role;

do $$
begin
  if to_regprocedure('public.apply_flutterwave_paymentw(uuid,text,numeric,text,integer,integer,text,text,jsonb)') is not null then
    alter function public.apply_flutterwave_paymentw(uuid, text, numeric, text, integer, integer, text, text, jsonb) owner to postgres;
    grant execute on function public.apply_flutterwave_paymentw(uuid, text, numeric, text, integer, integer, text, text, jsonb) to service_role;
  end if;

  if to_regprocedure('public.start_voice_usagew(uuid,integer)') is not null then
    alter function public.start_voice_usagew(uuid, integer) owner to postgres;
    grant execute on function public.start_voice_usagew(uuid, integer) to service_role;
  end if;

  if to_regprocedure('public.bill_voice_usagew(uuid,uuid,integer)') is not null then
    alter function public.bill_voice_usagew(uuid, uuid, integer) owner to postgres;
    grant execute on function public.bill_voice_usagew(uuid, uuid, integer) to service_role;
  end if;

  if to_regprocedure('public.stop_voice_usagew(uuid,uuid)') is not null then
    alter function public.stop_voice_usagew(uuid, uuid) owner to postgres;
    grant execute on function public.stop_voice_usagew(uuid, uuid) to service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';

select
  'paymentw insert' as check_name,
  has_table_privilege('service_role', 'public.paymentw', 'insert') as service_role_ok
union all
select
  'userw insert' as check_name,
  has_table_privilege('service_role', 'public.userw', 'insert') as service_role_ok
union all
select
  'start_voice_usagew execute' as check_name,
  coalesce(has_function_privilege('service_role', to_regprocedure('public.start_voice_usagew(uuid,integer)'), 'execute'), false) as service_role_ok
union all
select
  'bill_voice_usagew execute' as check_name,
  coalesce(has_function_privilege('service_role', to_regprocedure('public.bill_voice_usagew(uuid,uuid,integer)'), 'execute'), false) as service_role_ok
union all
select
  'stop_voice_usagew execute' as check_name,
  coalesce(has_function_privilege('service_role', to_regprocedure('public.stop_voice_usagew(uuid,uuid)'), 'execute'), false) as service_role_ok;
