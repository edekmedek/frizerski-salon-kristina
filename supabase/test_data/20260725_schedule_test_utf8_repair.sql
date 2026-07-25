-- Repairs only rows created by 20260725_schedule_test_seed.sql.
-- All Croatian characters use PostgreSQL Unicode escapes, so this file is
-- safe to copy through Windows PowerShell without code-page conversion.

begin;

with corrected_clients (id, first_name, last_name) as (
  values
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'TEST Ana', U&'Radi\0107'),
    ('a1000000-0000-4000-8000-000000000002'::uuid, 'TEST Marko', U&'Kova\010Devi\0107'),
    ('a1000000-0000-4000-8000-000000000003'::uuid, 'TEST Petra', 'Horvat'),
    ('a1000000-0000-4000-8000-000000000004'::uuid, 'TEST Luka', U&'Bari\0161i\0107'),
    ('a1000000-0000-4000-8000-000000000005'::uuid, 'TEST Ivana', U&'Juri\0107'),
    ('a1000000-0000-4000-8000-000000000006'::uuid, 'TEST Nikola', U&'Peri\0107'),
    ('a1000000-0000-4000-8000-000000000007'::uuid, 'TEST Maja', U&'Bo\017Ei\0107'),
    ('a1000000-0000-4000-8000-000000000008'::uuid, 'TEST Dario', U&'Mari\0107'),
    ('a1000000-0000-4000-8000-000000000009'::uuid, 'TEST Lucija', U&'Vukovi\0107'),
    ('a1000000-0000-4000-8000-000000000010'::uuid, 'TEST Tomislav', U&'Pavi\0107'),
    ('a1000000-0000-4000-8000-000000000011'::uuid, 'TEST Ema', U&'\0160ari\0107'),
    ('a1000000-0000-4000-8000-000000000012'::uuid, 'TEST Filip', U&'Babi\0107')
)
update public.clients client
set first_name = corrected.first_name,
    last_name = corrected.last_name,
    notes = U&'[TEST] Izmi\0161ljeni klijent za provjeru rasporeda.'
from corrected_clients corrected
where client.id = corrected.id
  and client.test_seed_tag = 'kristina_schedule_seed_v1';

with corrected_services (source_code, corrected_name) as (
  values
    (11, U&'Bojenje obrva'),
    (13, U&'Bojenje trepavica'),
    (14, U&'Botox 1'),
    (15, U&'Botox 2'),
    (16, U&'Botox 3'),
    (17, U&'Botox 4'),
    (18, U&'Botox 5'),
    (22, U&'Keratin 1'),
    (23, U&'Keratin 2'),
    (24, U&'Keratin 3'),
    (25, U&'Keratin 4'),
    (26, U&'Keratin 5'),
    (27, U&'Keratin 6'),
    (28, U&'Keratin 7'),
    (30, U&'Minival srednja kosa'),
    (31, U&'Minival kratka kosa'),
    (32, U&'Minival duga kosa'),
    (40, U&'Pranje kose'),
    (47, U&'Sve\010Dana frizura duga kosa'),
    (48, U&'Sve\010Dana frizura srednja kosa'),
    (49, U&'Sve\010Dana frizura kratka kosa'),
    (54, U&'\0160i\0161anje i oblikovanje'),
    (55, U&'\0160i\0161anje i pranje kose'),
    (56, U&'\0160i\0161anje kose'),
    (57, U&'\0160i\0161anje kose ma\0161inica'),
    (58, U&'\0160i\0161anje \0161i\0161ki'),
    (59, U&'\0160i\0161anje pranje i oblikovanje'),
    (63, U&'Vjen\010Dana frizura duga kosa'),
    (64, U&'Vjen\010Dana frizura srednjaa kosa'),
    (65, U&'Vjen\010Dana frizura kratka kosa'),
    (66, U&'\010Ce\0161ljanje'),
    (103, U&'Defy Damage tretman 1'),
    (104, U&'Defy Damage tretman 2'),
    (105, U&'K-pack reconstructor 1'),
    (106, U&'K-pack reconstructor 2'),
    (107, U&'K-pack reconstructor 3'),
    (116, U&'Frizura S'),
    (117, U&'Frizura M'),
    (118, U&'Frizura L'),
    (119, U&'Frizura XL'),
    (120, U&'Frizura XXL'),
    (121, U&'\0160i\0161anje i frizura S'),
    (122, U&'\0160i\0161anje i frizura M'),
    (123, U&'\0160i\0161anje i frizura L'),
    (124, U&'\0160i\0161anje i frizura XL'),
    (125, U&'\0160i\0161anje i frizura XXL'),
    (129, U&'Defy Damage tretman 3'),
    (130, U&'Frizura XS'),
    (131, U&'\0160i\0161anje i frizura XS')
)
update public.appointments appointment
set service = corrected.corrected_name,
    service_name_snapshot = corrected.corrected_name,
    notes = U&'[TEST] Probni termin \2013 kristina_schedule_seed_v1'
from public.services service
join corrected_services corrected on corrected.source_code = service.source_code
where appointment.service_id = service.id
  and appointment.test_seed_tag = 'kristina_schedule_seed_v1';

commit;

select
  (select count(*) from public.clients
   where test_seed_tag = 'kristina_schedule_seed_v1') as repaired_test_clients,
  (select count(*) from public.appointments
   where test_seed_tag = 'kristina_schedule_seed_v1') as repaired_test_appointments;
