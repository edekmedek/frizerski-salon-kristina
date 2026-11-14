import { useEffect, useRef, useState } from 'react'

interface SalonGalleryProps {
  isOpen: boolean
  onClose: () => void
}

const GALLERY_IMAGES = [
  '/hero-radovi/rad-1.jpg',
  '/hero-radovi/rad-2.jpg',
  '/hero-radovi/rad-3.jpg',
  '/hero-radovi/rad-4.jpg',
  '/hero-radovi/rad-5.jpg',
  '/hero-radovi/rad-6.jpg',
  '/hero-radovi/rad-7.jpg',
  '/hero-radovi/rad-8.jpg',
  '/hero-radovi/rad-9.jpg',
]

export function SalonGallery({ isOpen, onClose }: SalonGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastTouchRef = useRef({ distance: 0, centerX: 0, centerY: 0, timestamp: 0 })
  const lastPanRef = useRef({ x: 0, y: 0 })

  // Disable scroll when gallery is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [isOpen])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex((prev) => (prev - 1 + GALLERY_IMAGES.length) % GALLERY_IMAGES.length)
        resetZoom()
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex((prev) => (prev + 1) % GALLERY_IMAGES.length)
        resetZoom()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  function resetZoom() {
    setZoom(1)
    setPanX(0)
    setPanY(0)
  }

  function nextImage() {
    setCurrentIndex((prev) => (prev + 1) % GALLERY_IMAGES.length)
    resetZoom()
  }

  function prevImage() {
    setCurrentIndex((prev) => (prev - 1 + GALLERY_IMAGES.length) % GALLERY_IMAGES.length)
    resetZoom()
  }

  // Pinch to zoom and double tap
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const centerX = (touch1.clientX + touch2.clientX) / 2
      const centerY = (touch1.clientY + touch2.clientY) / 2
      lastTouchRef.current = { distance, centerX, centerY, timestamp: Date.now() }
    } else if (e.touches.length === 1) {
      lastPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!containerRef.current || !imageRef.current) return

    if (e.touches.length === 2) {
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const centerX = (touch1.clientX + touch2.clientX) / 2
      const centerY = (touch1.clientY + touch2.clientY) / 2

      const scale = distance / lastTouchRef.current.distance
      const newZoom = Math.max(1, Math.min(zoom * scale, 4))
      setZoom(newZoom)

      // Adjust pan to keep center fixed
      if (newZoom > 1) {
        const zoomDiff = (newZoom - zoom) / newZoom
        const dx = (centerX - lastTouchRef.current.centerX) * zoomDiff
        const dy = (centerY - lastTouchRef.current.centerY) * zoomDiff
        setPanX((prev) => prev + dx)
        setPanY((prev) => prev + dy)
      }

      lastTouchRef.current = { distance, centerX, centerY, timestamp: Date.now() }
    } else if (e.touches.length === 1 && zoom > 1) {
      // Pan when zoomed
      const touch = e.touches[0]
      const deltaX = touch.clientX - lastPanRef.current.x
      const deltaY = touch.clientY - lastPanRef.current.y
      setPanX((prev) => prev + deltaX)
      setPanY((prev) => prev + deltaY)
      lastPanRef.current = { x: touch.clientX, y: touch.clientY }
    } else if (e.touches.length === 1 && zoom === 1) {
      // Swipe to change image
      const touch = e.touches[0]
      const deltaX = touch.clientX - lastPanRef.current.x
      if (Math.abs(deltaX) > 50) {
        if (deltaX > 0) {
          prevImage()
        } else {
          nextImage()
        }
        lastPanRef.current = { x: touch.clientX, y: touch.clientY }
      }
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (zoom > 1) {
      resetZoom()
    } else {
      const rect = imageRef.current?.getBoundingClientRect()
      if (rect) {
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        setZoom(2)
        setPanX((rect.width / 2 - x) * 0.5)
        setPanY((rect.height / 2 - y) * 0.5)
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="salon-gallery-modal">
      <div className="salon-gallery-overlay" onClick={onClose}></div>
      <div className="salon-gallery-container" ref={containerRef}>
        {/* Close button */}
        <button className="salon-gallery-close" onClick={onClose} aria-label="Zatvori galeriju">
          ✕
        </button>

        {/* Image counter */}
        <div className="salon-gallery-counter">
          {currentIndex + 1} / {GALLERY_IMAGES.length}
        </div>

        {/* Main image area */}
        <div className="salon-gallery-image-wrapper">
          <img
            ref={imageRef}
            src={GALLERY_IMAGES[currentIndex]}
            alt={`Salon rad ${currentIndex + 1}`}
            className="salon-gallery-image"
            onDoubleClick={handleDoubleClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            style={{
              transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
              transformOrigin: 'center',
              cursor: zoom > 1 ? 'grab' : 'pointer',
            }}
            draggable={false}
          />
        </div>

        {/* Navigation arrows */}
        <button
          className="salon-gallery-nav salon-gallery-nav-prev"
          onClick={prevImage}
          aria-label="Prethodna fotografija"
        >
          ◀
        </button>
        <button
          className="salon-gallery-nav salon-gallery-nav-next"
          onClick={nextImage}
          aria-label="Sljedeća fotografija"
        >
          ▶
        </button>

        {/* Touch hint */}
        <div className="salon-gallery-hint">
          {zoom > 1 ? 'Vuci za pomicanje • Dvoklik za smanjenje' : 'Dvoklik za povećanje • Vuci za promjenu fotografije'}
        </div>
      </div>
    </div>
  )
}
