export function normalizeAdminPin(value: string) {
  return value.replace(/\D/g, '').slice(0, 4)
}

export function isValidAdminPin(value: string) {
  return /^\d{4}$/.test(value)
}
