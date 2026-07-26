import { useEffect } from 'react'

const editableSelector = 'input:not([type="checkbox"]):not([type="radio"]), select, textarea'

export function keyboardViewportState(baselineHeight: number, viewportHeight: number, offsetTop: number, focused: boolean) {
  const inset = Math.max(0, baselineHeight - viewportHeight - offsetTop)
  return { inset, visible: focused && inset > 120 }
}

export function useKeyboardViewport() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    let focusFrame = 0
    let largestViewportHeight = viewport?.height ?? window.innerHeight

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
      const focused = document.activeElement instanceof HTMLElement
        && document.activeElement.matches(editableSelector)
      if (!focused) largestViewportHeight = Math.max(largestViewportHeight, height, window.innerHeight)
      const keyboard = keyboardViewportState(largestViewportHeight, height, viewport?.offsetTop ?? 0, focused)
      root.style.setProperty('--visual-viewport-height', `${height}px`)
      root.style.setProperty('--visual-viewport-offset-top', `${viewport?.offsetTop ?? 0}px`)
      root.style.setProperty('--keyboard-inset', `${keyboard.inset}px`)
      root.classList.toggle('keyboard-visible', keyboard.visible)
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
      window.setTimeout(() => keepFieldVisible(target), 700)
      updateViewport()
    }

    function handleBlur() {
      window.setTimeout(updateViewport, 120)
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)
    document.addEventListener('focusin', handleFocus)
    document.addEventListener('focusout', handleBlur)
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('resize', updateViewport)
      document.removeEventListener('focusin', handleFocus)
      document.removeEventListener('focusout', handleBlur)
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      root.classList.remove('keyboard-visible')
      root.style.removeProperty('--visual-viewport-height')
      root.style.removeProperty('--visual-viewport-offset-top')
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])
}
