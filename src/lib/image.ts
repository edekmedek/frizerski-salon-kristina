import type { ImageAsset } from '../types'
import { MAX_PRIVATE_PHOTO_BYTES } from './clientPhoto'

const MAX_SIDE = 1920
const THUMB_SIDE = 420

export function calculateResizedDimensions(
  width: number,
  height: number,
  maxSide: number,
) {
  if (width <= maxSide && height <= maxSide) return { width, height }
  const scale = Math.min(maxSide / width, maxSide / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Neuspjelo pretvaranje fotografije.'))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== 'image/webp') {
          reject(new Error('Ovaj preglednik ne podržava WebP obradu fotografije.'))
          return
        }
        resolve(blob)
      },
      'image/webp',
      quality,
    ),
  )
}

function renderImage(
  image: CanvasImageSource,
  width: number,
  height: number,
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Obrada fotografije nije dostupna.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  return canvas
}

function renderSquareThumbnail(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
) {
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_SIDE
  canvas.height = THUMB_SIDE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Obrada fotografije nije dostupna.')
  const cropSide = Math.min(sourceWidth, sourceHeight)
  const sourceX = (sourceWidth - cropSide) / 2
  const sourceY = (sourceHeight - cropSide) / 2
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropSide,
    cropSide,
    0,
    0,
    THUMB_SIDE,
    THUMB_SIDE,
  )
  return canvas
}

interface LoadedImage {
  source: CanvasImageSource
  width: number
  height: number
  cleanup: () => void
}

async function loadOrientedImage(file: File): Promise<LoadedImage> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      }
    } catch {
      // Safari can decode some HEIC files through Image even when ImageBitmap cannot.
    }
  }

  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        cleanup: () => URL.revokeObjectURL(url),
      })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Fotografiju nije moguće otvoriti. Provjerite podržava li preglednik njezin format.'))
    }
    image.src = url
  })
}

async function encodeWithinPrivateLimit(
  image: CanvasImageSource,
  originalWidth: number,
  originalHeight: number,
) {
  let dimensions = calculateResizedDimensions(originalWidth, originalHeight, MAX_SIDE)
  let quality = 0.84

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = renderImage(image, dimensions.width, dimensions.height)
    const blob = await canvasToWebp(canvas, quality)
    if (blob.size <= MAX_PRIVATE_PHOTO_BYTES) return blob
    quality = Math.max(0.56, quality - 0.07)
    dimensions = {
      width: Math.max(1, Math.round(dimensions.width * 0.86)),
      height: Math.max(1, Math.round(dimensions.height * 0.86)),
    }
  }

  throw new Error('Fotografiju nije moguće smanjiti ispod privatnog ograničenja od 5 MB.')
}

export async function compressImageToAsset(file: File): Promise<ImageAsset> {
  const loaded = await loadOrientedImage(file)
  try {
    const [fullBlob, thumbBlob] = await Promise.all([
      encodeWithinPrivateLimit(loaded.source, loaded.width, loaded.height),
      canvasToWebp(
        renderSquareThumbnail(loaded.source, loaded.width, loaded.height),
        0.78,
      ),
    ])
    const [full, thumb] = await Promise.all([
      blobToDataUrl(fullBlob),
      blobToDataUrl(thumbBlob),
    ])
    return { full, thumb }
  } finally {
    loaded.cleanup()
  }
}

export function createMonogramImage(
  label: string,
  tone: 'warm' | 'soft' = 'warm',
): ImageAsset {
  const background = tone === 'warm' ? '#b86f4b' : '#d8b8a2'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><defs><linearGradient id="g"><stop stop-color="${background}"/><stop offset="1" stop-color="#f3e2d4"/></linearGradient></defs><rect width="900" height="900" fill="url(#g)"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#fff8f1" font-family="Georgia" font-size="180">${label}</text></svg>`
  const full = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return { full, thumb: full }
}
