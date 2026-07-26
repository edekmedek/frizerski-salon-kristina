export interface AuthFailure {
  message?: string
  code?: string
  status?: number
}

export function adminLoginErrorMessage(error: AuthFailure) {
  const code = error.code ?? ''
  const message = (error.message ?? '').toLocaleLowerCase('en')
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'E-mail adresa još nije potvrđena u Supabaseu.'
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'E-mail ili lozinka nisu ispravni.'
  }
  if (code === 'over_request_rate_limit' || error.status === 429) {
    return 'Previše pokušaja prijave. Pričekajte nekoliko minuta i pokušajte ponovno.'
  }
  return 'Prijava trenutačno nije dostupna. Pokušajte ponovno.'
}

export function adminRecoveryRedirect(origin: string, baseUrl: string) {
  const url = new URL(baseUrl, origin)
  url.searchParams.set('admin-recovery', '1')
  return url.toString()
}

export function adminRoleErrorMessage(role: string | null | undefined, roleLookupFailed: boolean) {
  if (roleLookupFailed) return 'Prijava je uspjela, ali provjera administratorskih ovlasti nije dostupna.'
  if (role !== 'admin') return 'Prijava je uspjela, ali ovaj račun nema administratorske ovlasti.'
  return ''
}
