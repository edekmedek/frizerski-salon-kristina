export function createEmptyAdminPinFields() {
  return { current: '', next: '', confirmation: '' }
}

export function normalizeAdminPin(value: string) {
  return value.replace(/\D/g, '').slice(0, 4)
}

export function isValidAdminPin(value: string) {
  return /^\d{4}$/.test(value)
}

export function normalizeCurrentAdminPin(value: string) {
  return value.replace(/\D/g, '').slice(0, 6)
}

export function isValidCurrentAdminPin(value: string) {
  return /^\d{4,6}$/.test(value)
}
