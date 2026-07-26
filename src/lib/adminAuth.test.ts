import { describe, expect, it } from 'vitest'
import { adminLoginErrorMessage, adminRecoveryRedirect, adminRoleErrorMessage } from './adminAuth'

describe('administratorska autentikacija', () => {
  it('razlikuje pogrešne podatke, nepotvrđeni e-mail i privremenu grešku', () => {
    expect(adminLoginErrorMessage({ code: 'invalid_credentials' })).toBe('E-mail ili lozinka nisu ispravni.')
    expect(adminLoginErrorMessage({ code: 'email_not_confirmed' })).toContain('nije potvrđena')
    expect(adminLoginErrorMessage({ status: 503 })).toContain('trenutačno nije dostupna')
  })

  it('uspješnu autentikaciju bez admin uloge opisuje kao problem ovlasti', () => {
    expect(adminRoleErrorMessage(undefined, false)).toContain('nema administratorske ovlasti')
    expect(adminRoleErrorMessage('client', false)).toContain('nema administratorske ovlasti')
    expect(adminRoleErrorMessage(null, true)).toContain('provjera administratorskih ovlasti')
    expect(adminRoleErrorMessage('admin', false)).toBe('')
  })

  it('recovery vraća na produkcijsku baznu putanju bez hash-rute', () => {
    expect(adminRecoveryRedirect('https://edekmedek.github.io', '/frizerski-salon-kristina/'))
      .toBe('https://edekmedek.github.io/frizerski-salon-kristina/?admin-recovery=1')
  })
})
