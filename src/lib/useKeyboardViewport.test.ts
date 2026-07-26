import { describe, expect, it } from 'vitest'
import { keyboardViewportState } from './useKeyboardViewport'

describe('Android tipkovnica u instaliranoj aplikaciji', () => {
  it('prepoznaje tipkovnicu prema najvećoj zabilježenoj visini, čak i kad se innerHeight smanji', () => {
    expect(keyboardViewportState(900, 480, 0, true)).toEqual({ inset: 420, visible: true })
  })

  it('ne označava tipkovnicu kada polje nije fokusirano ili je promjena mala', () => {
    expect(keyboardViewportState(900, 480, 0, false).visible).toBe(false)
    expect(keyboardViewportState(900, 820, 0, true).visible).toBe(false)
  })
})
