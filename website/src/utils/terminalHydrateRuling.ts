/** The ids this answer VOUCHES FOR — a live shell, or one whose exit the server
 *  still holds a record of — or null when it does not rule at all.
 *
 *  A recorded exit keeps its tab for the same reason a live shell does: the
 *  record carries the dead shell's own output, and a dial gets it replayed. The
 *  tab is what dials, so dropping it is what would destroy the replay.
 *
 *  Null is "does not rule": a transport failure, a shape this client does not
 *  recognize, or the feature-disabled answer, which returns an empty list
 *  without consulting the registry, so its absence means nothing. */
export function retainableSessionIds(payload: unknown): Set<string> | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { enabled?: unknown; sessions?: unknown; exited?: unknown }
  if (p.enabled === false || !Array.isArray(p.sessions)) return null
  const live = new Set<string>()
  for (const entry of p.sessions) {
    if (!entry || typeof entry !== 'object') return null
    const { session_id, alive } = entry as { session_id?: unknown; alive?: unknown }
    // One malformed entry voids the whole answer: dropping a tab is
    // irreversible, so it only happens on a payload read in full.
    if (typeof session_id !== 'string' || typeof alive !== 'boolean') return null
    if (alive) live.add(session_id)
  }
  // Absent on an older gateway, which simply vouches for nothing extra. A
  // malformed value voids the answer on the same rule as a malformed session.
  if (p.exited !== undefined) {
    if (!Array.isArray(p.exited)) return null
    for (const id of p.exited) {
      if (typeof id !== 'string') return null
      live.add(id)
    }
  }
  return live
}

export interface TerminalHydrateRuling {
  /** True until both looks have ruled; hosts mount no terminal view meanwhile. */
  isPending(): boolean
  /** First look: returns the suspects, drops nothing. Once per ruling. */
  reconcile(payload: unknown): string[]
  /** Second, uncached look: drops the suspects still missing. Returns them. */
  confirm(payload: unknown): string[]
}

/** The two-look absence protocol over terminal sessions restored at boot.
 *  `restored` is the session ids restored from storage; `held` lists the ids
 *  a store still holds, in order; `drop` removes and persists; `emit` notifies.
 *  The rationale lives on the dock store's hydrate note (useBottomTerminal). */
export function createTerminalHydrateRuling(
  restored: ReadonlySet<string>,
  held: () => string[],
  drop: (ids: ReadonlySet<string>) => void,
  emit: () => void,
): TerminalHydrateRuling {
  let phase: 'pending' | 'confirming' | 'settled' = restored.size > 0 ? 'pending' : 'settled'
  let suspects: ReadonlySet<string> = new Set()
  const settle = () => { phase = 'settled'; suspects = new Set(); emit() }
  return {
    isPending: () => phase !== 'settled',
    reconcile(payload) {
      if (phase !== 'pending') return []
      const live = retainableSessionIds(payload)
      const found = live === null ? [] : held().filter(id => restored.has(id) && !live.has(id))
      if (found.length === 0) { settle(); return [] }
      phase = 'confirming'
      suspects = new Set(found)
      return found
    },
    confirm(payload) {
      if (phase !== 'confirming') return []
      const live = retainableSessionIds(payload)
      const dropped = live === null ? [] : held().filter(id => suspects.has(id) && !live.has(id))
      // Drop while still gated, then settle: the hosts first see the kept set.
      if (dropped.length > 0) drop(new Set(dropped))
      settle()
      return dropped
    },
  }
}
