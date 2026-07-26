import type { SupabaseClient } from '@supabase/supabase-js'
import { CLIENT_PHOTOS_BUCKET, validateClientPhoto } from './clientPhoto'
import { compressImageToBlobs, type CompressedImageBlobs } from './image'

export type TreatmentPhotoPhase = 'before' | 'after'

export interface TreatmentPhoto {
  id: string
  treatmentId: string
  phase: TreatmentPhotoPhase
  imagePath: string
  thumbnailPath: string
  sortOrder: number
  imageUrl?: string
  thumbnailUrl?: string
}

export interface TreatmentPhotoSet {
  id: string
  clientId: string
  takenAt: string
  notes: string
  visibleToClient: boolean
  photos: TreatmentPhoto[]
}

export interface PendingTreatmentPhoto {
  file: File
  phase: TreatmentPhotoPhase
}

export interface ArchiveProgress {
  completed: number
  total: number
  label: string
}

type Compressor = (file: File) => Promise<CompressedImageBlobs>
type ProgressCallback = (progress: ArchiveProgress) => void

function assertOk(error: { message?: string } | null, fallback: string) {
  if (error) throw new Error(error.message || fallback)
}

function storagePath(clientId: string, treatmentId: string, photoId: string, variant: 'full' | 'thumb') {
  return `${clientId}/treatments/${treatmentId}/${photoId}-${variant}.webp`
}

async function removeStoragePaths(client: SupabaseClient, paths: string[]) {
  if (!paths.length) return
  const { error } = await client.storage.from(CLIENT_PHOTOS_BUCKET).remove(paths)
  assertOk(error, 'Čišćenje fotografija nije uspjelo.')
}

async function bestEffortCleanup(client: SupabaseClient, treatmentId: string | undefined, paths: string[]) {
  const failures: unknown[] = []
  if (paths.length) {
    try { await removeStoragePaths(client, paths) } catch (error) { failures.push(error) }
  }
  if (treatmentId) {
    const { error } = await client.from('treatment_photo_sets').delete().eq('id', treatmentId)
    if (error) failures.push(error)
  }
  if (failures.length) throw new Error('Spremanje nije uspjelo, a automatsko čišćenje nije dovršeno. Pokušajte ponovno ili se javite administratoru.')
}

export async function createTreatmentArchive(
  client: SupabaseClient,
  input: {
    clientId: string
    takenAt: string
    notes: string
    visibleToClient: boolean
    photos: PendingTreatmentPhoto[]
  },
  options: { compress?: Compressor; onProgress?: ProgressCallback } = {},
) {
  if (!input.clientId || !input.takenAt || !input.photos.length) {
    throw new Error('Odaberite klijenta, datum tretmana i barem jednu fotografiju.')
  }
  for (const item of input.photos) {
    const validationError = validateClientPhoto(item.file)
    if (validationError) throw new Error(validationError)
  }

  const compress = options.compress ?? compressImageToBlobs
  const total = input.photos.length * 4 + 1
  let completed = 0
  const progress = (label: string) => options.onProgress?.({ completed: ++completed, total, label })
  let treatmentId: string | undefined
  const uploadedPaths: string[] = []

  try {
    const { data: treatment, error: treatmentError } = await client
      .from('treatment_photo_sets')
      .insert({
        client_id: input.clientId,
        taken_at: input.takenAt,
        notes: input.notes,
        visible_to_client: input.visibleToClient,
      })
      .select('id')
      .single()
    assertOk(treatmentError, 'Zapis tretmana nije spremljen.')
    if (!treatment?.id) throw new Error('Baza nije vratila spremljeni zapis tretmana.')
    const savedTreatmentId: string = treatment.id
    treatmentId = savedTreatmentId
    progress('Tretman je pripremljen.')

    for (let index = 0; index < input.photos.length; index += 1) {
      const item = input.photos[index]
      const photoId = crypto.randomUUID()
      const fullPath = storagePath(input.clientId, savedTreatmentId, photoId, 'full')
      const thumbPath = storagePath(input.clientId, savedTreatmentId, photoId, 'thumb')
      options.onProgress?.({ completed, total, label: `Komprimiranje fotografije ${index + 1} od ${input.photos.length}…` })
      const blobs = await compress(item.file)
      progress(`Fotografija ${index + 1} je komprimirana.`)

      const fullUpload = await client.storage.from(CLIENT_PHOTOS_BUCKET).upload(fullPath, blobs.full, { contentType: 'image/webp', upsert: false })
      assertOk(fullUpload.error, 'Slanje fotografije nije uspjelo.')
      uploadedPaths.push(fullPath)
      progress(`Fotografija ${index + 1}: spremljena velika verzija.`)

      const thumbUpload = await client.storage.from(CLIENT_PHOTOS_BUCKET).upload(thumbPath, blobs.thumb, { contentType: 'image/webp', upsert: false })
      assertOk(thumbUpload.error, 'Slanje pregleda fotografije nije uspjelo.')
      uploadedPaths.push(thumbPath)
      progress(`Fotografija ${index + 1}: spremljen brzi pregled.`)

      const { error: photoError } = await client.from('treatment_photos').insert({
        id: photoId,
        treatment_id: savedTreatmentId,
        phase: item.phase,
        image_path: fullPath,
        thumbnail_path: thumbPath,
        sort_order: index,
      })
      assertOk(photoError, 'Povezivanje fotografije s tretmanom nije uspjelo.')
      progress(`Fotografija ${index + 1} je povezana s tretmanom.`)
    }
    return treatmentId
  } catch (error) {
    await bestEffortCleanup(client, treatmentId, uploadedPaths)
    throw error instanceof Error ? error : new Error('Arhivu nije moguće spremiti.')
  }
}

export async function loadTreatmentArchives(client: SupabaseClient): Promise<TreatmentPhotoSet[]> {
  const { data, error } = await client
    .from('treatment_photo_sets')
    .select('id,client_id,taken_at,notes,visible_to_client,treatment_photos(id,treatment_id,phase,image_path,thumbnail_path,sort_order)')
    .order('taken_at', { ascending: false })
  assertOk(error, 'Arhivu fotografija nije moguće učitati.')
  const rows = data ?? []
  return Promise.all(rows.map(async row => {
    const photos = await Promise.all((row.treatment_photos ?? []).map(async (photo: {
      id: string; treatment_id: string; phase: TreatmentPhotoPhase; image_path: string; thumbnail_path: string; sort_order: number
    }) => {
      const [{ data: image }, { data: thumb }] = await Promise.all([
        client.storage.from(CLIENT_PHOTOS_BUCKET).createSignedUrl(photo.image_path, 300),
        client.storage.from(CLIENT_PHOTOS_BUCKET).createSignedUrl(photo.thumbnail_path, 300),
      ])
      return {
        id: photo.id, treatmentId: photo.treatment_id, phase: photo.phase,
        imagePath: photo.image_path, thumbnailPath: photo.thumbnail_path,
        sortOrder: photo.sort_order, imageUrl: image?.signedUrl, thumbnailUrl: thumb?.signedUrl,
      }
    }))
    return {
      id: row.id, clientId: row.client_id, takenAt: row.taken_at, notes: row.notes ?? '',
      visibleToClient: row.visible_to_client, photos: photos.sort((a, b) => a.sortOrder - b.sortOrder),
    }
  }))
}

export async function replaceTreatmentPhoto(
  client: SupabaseClient,
  photo: TreatmentPhoto,
  clientId: string,
  file: File,
  compress: Compressor = compressImageToBlobs,
) {
  const validationError = validateClientPhoto(file)
  if (validationError) throw new Error(validationError)
  const blobs = await compress(file)
  const replacementId = crypto.randomUUID()
  const fullPath = storagePath(clientId, photo.treatmentId, replacementId, 'full')
  const thumbPath = storagePath(clientId, photo.treatmentId, replacementId, 'thumb')
  const uploaded: string[] = []
  try {
    const full = await client.storage.from(CLIENT_PHOTOS_BUCKET).upload(fullPath, blobs.full, { contentType: 'image/webp' })
    assertOk(full.error, 'Nova fotografija nije poslana.')
    uploaded.push(fullPath)
    const thumb = await client.storage.from(CLIENT_PHOTOS_BUCKET).upload(thumbPath, blobs.thumb, { contentType: 'image/webp' })
    assertOk(thumb.error, 'Novi pregled fotografije nije poslan.')
    uploaded.push(thumbPath)
    const { error } = await client.from('treatment_photos').update({ image_path: fullPath, thumbnail_path: thumbPath }).eq('id', photo.id)
    assertOk(error, 'Zamjena fotografije nije spremljena.')
  } catch (error) {
    await removeStoragePaths(client, uploaded)
    throw error
  }
  try {
    await removeStoragePaths(client, [photo.imagePath, photo.thumbnailPath])
  } catch (error) {
    const { error: rollbackError } = await client.from('treatment_photos').update({
      image_path: photo.imagePath,
      thumbnail_path: photo.thumbnailPath,
    }).eq('id', photo.id)
    if (rollbackError) throw new Error('Zamjena je spremljena, ali stare datoteke nije moguće očistiti.', { cause: error })
    await removeStoragePaths(client, uploaded)
    throw error
  }
}

export async function deleteTreatmentPhoto(client: SupabaseClient, photo: TreatmentPhoto) {
  const { error } = await client.from('treatment_photos').delete().eq('id', photo.id)
  assertOk(error, 'Brisanje fotografije nije spremljeno.')
  try {
    await removeStoragePaths(client, [photo.imagePath, photo.thumbnailPath])
  } catch (error) {
    const { error: restoreError } = await client.from('treatment_photos').insert({
      id: photo.id,
      treatment_id: photo.treatmentId,
      phase: photo.phase,
      image_path: photo.imagePath,
      thumbnail_path: photo.thumbnailPath,
      sort_order: photo.sortOrder,
    })
    if (restoreError) throw new Error('Fotografija je obrisana iz zapisa, ali datoteku nije moguće očistiti.', { cause: error })
    throw error
  }
}
