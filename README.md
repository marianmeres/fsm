# @marianmeres/fsm

Lightweight, typed, framework-agnostic Finite State Machine.

## Terminology

**State** - A string label representing the FSM's current state.

Note: The wildcard notation "*" is supported as a DRY shortcut for transition definitions but is not considered a true state label.

**Event** - A string label sent to the FSM to trigger a state transition.

**Transition** - The synchronous lifecycle phase that occurs after receiving an event and before the state actually changes. During this phase, guards are evaluated and effects are executed.

**Guard** (a.k.a `canTransition`) - An optional function that determines whether a transition should proceed, based on context evaluation or other conditions. Returns a boolean.

**Effect** - Side-effect function executed during transitions in a "fire-and-forget" manner. Run before the state change (after the guard).

**Context** - A custom object accessible throughout the FSM's lifetime, containing arbitrary data that can be read and modified.

**Entry/Exit** - Optional lifecycle hooks executed when entering or exiting a state during a transition. During this phase the FSM can trigger another transition (by sending an event).



