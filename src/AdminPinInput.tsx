import { useRef } from 'react'

interface AdminPinInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  slots?: number
  autoFocus?: boolean
}

export function AdminPinInput({ label, value, onChange, slots = 4, autoFocus = false }: AdminPinInputProps) {
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length: slots }, (_, index) => value[index] ?? '')

  function replaceDigit(index: number, digit: string) {
    const next = [...digits]
    next[index] = digit
    onChange(next.join('').slice(0, slots))
    if (digit && index < slots - 1) inputs.current[index + 1]?.focus()
  }

  function handleBackspace(index: number) {
    if (digits[index]) {
      replaceDigit(index, '')
      return
    }
    if (index > 0) {
      const next = [...digits]
      next[index - 1] = ''
      onChange(next.join('').slice(0, slots))
      inputs.current[index - 1]?.focus()
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, slots)
    if (!pasted) return
    event.preventDefault()
    onChange(pasted)
    inputs.current[Math.min(pasted.length, slots) - 1]?.focus()
  }

  return <fieldset className="admin-pin-fieldset">
    <legend>{label}</legend>
    <div className={`admin-pin-digits slots-${slots}`} onPaste={handlePaste}>
      {digits.map((digit, index) => <span className={`admin-pin-digit ${digit ? 'filled' : ''}`} key={index}>
        <input
          ref={element => { inputs.current[index] = element }}
          type="text"
          name={`calendar-pin-${slots}-${index}-${label.replace(/\s+/g, '-').toLocaleLowerCase('hr')}`}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoComplete="one-time-code"
          data-1p-ignore="true"
          data-lpignore="true"
          aria-label={`${label}, znamenka ${index + 1}`}
          value={digit}
          autoFocus={autoFocus && index === 0}
          onFocus={event => event.currentTarget.select()}
          onChange={event => replaceDigit(index, event.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={event => {
            if (event.key === 'Backspace') {
              event.preventDefault()
              handleBackspace(index)
            } else if (event.key === 'ArrowLeft' && index > 0) {
              inputs.current[index - 1]?.focus()
            } else if (event.key === 'ArrowRight' && index < slots - 1) {
              inputs.current[index + 1]?.focus()
            }
          }}
        />
        {digit && <i aria-hidden="true">•</i>}
      </span>)}
    </div>
  </fieldset>
}
