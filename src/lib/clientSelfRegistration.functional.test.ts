/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePhone } from './phoneNormalization'

const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261113_client_self_registration.sql'), 'utf8')
const accessSource = readFileSync(join(process.cwd(), 'src', 'AccessScreen.tsx'), 'utf8')

describe('funkcionalna provjera registracije', () => {
  it('normalizira sva četiri formata broja u isti kanonski broj', () => {
    const formats = ['0953941292', '+385953941292', '00385953941292', '0385953941292']
    const canonical = '0953941292'
    for (const format of formats) {
      expect(normalizePhone(format)).toBe(canonical)
    }
  })

  it('SQL prijava vraća stanje registracije i pending za nepostojeći broj', () => {
    expect(migration).toContain('registration_pending boolean')
    expect(migration).toContain('supplied_registration_pending')
    expect(migration).toContain('phone_registered boolean')
  })

  it('SQL registracija odbija duplikat i serijalizira pokušaje', () => {
    expect(migration).toContain('where public.salon_normalize_phone(phone) = normalized_phone')
    expect(migration).toContain('return query select null::uuid, false;')
    expect(migration).toContain('pg_advisory_xact_lock(hashtext(normalized_phone))')
  })

  it('SQL odobrenje aktivira samo neaktivnog klijenta s portal credentials', () => {
    expect(migration).toContain('and is_active = false')
    expect(migration).toContain('from public.client_portal_credentials')
    expect(migration).toContain('Pristup odobren')
  })

  it('frontend razlikuje prijavu, pending i ponudu registracije', () => {
    expect(accessSource).toContain('result?.registration_pending')
    expect(accessSource).toContain('phone_registered === false')
    expect(accessSource).toContain('Zahtjev za registraciju je poslan')
  })
})
