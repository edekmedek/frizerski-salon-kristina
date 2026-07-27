import { useEffect, type Dispatch, type SetStateAction } from 'react'

export function useAutoDismissNotice(
  notice: string,
  setNotice: Dispatch<SetStateAction<string>>,
  delay = 3000,
) {
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), delay)
    return () => window.clearTimeout(timer)
  }, [delay, notice, setNotice])
}
