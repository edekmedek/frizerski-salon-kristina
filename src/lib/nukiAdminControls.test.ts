import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const adminSource = readFileSync('src/AdminApp.tsx', 'utf8')
const adminStyles = readFileSync('src/AdminPortal.css', 'utf8')

describe('admin Nuki controls', () => {
  it('sends manual lock through the hardware gateway', () => {
    expect(adminSource).toContain('🔒</span> Zaključaj vrata')
    expect(adminSource).toContain("sendHardwareCommand('nuki', 'lock')")
  })

  it('preserves the existing local open-door fallback without adding a lock deep link', () => {
    expect(adminSource).toContain("window.location.href = 'salonkristina://nuki/unlock'")
    expect(adminSource).not.toContain("window.location.href = 'salonkristina://nuki/lock'")
  })

  it('keeps both door actions visible in the responsive hardware header', () => {
    expect(adminStyles).toContain('@media (max-width: 1100px)')
    expect(adminStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(adminStyles).toContain('@media (max-width: 500px)')
    expect(adminStyles).toContain('.app-shell.has-door-controls .door-lock-controls,')
  })
})
