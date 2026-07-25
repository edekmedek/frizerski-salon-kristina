-- Execute only when the TEST schedule data should be removed.
-- Targets the exact marker created by 20260725_schedule_test_seed.sql.

begin;

delete from public.appointments
where test_seed_tag = 'kristina_schedule_seed_v1';

delete from public.clients
where test_seed_tag = 'kristina_schedule_seed_v1';

commit;

select
  (select count(*) from public.clients where test_seed_tag = 'kristina_schedule_seed_v1') as remaining_test_clients,
  (select count(*) from public.appointments where test_seed_tag = 'kristina_schedule_seed_v1') as remaining_test_appointments;
