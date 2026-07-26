/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20260803_private_treatment_photo_archive.sql'), 'utf8')
const clientPortal = readFileSync(join(process.cwd(), 'src', 'ClientPortal.tsx'), 'utf8')

describe('privatnost fotografija tretmana', () => {
  it('bucket ostaje privatan i klijent smije čitati samo vlastite vidljive tretmane', () => {
    expect(migration).toContain("values ('client-photos', 'client-photos', false")
    expect(migration).toContain('treatment.client_id = public.current_client_id()')
    expect(migration).toContain('treatment.visible_to_client = true')
    expect(migration).toContain('(photo.image_path = objects.name or photo.thumbnail_path = objects.name)')
  })

  it('anonimnom korisniku ne daje pristup i administrator jedini mijenja zapise i datoteke', () => {
    expect(migration).toContain('revoke all on public.treatment_photo_sets, public.treatment_photos from anon')
    expect(migration).toContain('public.is_admin()')
    expect(migration).not.toMatch(/bucket[^;]+public\s*=\s*true/i)
  })

  it('klijentski upit dodatno filtrira vlasnika i visible_to_client te koristi signed URL', () => {
    expect(clientPortal).toContain(".eq('client_id', clientId).eq('visible_to_client', true)")
    expect(clientPortal).toContain('createSignedUrl')
    expect(clientPortal).not.toContain("from('hairstyle_photos')")
  })
})
