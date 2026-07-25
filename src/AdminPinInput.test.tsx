import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminPinInput } from './AdminPinInput'

function TestInput({ slots = 4 }: { slots?: number }) {
  const [value, setValue] = useState('')
  return <><AdminPinInput label="Testni PIN" slots={slots} value={value} onChange={setValue} /><output data-testid="pin-value">{value}</output></>
}

afterEach(cleanup)

describe('administratorska PIN/OTP komponenta', () => {
  it('počinje prazna i ne koristi password polja', () => {
    render(<TestInput />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(4)
    inputs.forEach(input => {
      expect((input as HTMLInputElement).value).toBe('')
      expect(input.getAttribute('type')).toBe('text')
      expect(input.getAttribute('autocomplete')).toBe('one-time-code')
    })
  })

  it('nakon znamenke prelazi na sljedeće polje i Backspace se vraća', () => {
    render(<TestInput />)
    const inputs = screen.getAllByRole('textbox')
    inputs[0].focus()
    fireEvent.change(inputs[0], { target: { value: '1' } })
    expect(document.activeElement).toBe(inputs[1])
    fireEvent.keyDown(inputs[1], { key: 'Backspace' })
    expect(document.activeElement).toBe(inputs[0])
    expect(screen.getByTestId('pin-value').textContent).toBe('')
  })

  it('omogućuje lijepljenje cijelog PIN-a i prijelaznih šest znamenki', () => {
    render(<TestInput slots={6} />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.paste(inputs[0].parentElement?.parentElement as HTMLElement, {
      clipboardData: { getData: () => '12-3456' },
    })
    expect(screen.getByTestId('pin-value').textContent).toBe('123456')
    expect(document.activeElement).toBe(inputs[5])
  })
})
