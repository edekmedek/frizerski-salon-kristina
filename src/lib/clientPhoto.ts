export const CLIENT_PHOTOS_BUCKET = 'client-photos'
export const MAX_PRIVATE_PHOTO_BYTES = 5 * 1024 * 1024
export const MAX_SOURCE_PHOTO_BYTES = 30 * 1024 * 1024

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const supportedExtensions = /\.(jpe?g|png|webp|heic|heif)$/i

export function validateClientPhoto(file: File): string | null {
  const supportedType = supportedMimeTypes.has(file.type.toLowerCase())
  const supportedExtension = supportedExtensions.test(file.name)

  if (!supportedType && !supportedExtension) {
    return 'Odaberite JPEG, PNG, WebP, HEIC ili HEIF fotografiju.'
  }

  if (file.size > MAX_SOURCE_PHOTO_BYTES) {
    return 'Fotografija je veća od 30 MB. Odaberite manju fotografiju.'
  }

  return null
}

export function dataUrlByteSize(value: string): number {
  const encoded = value.split(',')[1] ?? ''
  return Math.ceil((encoded.length * 3) / 4)
}
