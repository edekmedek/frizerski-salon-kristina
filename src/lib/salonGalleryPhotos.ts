import type { SupabaseClient } from '@supabase/supabase-js'
export type GalleryVisibility = 'internal' | 'client' | 'public'
export interface SalonGalleryPhoto { id: string; client_id: string | null; storage_path: string; thumbnail_path: string | null; visibility: GalleryVisibility; category: string | null; notes: string | null; created_at: string }
export async function loadSalonGalleryPhotos(client: SupabaseClient): Promise<SalonGalleryPhoto[]> {
  const { data, error } = await client.from('salon_gallery_photos').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as SalonGalleryPhoto[]
}
export async function changeSalonGalleryVisibility(client: SupabaseClient, photoId: string, visibility: GalleryVisibility): Promise<void> {
  const { data, error } = await client.from('salon_gallery_photos').update({ visibility }).eq('id', photoId).select('id').single()
  if (error) throw error
  if (!data) throw new Error('Promjena vidljivosti nije potvrđena.')
}

import { compressGalleryImageToBlobs } from "./image"; import { validateClientPhoto } from "./clientPhoto"; export async function uploadSalonGalleryPhoto(client: SupabaseClient, file: File, clientId: string | null = null): Promise<string> { const validationError = validateClientPhoto(file); if (validationError) throw new Error(validationError); const blobs = await compressGalleryImageToBlobs(file); const id = crypto.randomUUID(); const fullPath = id + "-full.webp"; const thumbPath = id + "-thumb.webp"; const bucket = client.storage.from("salon-gallery"); const full = await bucket.upload(fullPath, blobs.full, { contentType: "image/webp", upsert: false }); if (full.error) throw full.error; const thumb = await bucket.upload(thumbPath, blobs.thumb, { contentType: "image/webp", upsert: false }); if (thumb.error) { await bucket.remove([fullPath]); throw thumb.error; } const { error } = await client.from("salon_gallery_photos").insert({ id, client_id: clientId, storage_path: fullPath, thumbnail_path: thumbPath, visibility: "internal" }); if (error) { await bucket.remove([fullPath, thumbPath]); throw error; } return id; }