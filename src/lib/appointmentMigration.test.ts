import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260726_appointment_treatments_and_utf8.sql'),
  'utf8',
)

describe('aditivna migracija tretmana', () => {
  it('zadržava legacy stupce i nema destruktivne DDL naredbe', () => {
    expect(migration).toContain('create table if not exists public.appointment_services')
    expect(migration).toContain('add column if not exists total_price_snapshot')
    expect(migration.toLocaleLowerCase('en')).not.toContain('drop table')
    expect(migration.toLocaleLowerCase('en')).not.toContain('truncate')
  })

  it('precizno popravlja katalog po stabilnim kodovima', () => {
    expect(migration).toContain("where category.code = corrected.code")
    expect(migration).toContain('where service.source_code = corrected.source_code')
    expect(migration).not.toContain('WIN1252')
  })
})
