import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260728_appointment_confirmation_and_request_services.sql',
  'utf8',
)
const adminSource = readFileSync('src/AdminApp.tsx', 'utf8')
const preflight = readFileSync(
  'supabase/manual/20260728_phase_a_preflight_readonly.sql',
  'utf8',
)

const atomicStart = migration.indexOf(
  'create or replace function public.admin_create_proposal_for_client_request',
)
const atomicEnd = migration.indexOf(
  'create or replace function public.client_respond_to_proposed_request',
)
const atomicFunction = migration.slice(atomicStart, atomicEnd)

describe('atomic client request proposal flow', () => {
  it('locks, creates, snapshots, and links in one database function', () => {
    expect(atomicStart).toBeGreaterThan(-1)
    expect(atomicFunction).toContain('for update')
    expect(atomicFunction).toContain('insert into public.appointments')
    expect(atomicFunction).toContain('insert into public.appointment_services')
    expect(atomicFunction).toContain('update public.client_requests')
    expect(atomicFunction).toContain('appointment_id = saved_appointment_id')
  })

  it('lets PostgreSQL roll back every write when a service or request step fails', () => {
    expect(atomicFunction).toContain("raise exception 'One or more services are unavailable'")
    expect(atomicFunction).toContain("raise exception 'Request could not be linked'")
    expect(atomicFunction).not.toMatch(/exception\s+when/i)
  })

  it('uses only the atomic RPC for request proposals', () => {
    expect(adminSource).toContain(
      "supabase.rpc('admin_create_proposal_for_client_request'",
    )
    expect(adminSource).not.toContain("supabase.rpc('admin_propose_client_request'")
  })

  it('refreshes inbox and calendar only after a successful proposal', () => {
    expect(adminSource).toContain('await refreshAdminServerState()')
    expect(adminSource).toContain(
      'setNotice(`Prijedlog nije spremljen. Termin nije dodan u kalendar.',
    )
  })

  it('keeps manual appointments on their separate save RPC', () => {
    expect(adminSource).toContain(
      "supabase.rpc('admin_save_appointment_with_services'",
    )
  })

  it('keeps the production preflight strictly read-only', () => {
    expect(preflight).not.toMatch(
      /\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i,
    )
    expect(preflight.match(/\bselect\b/gi)?.length).toBeGreaterThan(5)
  })
})
