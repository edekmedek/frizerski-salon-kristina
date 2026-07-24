import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientPhotoInput } from './ClientPhotoInput'
import { compressImageToAsset } from './lib/image'
import { MAX_SOURCE_PHOTO_BYTES } from './lib/clientPhoto'

vi.mock('./lib/image', () => ({
  compressImageToAsset: vi.fn(),
}))

const mockedCompress = vi.mocked(compressImageToAsset)
const processedPhoto = {
  full: 'data:image/webp;base64,Zm9v',
  thumb: 'data:image/webp;base64,YmFy',
}

describe('ClientPhotoInput', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mockedCompress.mockReset()
    mockedCompress.mockResolvedValue(processedPhoto)
  })

  it('obrađuje fotografiju odabranu iz galerije i prikazuje pregled', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<ClientPhotoInput onChange={onChange} />)
    const file = new File(['photo'], 'profil.jpg', { type: 'image/jpeg' })

    fireEvent.change(screen.getByLabelText('Odabir fotografije iz galerije'), {
      target: { files: [file] },
    })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(processedPhoto))
    rerender(<ClientPhotoInput value={processedPhoto} onChange={onChange} />)
    expect(screen.getByAltText('Pregled profilne fotografije')).toBeInTheDocument()
  })

  it('uklanja odabranu fotografiju prije spremanja', () => {
    const onChange = vi.fn()
    render(<ClientPhotoInput value={processedPhoto} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ukloni' }))

    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('odbija nepodržanu datoteku', async () => {
    const onChange = vi.fn()
    render(<ClientPhotoInput onChange={onChange} />)
    const file = new File(['document'], 'biljeska.pdf', {
      type: 'application/pdf',
    })

    fireEvent.change(screen.getByLabelText('Odabir fotografije iz galerije'), {
      target: { files: [file] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Odaberite JPEG, PNG, WebP, HEIC ili HEIF fotografiju.',
    )
    expect(mockedCompress).not.toHaveBeenCalled()
  })

  it('odbija izvornu fotografiju iznad sigurnog ograničenja', async () => {
    const onChange = vi.fn()
    render(<ClientPhotoInput onChange={onChange} />)
    const file = new File(['photo'], 'prevelika.heic', { type: 'image/heic' })
    Object.defineProperty(file, 'size', { value: MAX_SOURCE_PHOTO_BYTES + 1 })

    fireEvent.change(screen.getByLabelText('Odabir fotografije iz galerije'), {
      target: { files: [file] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fotografija je veća od 30 MB.',
    )
    expect(mockedCompress).not.toHaveBeenCalled()
  })
})
