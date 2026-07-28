import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync('src/ClientPortal.tsx', 'utf8')
const portalCss = readFileSync('src/Portal.css', 'utf8')
const adminSource = readFileSync('src/AdminApp.tsx', 'utf8')
const adminCss = readFileSync('src/AdminPortal.css', 'utf8')
const backendMigration = readFileSync(
  'supabase/migrations/20260728_optional_request_services_and_confirmation_notice.sql',
  'utf8',
)

describe('client appointment request picker', () => {
  it('starts with compact categories and closes a category after selection', () => {
    expect(clientSource).toContain('client-service-categories')
    expect(clientSource).toContain("onClick={()=>setRequestCategory(category)}")
    expect(clientSource).toContain("setRequestCategory('')}}")
  })

  it('keeps selections from multiple categories and supports removing chips', () => {
    expect(clientSource).toContain("current.includes(item.id as string)?current:[...current,item.id as string]")
    expect(clientSource).toContain('client-treatment-chips')
    expect(clientSource).toContain('Ukloni ${item.name}')
  })

  it('requires only a date and asks for confirmation before the RPC', () => {
    expect(clientSource).toContain('<input required name="preferredDates" type="date"/>')
    expect(clientSource).not.toContain("if (!requestServiceIds.length)")
    expect(clientSource).toContain('pendingRequestSubmission&&')
    expect(clientSource).toContain("'Usluga nije odabrana'")
    expect(clientSource).toContain('Poslati želju Kristini?')
  })

  it('keeps the send action visible without covering content', () => {
    expect(clientSource).toContain('client-request-submit-bar')
    expect(portalCss).toContain('.client-request-submit-bar{position:sticky')
    expect(portalCss).toContain('env(safe-area-inset-bottom)')
    expect(portalCss).toContain('.client-request-screen{padding-bottom:')
  })

  it('allows an empty service list atomically while retaining the required date', () => {
    expect(backendMigration).toContain("'At least one preferred date is required'")
    expect(backendMigration).toContain('if cardinality(requested_ids) > 0 then')
    expect(backendMigration).toContain('from unnest(requested_ids) with ordinality')
  })

  it('marks pending and overlapping appointments independently', () => {
    expect(adminSource).toContain("'pending-confirmation'")
    expect(adminSource).toContain("'overlap-top'")
    expect(adminCss).toContain('.calendar-event.pending-confirmation')
    expect(adminCss).toContain('.calendar-event.overlap-top')
    expect(adminCss).toContain('.calendar-event.pending-confirmation.overlap-top')
  })

  it('stores one confirmation message and pushes only for a newly inserted event', () => {
    expect(backendMigration).toContain('messages_event_key_key')
    expect(adminSource).toContain('event_key: `appointment-confirmed:${savedId}`')
    expect(adminSource).toContain("ignoreDuplicates: true")
    expect(adminSource).toContain('(confirmationMessage.data ?? []).length > 0')
  })
})
