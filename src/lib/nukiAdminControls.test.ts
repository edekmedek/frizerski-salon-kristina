import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const adminSource = readFileSync('src/AdminApp.tsx', 'utf8')

describe('admin Nuki controls', () => {
  it('sends manual lock through the hardware gateway', () => {
    expect(adminSource).toContain('🔒</span> Zaključaj vrata')
    expect(adminSource).toContain("sendHardwareCommand('nuki', 'lock')")
  })

  it('preserves the existing local open-door fallback without adding a lock deep link', () => {
    expect(adminSource).toContain("window.location.href = 'salonkristina://nuki/unlock'")
    expect(adminSource).not.toContain("window.location.href = 'salonkristina://nuki/lock'")
  })
})
