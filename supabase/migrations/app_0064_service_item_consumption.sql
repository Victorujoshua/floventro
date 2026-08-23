-- Service item consumptions: records usage of catalog-based service items per session.
-- Cost is frozen at recording time (proportional or flat). Zero engine touch.

create table if not exists public.service_item_consumptions (
  id                uuid        primary key default gen_random_uuid(),
  service_record_id uuid        not null references public.service_records(id)  on delete restrict,
  service_item_id   uuid        not null references public.service_items(id)    on delete restrict,
  amount_used       numeric,                -- units consumed; set to 1 for flat/equipment
  cost_cents        bigint      not null check (cost_cents >= 0),
  created_by        uuid        not null references auth.users(id),
  created_at        timestamptz not null default now()
);

create index if not exists sic_record_idx on public.service_item_consumptions (service_record_id);
create index if not exists sic_item_idx   on public.service_item_consumptions (service_item_id);

alter table public.service_item_consumptions enable row level security;
alter table public.service_item_consumptions force row level security;

-- Org members can read consumptions for records in their organisation.
create policy "sic_select"
  on public.service_item_consumptions for select
  to authenticated
  using (
    service_record_id in (
      select id from public.service_records
       where organisation_id in (select public.user_member_org_ids())
    )
  );

-- Direct INSERT/UPDATE/DELETE disabled — all writes go through the RPC below.
revoke insert, update, delete on table public.service_item_consumptions from public, authenticated;
grant select on table public.service_item_consumptions to authenticated;

-- ── RPC ──────────────────────────────────────────────────────────────────────

create or replace function public.add_service_item_consumption(
  p_service_record_id uuid,
  p_lines             jsonb   -- [{service_item_id, amount_used?}]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_performed_by uuid;
  v_org_id       uuid;
  v_line         jsonb;
  v_item_id      uuid;
  v_amount_used  numeric;
  v_item_cat     text;
  v_item_pkg     numeric;
  v_item_amt     bigint;
  v_item_active  boolean;
  v_cost_cents   bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select performed_by, organisation_id
    into v_performed_by, v_org_id
    from public.service_records
   where id = p_service_record_id;

  if not found then
    raise exception 'service record not found';
  end if;

  if v_performed_by <> v_user_id then
    raise exception 'not authorised: only the performer can add consumption to this session';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one line is required';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id     := (v_line->>'service_item_id')::uuid;
    v_amount_used := case
                       when (v_line->>'amount_used') is not null
                            and trim(v_line->>'amount_used') <> ''
                         then (v_line->>'amount_used')::numeric
                       else null
                     end;

    select category, package_size, amount_cents, is_active
      into v_item_cat, v_item_pkg, v_item_amt, v_item_active
      from public.service_items
     where id              = v_item_id
       and organisation_id = v_org_id
       and deleted_at      is null;

    if not found then
      raise exception 'service item % not found in this organisation', v_item_id;
    end if;

    if not v_item_active then
      raise exception 'service item % is inactive', v_item_id;
    end if;

    -- Equipment or null package_size → flat fee, cost = amount_cents, amount_used = 1.
    -- Consumable with package_size → proportional: round(amount_cents / package_size * amount_used).
    if v_item_cat = 'equipment' or v_item_pkg is null then
      v_cost_cents  := v_item_amt;
      v_amount_used := 1;
    else
      if v_amount_used is null or v_amount_used <= 0 then
        raise exception 'amount_used must be positive for consumable service item %', v_item_id;
      end if;
      v_cost_cents := round((v_item_amt::numeric / v_item_pkg) * v_amount_used);
    end if;

    insert into public.service_item_consumptions (
      service_record_id, service_item_id,
      amount_used, cost_cents, created_by
    ) values (
      p_service_record_id, v_item_id,
      v_amount_used, v_cost_cents, v_user_id
    );
  end loop;
end;
$$;

grant execute on function public.add_service_item_consumption(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
