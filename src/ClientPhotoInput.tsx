import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { ImageAsset } from './types'
import { compressImageToAsset } from './lib/image'
import {
  dataUrlByteSize,
  MAX_PRIVATE_PHOTO_BYTES,
  validateClientPhoto,
} from './lib/clientPhoto'
import './ClientPhotoInput.css'

interface ClientPhotoInputProps {
  value?: ImageAsset
  onChange: (asset?: ImageAsset) => void
}

export function ClientPhotoInput({ value, onChange }: ClientPhotoInputProps) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)

  async function processFile(file?: File) {
    if (!file || processing) return
    setError('')
    const validationError = validateClientPhoto(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setProcessing(true)
    setStatus('Fotografija se smanjuje, okreće i komprimira…')
    try {
      const asset = await compressImageToAsset(file)
      if (dataUrlByteSize(asset.full) > MAX_PRIVATE_PHOTO_BYTES) {
        throw new Error('Fotografiju nije moguće smanjiti ispod privatnog ograničenja od 5 MB.')
      }
      onChange(asset)
      setStatus('Fotografija je spremna. Spremit će se tek zajedno s klijentom.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Fotografiju nije moguće obraditi.')
      setStatus('')
    } finally {
      setProcessing(false)
      if (cameraRef.current) cameraRef.current.value = ''
      if (galleryRef.current) galleryRef.current.value = ''
    }
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDragging(false)
    void processFile(event.dataTransfer.files[0])
  }

  return (
    <div className="client-photo-input">
      <div className="photo-preview">
        {value ? (
          <img src={value.thumb} alt="Pregled profilne fotografije" />
        ) : (
          <span aria-hidden="true">Fotografija</span>
        )}
      </div>

      <div className="photo-actions">
        <label className="photo-action">
          <span>Snimi fotografiju</span>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*,.heic,.heif"
            capture="environment"
            disabled={processing}
            onChange={(event) => void processFile(event.target.files?.[0])}
          />
        </label>
      </div>

      <input
        ref={galleryRef}
        className="gallery-file-input"
        aria-label="Odabir fotografije iz galerije"
        type="file"
        accept="image/*,.heic,.heif"
        disabled={processing}
        onChange={(event) => void processFile(event.target.files?.[0])}
      />
      <button
        type="button"
        className={`photo-dropzone ${dragging ? 'dragging' : ''}`}
        disabled={processing}
        onClick={() => galleryRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <span className="dropzone-desktop">Povucite fotografiju ovdje ili kliknite za odabir</span>
        <span className="dropzone-touch">Odaberite fotografiju iz galerije</span>
      </button>

      {value && (
        <div className="photo-change-actions">
          <button type="button" onClick={() => galleryRef.current?.click()}>
            Zamijeni
          </button>
          <button
            type="button"
            className="remove-photo"
            onClick={() => {
              onChange(undefined)
              setStatus('Fotografija je uklonjena.')
              setError('')
            }}
          >
            Ukloni
          </button>
        </div>
      )}

      {processing && <p className="photo-status" role="status">Obrada fotografije u tijeku…</p>}
      {!processing && status && <p className="photo-status" role="status">{status}</p>}
      {error && <p className="photo-error" role="alert">{error}</p>}
      <p className="photo-help">JPEG, PNG, WebP, HEIC ili HEIF. Privatna fotografija, najviše 5 MB nakon obrade.</p>
    </div>
  )
}
