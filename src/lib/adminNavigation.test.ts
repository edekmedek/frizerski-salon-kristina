import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('administratorska navigacija', () => {
  it('više ne izlaže zasebnu stranicu Termini', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'AdminApp.tsx'), 'utf8')
    expect(source).not.toContain("id: 'termini'")
    expect(source).not.toContain("view === 'termini'")
  })

  it('nakon uređivanja zahtjeva prikazuje kalendar prvog traženog dana', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'AdminApp.tsx'), 'utf8')
    expect(source).toContain("const date = request.preferredDates[0] || localDateString(new Date())")
    expect(source).toContain('void requestCalendarDate(date)')
    expect(source).toContain("setView('pregled')")
    expect(source).toContain('requestNeedsScrollRef.current = true')
    expect(source).toContain("scrollIntoView({ block: 'center'")
    expect(source).toContain('ref={requestDraftRef}')
  })

  it('prikazuje zahtjev kao pomični blok proporcionalan trajanju i dopušta preklapanje', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'AdminApp.tsx'), 'utf8')
    expect(source).toContain('request-draft-event')
    expect(source).toContain('requestDraftLayout.heightPercent')
    expect(source).toContain('onPointerMove=')
    expect(source).toContain('requestDraftConflicts.length')
    expect(source).toContain('sendSelectedRequestProposal')
    expect(source).toContain('Pošalji prijedlog termina')
    expect(source).toContain('item.serviceDuration')
    expect(source).toContain('calendarOverlapDepth(calendarAppointments,index)')
    expect(source).toContain("'overlap-top'")
  })
})
