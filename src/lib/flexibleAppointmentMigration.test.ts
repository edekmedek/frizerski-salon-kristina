import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260728_appointment_confirmation_and_request_services.sql',
  'utf8',
)
const adminSource = readFileSync('src/AdminApp.tsx', 'utf8')
const clientSource = readFileSync('src/ClientPortal.tsx', 'utf8')

describe('normalized appointment confirmation phase A', () => {
  it('separates lifecycle and confirmation state', () => {
    expect(migration).toContain('add column if not exists confirmation_status')
    expect(migration).toContain("check (confirmation_status in ('pending', 'confirmed'))")
    expect(migration).toContain('target_lifecycle_status text')
    expect(migration).toContain('target_confirmation_status text')
    expect(migration).not.toContain('pending_confirmation')
  })

  it('allows no services and validates quarter-hour duration', () => {
    expect(migration).toContain(
      "requested_ids uuid[] := coalesce(target_service_ids, '{}'::uuid[])",
    )
    expect(migration).toContain('target_total_duration % 15 <> 0')
    expect(adminSource).toContain(
      'isValidAppointmentDuration(appointmentForm.serviceDuration)',
    )
  })

  it('normalizes request treatments without array columns', () => {
    expect(migration).toContain(
      'create table if not exists public.client_request_services',
    )
    expect(migration).not.toContain('add column if not exists service_ids')
    expect(migration).not.toContain('add column if not exists service_names')
    expect(clientSource).toContain('requested_service_ids: requestServiceIds')
    expect(migration).toContain("and cardinality(requested_ids) = 0")
    expect(migration).toContain("'At least one preferred date is required'")
    expect(migration).toContain('if cardinality(requested_ids) > 0 then')
    expect(migration).toContain(
      "'public.client_submit_request(text,text,date[],text,text,uuid)'",
    )
    expect(clientSource).toContain(
      "console.error('client_submit_request nije uspio.', error)",
    )
  })

  it('replaces only one appointment treatment set atomically', () => {
    expect(migration).toContain(
      'delete from public.appointment_services where appointment_id = saved_id',
    )
    expect(migration).not.toContain('is_selected')
  })

  it('reserves, confirms, and releases pending appointments', () => {
    expect(adminSource).toContain("target_confirmation_status: 'pending'")
    expect(migration).toContain('admin_confirm_pending_appointment')
    expect(migration).toContain("set confirmation_status = 'confirmed'")
    expect(migration).toContain(
      "set status = 'cancelled', confirmation_status = 'confirmed'",
    )
    expect(adminSource).toContain('Potvrdi termin odmah')
    expect(adminSource).toContain("'Čeka potvrdu'")
    expect(clientSource).not.toContain('use_reserved_appointment')
  })

  it('restricts request treatment rows to admin or the owning client', () => {
    expect(migration).toContain('Admins manage client request services')
    expect(migration).toContain('Clients read own request services')
    expect(migration).toContain('client.user_id = auth.uid()')
  })
})
