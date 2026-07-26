import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTreatmentArchive, deleteTreatmentPhoto, replaceTreatmentPhoto, type TreatmentPhoto } from './treatmentPhotoArchive'

const compressed = {
  full: new Blob(['full'], { type: 'image/webp' }),
  thumb: new Blob(['thumb'], { type: 'image/webp' }),
}

function mockClient(options: { uploadErrorAt?: number; photoInsertError?: boolean; setInsertError?: boolean; deleteError?: boolean; removeError?: boolean } = {}) {
  let uploadCount = 0
  const upload = vi.fn(async () => {
    uploadCount += 1
    return { error: uploadCount === options.uploadErrorAt ? { message: 'storage error' } : null }
  })
  const remove = vi.fn(async () => ({ error: options.removeError ? { message: 'remove error' } : null }))
  const setDeleteEq = vi.fn(async () => ({ error: options.deleteError ? { message: 'delete error' } : null }))
  const photoDeleteEq = vi.fn(async () => ({ error: options.deleteError ? { message: 'delete error' } : null }))
  const photoUpdateEq = vi.fn(async () => ({ error: options.photoInsertError ? { message: 'database error' } : null }))
  const inserts: Record<string, unknown>[] = []
  const from = vi.fn((table: string) => ({
    insert: (value: Record<string, unknown>) => {
      inserts.push({ table, ...value })
      if (table === 'treatment_photo_sets') {
        return { select: () => ({ single: async () => ({ data: { id: 'treatment-1' }, error: options.setInsertError ? { message: 'database error' } : null }) }) }
      }
      return Promise.resolve({ error: options.photoInsertError ? { message: 'database error' } : null })
    },
    delete: () => ({ eq: table === 'treatment_photo_sets' ? setDeleteEq : photoDeleteEq }),
    update: () => ({ eq: photoUpdateEq }),
  }))
  return {
    client: {
      from,
      storage: { from: () => ({ upload, remove }) },
    } as never,
    upload, remove, inserts, setDeleteEq, photoDeleteEq, photoUpdateEq,
  }
}

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `photo-${Math.random()}`) })
})

describe('privatna arhiva fotografija tretmana', () => {
  it('komprimira i sprema više fotografija prije i poslije te ih veže uz klijenta i datum', async () => {
    const { client, upload, inserts } = mockClient()
    const compress = vi.fn(async () => compressed)
    const files = [
      { file: new File(['a'], 'prije.jpg', { type: 'image/jpeg' }), phase: 'before' as const },
      { file: new File(['b'], 'poslije.jpg', { type: 'image/jpeg' }), phase: 'after' as const },
    ]
    await createTreatmentArchive(client, {
      clientId: 'client-1', takenAt: '2026-08-02', notes: 'Balayage',
      visibleToClient: true, photos: files,
    }, { compress })

    expect(compress).toHaveBeenCalledTimes(2)
    expect(upload).toHaveBeenCalledTimes(4)
    expect(inserts[0]).toMatchObject({ table: 'treatment_photo_sets', client_id: 'client-1', taken_at: '2026-08-02', visible_to_client: true })
    expect(inserts.filter(item => item.table === 'treatment_photos').map(item => item.phase)).toEqual(['before', 'after'])
  })

  it('ne prikazuje uspjeh i čisti upload i zapis kada Storage djelomično zakaže', async () => {
    const { client, remove, setDeleteEq } = mockClient({ uploadErrorAt: 2 })
    await expect(createTreatmentArchive(client, {
      clientId: 'client-1', takenAt: '2026-08-02', notes: '', visibleToClient: false,
      photos: [{ file: new File(['a'], 'prije.jpg', { type: 'image/jpeg' }), phase: 'before' }],
    }, { compress: async () => compressed })).rejects.toThrow('storage error')
    expect(remove).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('-full.webp')]))
    expect(setDeleteEq).toHaveBeenCalledWith('id', 'treatment-1')
  })

  it('čisti obje datoteke i tretman kada baza odbije zapis fotografije', async () => {
    const { client, remove, setDeleteEq } = mockClient({ photoInsertError: true })
    await expect(createTreatmentArchive(client, {
      clientId: 'client-1', takenAt: '2026-08-02', notes: '', visibleToClient: true,
      photos: [{ file: new File(['a'], 'prije.jpg', { type: 'image/jpeg' }), phase: 'before' }],
    }, { compress: async () => compressed })).rejects.toThrow('database error')
    expect(remove).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('-full.webp'), expect.stringContaining('-thumb.webp')]))
    expect(setDeleteEq).toHaveBeenCalled()
  })

  it('pri zamjeni prvo sprema novu komprimiranu fotografiju, ažurira zapis i čisti staru', async () => {
    const { client, upload, remove, photoUpdateEq } = mockClient()
    const photo: TreatmentPhoto = { id: 'p1', treatmentId: 't1', phase: 'before', imagePath: 'old-full', thumbnailPath: 'old-thumb', sortOrder: 0 }
    const compress = vi.fn(async () => compressed)
    await replaceTreatmentPhoto(client, photo, 'client-1', new File(['a'], 'nova.jpg', { type: 'image/jpeg' }), compress)
    expect(compress).toHaveBeenCalled()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(photoUpdateEq).toHaveBeenCalledWith('id', 'p1')
    expect(remove).toHaveBeenLastCalledWith(['old-full', 'old-thumb'])
  })

  it('ne briše datoteke ako baza odbije brisanje zapisa', async () => {
    const { client, remove } = mockClient({ deleteError: true })
    const photo: TreatmentPhoto = { id: 'p1', treatmentId: 't1', phase: 'after', imagePath: 'full', thumbnailPath: 'thumb', sortOrder: 1 }
    await expect(deleteTreatmentPhoto(client, photo)).rejects.toThrow('delete error')
    expect(remove).not.toHaveBeenCalled()
  })
})
