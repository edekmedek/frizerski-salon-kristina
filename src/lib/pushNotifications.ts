export const SALON_VAPID_PUBLIC_KEY = 'BNwfDuMDLemjb76H_R76myA_P1eEp0QCyyBeHaik2lKjJCmR9SJkxZwt8eY-YecrIa7S532H4VH1lCZSHlLOAfo'

export function pushErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Obavijesti su blokirane. Otvorite Postavke telefona → Aplikacije → Salon Kristina → Obavijesti i uključite dopuštenje.'
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Android nije dovršio uključivanje obavijesti. Zatvorite aplikaciju, ponovno je otvorite i pokušajte još jednom.'
  }
  const message = error instanceof Error ? error.message : ''
  if (message.toLocaleLowerCase('en').includes('client access could not be verified')) {
    return 'Prijava je istekla. Odjavite se, ponovno prijavite i zatim uključite obavijesti.'
  }
  return 'Obavijesti nije moguće uključiti. Provjerite dopuštenje aplikacije u postavkama telefona.'
}
