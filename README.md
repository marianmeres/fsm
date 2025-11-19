# @marianmeres/fsm

Lightweight, typed, framework-agnostic Finite State Machine.

## Terminology

**State** - a string label defining a state the FSM is currently in. 

Note: There is a special wildcard state notation "*" supported which is NOT considered as a true state label, it just acts as a shortcut.

**Event** - a string label which is _sent_ to FSM to trigger state change. 

**Transition** - internal sync lifecycle period after receiving an state change event, but before the actual change happens. Time when "Guards" and "Actions" are executed.

**Guard** - optional function which checks whether to allow the state change based on the context evaluation (or any other condition check).

**Action** - a pre/post side effect "fire-and-forget" functions executed during transitions.

**Context** - custom arbitrary read/write object visible to FSM during the whole lifetime.

"Entry/Exit" - optional lifecycle methods executed on state change



