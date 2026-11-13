/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261113_client_self_registration.sql'), 'utf8')
const accessSource = readFileSync(join(process.cwd(), 'src', 'AccessScreen.tsx'), 'utf8')

describe('samoregistracija novih klijenata', () => {
  it('kreira neaktivnog klijenta bez neposrednog pristupa', () => {
    expect(migration).toContain("values (btrim(first_name), btrim(last_name), phone_value, false)")
    expect(migration).not.toContain("values (btrim(first_name), btrim(last_name), phone_value, true)")
  })

  it('ne povezuje anonimnu sesiju s klijentom pri registraciji', () => {
    expect(migration).toContain("delete from public.client_portal_login_guards where auth_user_id = auth.uid()")
  })

  it('razlikuje poslanu registraciju od nepostojeceg broja pri prijavi', () => {
    expect(migration).toContain('registration_pending boolean')
    expect(migration).toContain('supplied_registration_pending')
  })

  it('obavjestava Kristinu kroz postojeci inbox', () => {
    expect(migration).toContain("'Novi zahtjev za registraciju'")
    expect(migration).toContain("insert into public.messages")
  })

  it('predvida odobrenje registracije od strane administratora', () => {
    expect(migration).toContain('admin_approve_client_registration')
    expect(migration).toContain("'Pristup odobren'")
  })

  it('uklanja alternativne RPC funkcije', () => {
    expect(migration).not.toContain('create or replace function public.register_client(')
    expect(migration).not.toContain('create or replace function public.client_register_portal(')
    expect(migration).not.toContain('create or replace function public.register_client_account(')
  })

  it('frontend ne prijavljuje klijenta prije odobrenja', () => {
    expect(accessSource).toContain('Zahtjev za registraciju je poslan')
    expect(accessSource).toContain('registration_pending')
  })

  it('normalizacija pokriva sve četiri formata broja', () => {
    expect(migration).toContain("if digits like '00%'")
    expect(migration).toContain("if digits like '385%'")
    expect(migration).toContain("elsif digits like '0385%'")
  })

  it('pogrešan PIN ostaje neuspješna prijava', () => {
    expect(migration).toContain("stored_pin_hash <> extensions.crypt(pin_value, stored_pin_hash)")
    expect(migration).toContain('return query select null::uuid, false, false, supplied_phone_exists, supplied_registration_pending;')
  })

  it('nepostojeći broj vraća phone_registered false', () => {
    expect(migration).toContain('phone_registered boolean')
    expect(accessSource).toContain('phone_registered === false')
  })

  it('duplikat onemogućava novu registraciju', () => {
    expect(migration).toContain('where public.salon_normalize_phone(phone) = normalized_phone')
    expect(migration).toContain('return query select null::uuid, false;')
  })

  it('neodobreni klijent ostaje neaktivan i pending', () => {
    expect(migration).toContain("values (btrim(first_name), btrim(last_name), phone_value, false)")
    expect(migration).toContain('supplied_registration_pending')
  })

  it('sprječava zaobilaženje ograničenja pokušaja prijave', () => {
    expect(accessSource).toContain('await ensureAnonymousSession()')
    expect(accessSource).not.toContain('await ensureAnonymousSession(true)')
  })

  it('neregistrirani broj nudi registraciju, ispravak i povratak', () => {
    expect(accessSource).toContain('Ispravi broj')
    expect(accessSource).toContain('Povratak na prijavu')
  })
})
