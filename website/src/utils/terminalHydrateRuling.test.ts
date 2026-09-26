import { describe, it, expect, vi } from 'vitest'
import { createTerminalHydrateRuling, retainableSessionIds } from './terminalHydrateRuling'

const listing = (...entries: [string, boolean][]) => ({
  enabled: true,
  sessions: entries.map(([session_id, alive]) => ({ session_id, alive })),
})

function setup(restored: string[], held = restored) {
  let ids = [...held]
  const drop = vi.fn((gone: ReadonlySet<string>) => { ids = ids.filter(id => !gone.has(id)) })
  const emit = vi.fn()
  const ruling = createTerminalHydrateRuling(new Set(restored), () => ids, drop, emit)
  return { ruling, drop, emit, held: () => ids }
}

describe('retainableSessionIds', () => {
  it('reads the live ids from a full answer', () => {
    expect(retainableSessionIds(listing(['a', true], ['b', false]))).toEqual(new Set(['a']))
  })

  it.each([
    ['null', null],
    ['disabled', { enabled: false, sessions: [] }],
    ['no list', { enabled: true }],
    ['malformed entry', { enabled: true, sessions: [{ session_id: 'a' }] }],
  ])('does not rule on a %s payload', (_name, payload) => {
    expect(retainableSessionIds(payload)).toBeNull()
  })

  it('vouches for unexpired exit records alongside live shells', () => {
    expect(retainableSessionIds({ ...listing(['a', true], ['b', false]), exited: ['c'] }))
      .toEqual(new Set(['a', 'c']))
  })

  it('reads an answer without the exit field, as an older gateway sends', () => {
    expect(retainableSessionIds(listing(['a', true]))).toEqual(new Set(['a']))
  })

  it.each([
    ['non-list', 'c'],
    ['non-string entry', ['c', 7]],
  ])('does not rule on a %s exit field', (_name, exited) => {
    expect(retainableSessionIds({ ...listing(['a', true]), exited })).toBeNull()
  })
})

describe('createTerminalHydrateRuling', () => {
  it('starts settled when nothing was restored', () => {
    expect(setup([]).ruling.isPending()).toBe(false)
  })

  it('settles at once when every restored session is live', () => {
    const { ruling, drop, emit } = setup(['a', 'b'])
    expect(ruling.isPending()).toBe(true)
    expect(ruling.reconcile(listing(['a', true], ['b', true]))).toEqual([])
    expect(ruling.isPending()).toBe(false)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(ruling.confirm(listing())).toEqual([])
    expect(drop).not.toHaveBeenCalled()
  })

  it('drops only the suspects the second look still misses', () => {
    const { ruling, drop, held } = setup(['live', 'opening', 'gone'])
    expect(ruling.reconcile(listing(['live', true], ['gone', false]))).toEqual(['opening', 'gone'])
    expect(ruling.isPending()).toBe(true)
    expect(drop).not.toHaveBeenCalled()
    expect(ruling.confirm(listing(['live', true], ['opening', true]))).toEqual(['gone'])
    expect(held()).toEqual(['live', 'opening'])
    expect(ruling.isPending()).toBe(false)
  })

  it('keeps every tab when either look cannot rule', () => {
    const first = setup(['a'])
    expect(first.ruling.reconcile(null)).toEqual([])
    expect(first.ruling.isPending()).toBe(false)

    const second = setup(['a'])
    expect(second.ruling.reconcile(listing())).toEqual(['a'])
    expect(second.ruling.confirm(null)).toEqual([])
    expect(second.drop).not.toHaveBeenCalled()
    expect(second.ruling.isPending()).toBe(false)
  })

  it('keeps a restored tab whose shell exited while its record is unexpired', () => {
    const { ruling, drop, held } = setup(['exited', 'gone'])
    const answer = { ...listing(), exited: ['exited'] }
    expect(ruling.reconcile(answer)).toEqual(['gone'])
    expect(ruling.confirm(answer)).toEqual(['gone'])
    expect(drop).toHaveBeenCalledTimes(1)
    expect(held()).toEqual(['exited'])
  })

  it('never names a session that was not restored', () => {
    const { ruling } = setup(['old'], ['old', 'minted'])
    expect(ruling.reconcile(listing())).toEqual(['old'])
  })

  it('rules once: later looks are no-ops', () => {
    const { ruling, drop } = setup(['a'])
    ruling.reconcile(listing())
    expect(ruling.reconcile(listing(['a', true]))).toEqual([])
    expect(ruling.confirm(listing())).toEqual(['a'])
    expect(ruling.confirm(listing())).toEqual([])
    expect(drop).toHaveBeenCalledTimes(1)
  })
})
