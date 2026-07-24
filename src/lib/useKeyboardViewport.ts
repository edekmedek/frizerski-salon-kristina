import { useEffect } from 'react'

const editableSelector = 'input:not([type="checkbox"]):not([type="radio"]), select, textarea'

export function useKeyboardViewport() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    let focusFrame = 0

    function keepFieldVisible(element: HTMLElement) {
      const visibleTop = (viewport?.offsetTop ?? 0) + 16
      const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight) - 20
      const rect = element.getBoundingClientRect()
      if (rect.top < visibleTop || rect.bottom > visibleBottom) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }
    }

    function updateViewport() {
      const height = viewport?.height ?? window.innerHeight
      root.style.setProperty('--visual-viewport-height', `${height}px`)
      root.style.setProperty('--visual-viewport-offset-top', `${viewport?.offsetTop ?? 0}px`)
      root.classList.toggle('keyboard-visible', height < window.innerHeight * 0.82)
      const active = document.activeElement
      if (active instanceof HTMLElement && active.matches(editableSelector)) {
        window.cancelAnimationFrame(focusFrame)
        focusFrame = window.requestAnimationFrame(() => keepFieldVisible(active))
      }
    }

    function handleFocus(event: FocusEvent) {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.matches(editableSelector)) return
      window.setTimeout(() => keepFieldVisible(target), 80)
      window.setTimeout(() => keepFieldVisible(target), 320)
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)
    document.addEventListener('focusin', handleFocus)
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('resize', updateViewport)
      document.removeEventListener('focusin', handleFocus)
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      root.classList.remove('keyboard-visible')
      root.style.removeProperty('--visual-viewport-height')
      root.style.removeProperty('--visual-viewport-offset-top')
    }
  }, [])
}
