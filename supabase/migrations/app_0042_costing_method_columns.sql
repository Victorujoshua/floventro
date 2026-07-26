-- ALREADY APPLIED to live DB (step 1b, applied directly). This file records it
-- for repo history. Guarded so re-running is a no-op.
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_name='organisations' and column_name='costing_method') then
    alter table public.organisations
      add column costing_method text not null default 'weighted'
        check (costing_method in ('weighted','fifo')),
      add column costing_method_set_at timestamptz;
  end if;
end $$;
