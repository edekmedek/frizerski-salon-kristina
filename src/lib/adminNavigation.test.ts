import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('administratorska navigacija', () => {
  it('više ne izlaže zasebnu stranicu Termini', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'AdminApp.tsx'), 'utf8')
    expect(source).not.toContain("id: 'termini'")
    expect(source).not.toContain("view === 'termini'")
  })
})
