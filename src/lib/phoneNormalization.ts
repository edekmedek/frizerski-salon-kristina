export function normalizePhone(value: string): string {
  let digits = String(value ?? '').replace(/\D/g, '')

  if (digits.startsWith('00')) {
    digits = digits.slice(2)
  }

  if (digits.startsWith('385')) {
    digits = `0${digits.slice(3)}`
  } else if (digits.startsWith('0385')) {
    digits = `0${digits.slice(4)}`
  }

  return digits
}

export const normalizeClientPhone = normalizePhone
export const salonNormalizePhone = normalizePhone
export const normalizePhoneNumber = normalizePhone
