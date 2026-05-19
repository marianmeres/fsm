# Feature request — `@marianmeres/fsm`

> Two additive, non-breaking changes needed so the existing FSM library can serve as the substrate for a new durable workflow framework (`@marianmeres/workflow`), without forking or duplicating the FSM concept.

## Why this matters

I'm building `@marianmeres/workflow` — a durable, long-lived orchestration framework whose definition layer is essentially an FSM. The brief is to keep **a single FSM package** in the ecosystem, with `@marianmeres/workflow` sitting on top of `@marianmeres/fsm` rather than re-implementing transitions. The mapping is very natural — workflow "outcome labels" are fsm events, workflow "nodes" are fsm states, workflow transition tables are `on: { LABEL → nextNodeId }`. fsm already enforces JSON-safe configs and provides Mermaid output, composition, and guards.

Two gaps need to be closed before fsm can carry that workflow use cleanly. **Both are purely additive — no existing API changes, no behavior changes for current consumers.** After both land, fsm gets a minor version bump and `@marianmeres/workflow` depends on the new version.

---

## Change 1 — Per-state `meta` field (passthrough metadata)

### Problem

The workflow framework needs to attach per-node metadata that fsm itself should not interpret — e.g. *what kind of node is this* (pure decision / effectful / suspending / terminal), *which user handler resolves it*, *which signal matcher belongs to it*, *what's the timeout*. Today there's no obvious place to put that — `onEnter`/`onExit`/`action` are function hooks, not data, and stuffing it into context would mix per-instance state with per-definition shape.

### Proposed API

Add an optional, fully arbitrary `meta` field on each state config:

```ts
export type FSMStatesConfigValue<TState, TEvent, TContext> = {
    onEnter?: (context: TContext, payload?: FSMPayload) => void;
    on: Partial<Record<TEvent | "*", TransitionDef<TState, TContext>>>;
    onExit?: (context: TContext, payload?: FSMPayload) => void;
    /**
     * Arbitrary user-defined metadata about this state.
     * The FSM ignores this value entirely — it is preserved in the config
     * and exposed via getStateMeta() for consumers that want to attach
     * domain semantics (e.g. node kinds, handler ids) to states.
     */
    meta?: unknown;
};
```

Add a read accessor (the only fsm-side interpretation needed):

```ts
class FSM<TState, TEvent, TContext> {
    /**
     * Returns the `meta` attached to the given state config, or undefined.
     * The FSM never reads or interprets this value internally.
     */
    getStateMeta<T = unknown>(state: TState): T | undefined;

    /** Convenience: meta for the current state. */
    getCurrentMeta<T = unknown>(): T | undefined;
}
```

### Semantics

- fsm **never** reads, validates, or branches on `meta`.
- `meta` is preserved by `composeFsmConfig` — merging fragments should merge or overwrite `meta` per the same rules as other state-config fields (last-write-wins is fine; just don't drop it).
- `meta` is preserved by `fromMermaid` (no-op since Mermaid carries no meta), and ideally emitted as a comment by `toMermaid` (or omitted — either is fine, but don't crash).
- Generic typing: `getStateMeta<T>()` so workflow can do `fsm.getStateMeta<NodeMeta>("await_reply")` and get the right type.

### What this unlocks in workflow

```ts
const nodes = {
    detect_low_stock: {
        meta: { kind: "effectful", handler: "checkInventory" },
        on: { LOW: "send_order", OK: "_end" },
    },
    await_reply: {
        meta: { kind: "suspending", matcher: "matchEmailReply", timeoutSec: 259200 },
        on: { MATCHED: "classify_reply", TIMEOUT: "_end" },
    },
    _end: { meta: { kind: "terminal" } },
};
```

The workflow driver looks up `fsm.getCurrentMeta()` to decide whether to run a handler, schedule a wake-up, or mark the instance complete.

---

## Change 2 — `FSM.fromSnapshot(config, snapshot)` factory

### Problem

For durable workflow use, an instance can sleep for days, survive process restarts, and resume mid-graph. The `getSnapshot()` API already gives us `{ state, previous, context }`. The missing piece is the inverse: constructing an FSM **pre-positioned** at a saved snapshot. Today the constructor only takes `initial:`, and you'd have to construct then mutate private fields (or fight `Readonly<>`), which is ugly and fragile.

### Proposed API

A static factory:

```ts
class FSM<TState, TEvent, TContext> {
    /**
     * Construct an FSM pre-positioned at a previously captured snapshot.
     * Skips initial-state entry hooks — this is a restore, not a start.
     *
     * The `state` and `previous` from the snapshot are validated to exist
     * in `config.states` (same validation as the constructor performs on `initial`).
     *
     * `context` from the snapshot replaces whatever the config's context factory would produce.
     *
     * @throws if snapshot.state or snapshot.previous is not in config.states
     */
    static fromSnapshot<TState extends string, TEvent extends string, TContext>(
        config: FSMConfig<TState, TEvent, TContext>,
        snapshot: FSMSnapshot<TState, TContext>,
    ): FSM<TState, TEvent, TContext>;
}
```

### Semantics

- **No `onEnter` runs.** Resume is not entry; running `onEnter` on resume would double-execute side effects. The current state's `onEnter` already fired the first time, in the process that wrote the snapshot.
- **Subscribers list starts empty** (snapshots don't carry subscribers).
- **Validation matches the constructor.** Unknown `state` or `previous` → throw with the same message style.
- **Round-trip property:** for any FSM `f`, `FSM.fromSnapshot(config, f.getSnapshot()).getSnapshot()` is deep-equal to `f.getSnapshot()`.
- Existing snapshot type stays as-is:
  ```ts
  type FSMSnapshot<TState, TContext> = {
      state: TState;
      previous: TState | null;
      context: TContext;
  };
  ```

### Why this isn't "just" `new FSM({...config, initial: snapshot.state})`

That approach would:
1. Fire `onEnter` for the restored state, which would re-run side effects.
2. Lose `previous`.
3. Force the caller to mutate `context` after construction.

A dedicated factory makes the durable-resume case first-class and the contract explicit.

### What this unlocks in workflow

```ts
// In the workflow advance worker:
const row = await db.loadInstance(id);                       // { cursor, context, ... }
const def = registry.get(row.definitionId, row.definitionVersion);
const fsm = FSM.fromSnapshot(def.fsmConfig, {
    state: row.cursor,
    previous: row.previousCursor,
    context: row.context,
});

// fsm is now ready for outcome-driven advancement:
fsm.transition(outcomeFromHandler, outcomeData);
const newSnap = fsm.getSnapshot();
await db.persistInstance(id, { cursor: newSnap.state, context: newSnap.context });
```

---

## Optional follow-up (NOT a blocker, just flagging)

A `state.terminal?: boolean` flag (or `isFinal(state)` query) would be ergonomic for the workflow driver to detect "done" states without consulting `meta.kind === 'terminal'` by convention. Skip unless trivial — `meta` convention works fine.

---

## Backwards compatibility

- `meta` is an additional optional field → no breakage.
- `getStateMeta` / `getCurrentMeta` are new methods → no breakage.
- `FSM.fromSnapshot` is a new static method → no breakage.
- No existing function signature, type, or behavior changes.
- Recommendation: ship as a minor version bump (e.g. `1.X.0` → `1.(X+1).0`).

## Tests to add (suggested)

1. `meta` is preserved on a constructed FSM and retrievable via `getStateMeta` / `getCurrentMeta`.
2. `meta` survives `composeFsmConfig` merges (last-write-wins on conflict).
3. `meta` is left untouched by `getSnapshot()` (snapshot still excludes config, only state+previous+context).
4. `fromSnapshot` round-trip: `FSM.fromSnapshot(cfg, fsm.getSnapshot()).getSnapshot()` deep-equals the source.
5. `fromSnapshot` does **not** invoke `onEnter` on the restored state (assert via a spy).
6. `fromSnapshot` preserves `previous`.
7. `fromSnapshot` throws on snapshot.state / snapshot.previous unknown to config (parity with constructor's `initial` validation).
8. After `fromSnapshot`, a subsequent `transition(...)` works exactly as if the machine had reached that state via normal transitions (no leaked state from the would-be "initial" path).

## Files likely affected

- [src/fsm.ts](/Users/mm/projects/@marianmeres/fsm/src/fsm.ts) — `FSMStatesConfigValue` type, `FSM` class (constructor refactor to share with `fromSnapshot`, two new methods).
- [src/compose-fsm-config.ts](/Users/mm/projects/@marianmeres/fsm/src/compose-fsm-config.ts) (if it exists) — ensure `meta` merges, not drops.
- Tests + a brief README section under "Persistence / durable resume".

---

## TL;DR

1. **`state.meta?: unknown`** plus `getStateMeta()` / `getCurrentMeta()` — a passthrough slot for domain metadata.
2. **`FSM.fromSnapshot(config, snapshot)`** — first-class durable-resume constructor that skips `onEnter` and preserves `previous`.

Both purely additive. After these land, `@marianmeres/workflow` can be implemented as a thin durable layer over fsm rather than a parallel implementation.
