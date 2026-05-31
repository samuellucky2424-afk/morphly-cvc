-- Morphly cloud repair patch.
-- Run this in Supabase SQL Editor if Vercel health shows RPC permission errors
-- or profile/credit/payment requests return 500 after the app is deployed.

alter table public.subscriptionw alter column current_period_end drop not null;
alter table public.paymentw add column if not exists tx_ref text;

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
    grant execute on function public.apply_flutterwave_paymentw(uuid, text, numeric, text, integer, integer, text, text, jsonb) to service_role;
  end if;

  if to_regprocedure('public.start_voice_usagew(uuid,integer)') is not null then
    grant execute on function public.start_voice_usagew(uuid, integer) to service_role;
  end if;

  if to_regprocedure('public.bill_voice_usagew(uuid,uuid,integer)') is not null then
    grant execute on function public.bill_voice_usagew(uuid, uuid, integer) to service_role;
  end if;

  if to_regprocedure('public.stop_voice_usagew(uuid,uuid)') is not null then
    grant execute on function public.stop_voice_usagew(uuid, uuid) to service_role;
  end if;
end;
$$;
