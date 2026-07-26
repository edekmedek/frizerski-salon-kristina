import { describe, expect, it } from 'vitest'
import { pushErrorMessage, SALON_VAPID_PUBLIC_KEY } from './pushNotifications'

describe('mobilne push obavijesti', () => {
  it('ima valjani javni VAPID ključ dostupan produkcijskom buildu', () => {
    expect(SALON_VAPID_PUBLIC_KEY).toMatch(/^[A-Za-z0-9_-]{80,90}$/)
  })

  it('daje jasnu Android uputu kada je dopuštenje blokirano', () => {
    expect(pushErrorMessage(new DOMException('blocked', 'NotAllowedError'))).toContain('Postavke telefona')
  })

  it('razlikuje istek prijave od greške uređaja', () => {
    expect(pushErrorMessage(new Error('Client access could not be verified'))).toContain('ponovno prijavite')
    expect(pushErrorMessage(new Error('unknown'))).toContain('dopuštenje aplikacije')
  })
})
