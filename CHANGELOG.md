# Changelog

## 3.0.0

Major release with bug fixes, robustness improvements, and a few breaking changes.
All changes are aimed at making the FSM safer to use and more predictable.

### Breaking changes

- **`transition(event, payload, false)` now returns `null` on failure** (instead of the
  current state). This lets callers cleanly distinguish a failed/rejected transition
  from a successful one. Old code that did `if (fsm.transition(e, p, false))` was
  always truthy; the new return value makes the check meaningful.
  - **Migration:** if you relied on the old behavior, replace `fsm.transition(e, p, false)`
    with `fsm.transition(e, p, false) ?? fsm.state`.

- **`reset()` now runs lifecycle hooks.** It calls `onExit` on the current state, swaps
  to the initial state and a fresh context, then calls `onEnter` on the initial state,
  then notifies subscribers. Previously it bypassed both hooks.
  - **Migration:** if any of your states have hooks that you did NOT want to run on
    reset, gate them on a flag in context (e.g., `if (!ctx._resetting) ...`) or split
    the work between `onEnter` (always) and a separate event-driven action.

- **Wildcard `"*"` is now used as a fallback when a specific event handler exists but
  all its guards reject.** Previously, wildcards fired only when no specific handler
  existed at all.
  - **Migration:** if your wildcard was meant to catch only "unknown event" cases and
    not also cover guard-rejected specific events, restructure the specific handler so
    its guards do not reject (or remove the wildcard).

- **Plain-object context is now deep-cloned on init and `reset()`.** Previously it was
  shallow-copied, so nested objects were shared with `config.context` and survived
  reset.
  - **Migration:** none required. If you somehow relied on the shared-reference bug,
    move the shared state outside the FSM.

- **`composeFsmConfig`: option `onConflict` renamed to `onInitialConflict`** to make
  its (initial-only) scope explicit.
  - **Migration:** rename `onConflict` → `onInitialConflict` at all call sites. The old
    name throws a TypeScript error and is silently ignored at runtime.

- **`composeFsmConfig` merge mode now deep-clones each fragment's context** before
  merging, so the resulting factory produces a fresh tree on every reset. Previously
  nested objects were shared across fragments and resets.
  - **Migration:** none required.

- **The constructor now validates the configuration** and throws if `initial` does not
  exist in `states`, or if any transition target references a state that is not in
  `states`. Errors that previously surfaced at the first `transition()` now surface
  at construction.
  - **Migration:** fix the configuration. The error messages name the offending state /
    transition.

- **The constructor now deep-freezes the configuration object.** Mutating
  `fsm.config.states.X.on` after construction throws in strict mode.
  - **Migration:** if you were mutating config after construction, stop. Build the
    config fully before passing it.

- **Lifecycle hook errors are now wrapped** with the originating event/state name and
  hook (`onExit` / `action` / `onEnter` / `guard`). The original error is preserved as
  the new error's `cause`.
  - **Migration:** if you matched on `error.message`, switch to `error.cause` or use
    a more robust check.

- **`PublishedState<TState>` gained a second generic parameter for context** and now
  declares the `context` field that subscribers were already receiving at runtime.
  Old shape: `{ current, previous }`. New shape: `{ current, previous, context }`.
  - **Migration:** explicit annotations like `PublishedState<MyState>` keep working
    (the new generic defaults to `unknown`). To narrow context, use
    `PublishedState<MyState, MyContext>`.

- **`toTypeScript` always quotes state and event keys** in the generated object literal
  (e.g., `"IDLE": { ... }` and `"fetch": "LOADING"`). This is the only safe choice for
  reserved words and non-identifier names.
  - **Migration:** if a tool downstream of `toTypeScript` parses the output strictly,
    update its expectations.

### Fixes

- `toMermaid` now correctly emits `[guarded]` for a single unindexed guard
  (previously emitted the unreachable `[guard -1]`).

- `toMermaid` no longer emits a phantom `[guard N]` label for unguarded entries inside
  array transitions (e.g., the catch-all entry in a retry-with-fallback array).

- `fromMermaid` now ensures every referenced state — including pure leaf targets that
  never appear as a transition source — is present in `config.states`. The result
  passes the new constructor validation.

### New API

- `previous` getter — returns the prior state, or `null` if none.
- `matches(...states): boolean` — true if the FSM is in any of the given states.
- `cannot(event, payload?): boolean` — inverse of `canTransition()`.
- `getSnapshot(): { state, previous, context }` — returns a snapshot whose `context`
  is a deep clone (safe to mutate or serialize).
- `FSMSnapshot<TState, TContext>` type — return shape of `getSnapshot()`.

### Internal

- All guard / action / hook invocations are now wrapped to attach diagnostic context
  (state, event, hook name) on failure.
- `transition()` lifecycle: on `onEnter` throw, the state mutation is committed
  and subscribers are notified in a `finally` block before the error propagates.
  This prevents subscribers from seeing a desynchronized state.
