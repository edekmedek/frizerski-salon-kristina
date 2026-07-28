import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260728_admin_edit_request_treatments.sql',
  'utf8',
)
const functionStart = migration.indexOf(
  'create or replace function public.admin_create_custom_proposal_for_client_request',
)
const functionEnd = migration.indexOf('revoke all on function', functionStart)
const proposalFunction = migration.slice(functionStart, functionEnd)

describe('atomsko uređivanje tretmana zahtjeva', () => {
  it('sprema konačne tretmane i trajanja u zahtjev i termin', () => {
    expect(proposalFunction).toContain('delete from public.client_request_services')
    expect(proposalFunction).toContain('insert into public.client_request_services')
    expect(proposalFunction).toContain('insert into public.appointments')
    expect(proposalFunction).toContain('insert into public.appointment_services')
    expect(proposalFunction).toContain("(item.value ->> 'duration_minutes')::integer")
  })

  it('koristi uređeno ukupno trajanje za završetak termina', () => {
    expect(proposalFunction).toContain(
      'target_starts_at + make_interval(mins => target_total_duration)',
    )
    expect(proposalFunction).toContain(
      'duration_sum <> target_total_duration',
    )
  })

  it('podržava prazan popis tretmana bez izmišljanja UUID-a', () => {
    expect(proposalFunction).toContain(
      "treatments jsonb := coalesce(target_treatments, '[]'::jsonb)",
    )
    expect(proposalFunction).toContain("coalesce(combined_names, '')")
  })

  it('sve promjene ostavlja u jednoj PostgreSQL transakciji bez hvatanja greške', () => {
    expect(migration.trimStart()).toMatch(/^begin;/)
    expect(migration.trimEnd()).toMatch(/commit;$/)
    expect(proposalFunction).not.toMatch(/exception\s+when/i)
  })

  it('RPC je dostupan samo prijavljenoj ulozi i ponovno provjerava administratora', () => {
    expect(proposalFunction).toContain('not public.is_admin()')
    expect(migration).toContain('from public, anon')
    expect(migration).toContain('to authenticated')
  })
})
