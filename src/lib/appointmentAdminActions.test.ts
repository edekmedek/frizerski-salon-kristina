import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const adminSource = readFileSync('src/AdminApp.tsx', 'utf8')
const migration = readFileSync(
  'supabase/migrations/20260728_admin_reschedule_cancel_appointments.sql',
  'utf8',
)

describe('administratorski detalji i pomicanje termina', () => {
  it('klik na termin otvara detalje bez neposredne promjene', () => {
    expect(adminSource).toContain('setAppointmentDetails(item)')
    expect(adminSource).toContain('title="Detalji termina"')
    expect(adminSource).toContain('Pomakni termin')
    expect(adminSource).toContain('Otkaži termin')
  })

  it('pomicanje traži potvrdu i dopušta odustajanje bez spremanja', () => {
    expect(adminSource).toContain(
      'Termin je već zakazan. Želite li ga odglaviti i odabrati novi datum ili vrijeme?',
    )
    expect(adminSource).toContain('setRescheduleDraft(null)')
    expect(adminSource).toContain(
      "supabase.rpc('admin_reschedule_appointment'",
    )
  })

  it('prikazuje staro i novo vrijeme, završetak te traži override preklapanja', () => {
    expect(adminSource).toContain('Staro vrijeme')
    expect(adminSource).toContain('Novo vrijeme')
    expect(adminSource).toContain('Završetak')
    expect(adminSource).toContain('allow_overlap: overlapAllowed')
    expect(adminSource).toContain('Novo vrijeme preklapa se s')
  })

  it('RPC čuva tretmane i računa novi završetak iz snapshot trajanja', () => {
    expect(migration).toContain('for update')
    expect(migration).toMatch(
      /target_starts_at\s*\+\s*make_interval\(mins => duration_minutes\)/,
    )
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.appointment_services/i,
    )
    expect(migration).not.toMatch(
      /update\s+public\.appointment_services/i,
    )
  })
})

describe('administratorsko otkazivanje termina', () => {
  it('traži potvrdu, a razlog ostavlja neobaveznim', () => {
    expect(adminSource).toContain('Želite li otkazati termin za')
    expect(adminSource).toContain('Razlog otkazivanja (neobavezno)')
    expect(adminSource).toContain("supabase.rpc('admin_cancel_appointment'")
  })

  it('atomski otkazuje termin, usklađuje zahtjev i ne briše povijest', () => {
    expect(migration).toContain("set status = 'cancelled'")
    expect(migration).toContain("set status = 'rejected'")
    expect(migration).not.toMatch(/delete\s+from\s+public\.appointments/i)
    expect(migration.trimStart()).toMatch(/^begin;/)
    expect(migration.trimEnd()).toMatch(/commit;$/)
  })

  it('odbija ponovno otkazivanje i razlikuje pending prijedlog', () => {
    expect(migration).toContain("locked_appointment.status = 'cancelled'")
    expect(migration).toContain(
      "locked_appointment.confirmation_status <> 'confirmed'",
    )
  })

  it('stvara samo jednu trajnu obavijest po događaju', () => {
    expect(migration).toContain(
      "'appointment-cancelled:' || locked_appointment.id::text",
    )
    expect(migration).toContain("'appointment-rescheduled:'")
    expect(migration).toContain('on conflict (event_key) do nothing')
    expect(adminSource).toContain('if (cancelled.notification_created)')
    expect(adminSource).toContain('if (saved.notification_created)')
  })

  it('prikazuje konkretnu RPC pogrešku i osvježava raspored tek nakon uspjeha', () => {
    expect(adminSource).toContain(
      "console.error('admin_cancel_appointment failed', error)",
    )
    expect(adminSource).toContain(
      "console.error('admin_reschedule_appointment failed', error)",
    )
    expect(adminSource).toContain('await loadAdminAppointments()')
  })
})
