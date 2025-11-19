# @marianmeres/fsm

Lightweight, typed, framework-agnostic Finite State Machine.

## Install
```sh
deno add jsr:@marianmeres/fsm
```
```sh
npm install @marianmeres/fsm
```

## Terminology

**State**

A string label representing the FSM's current state.

Note: The wildcard notation "*" is supported as a DRY shortcut for transition definitions but is not considered a true state label.

**Event**

A string label sent to the FSM to trigger a state transition. It can be considered a synonym
for _transition_.

**Transition**

1. The synchronous lifecycle phase that occurs after receiving an event and before the state actually changes. During this phase, _guards_ are evaluated and _effects_ are executed.
2. Actual function (if exists) which is executed during the transition period after the _effects_.

**Guard** (a.k.a `canTransition`) 

An optional function that determines whether a transition should proceed, based on context evaluation or other conditions. Returns a boolean.

**Effect** 

Side-effect function executed during transitions in a "fire-and-forget" manner. Run before the state change (after the guard).

**Context** 

A custom object accessible throughout the FSM's lifetime, containing arbitrary data that can be read and modified.

**_entry**, **_exit** 

Optional lifecycle hooks executed when entering or exiting a state during a transition. During this phase it can trigger another transition (by sending an event).

## FSM happy execution flow

Assuming below that event is configured, guards do allow, new state is different from the old.

1. set initial state
2. `send` an _event_
3. evaluate _guards_
4. execute *_exit* hook on the OLD state
5. execute _effects_
6. set new state (either with the returned value of the transition function or with direct text label)
7. execute *_entry* hook on the NEW state
8. notify subscribers

## Examples

```typescript
import { createFsm } from "@marianmeres/fsm";
```

```typescript
type SwitchState = "ON" | "OFF";
type SwitchEvent = "toggle" | "start" | "stop";

// no guards, no side effects in this example
const fsm = createFsm<SwitchState, SwitchEvent>(
    "OFF", // initial state
    // available states and theirs events/transitions config map
    {
        // ON state definition
        ON: {
            // event/transition: target state
            stop: "OFF",
        },
        // OFF state definition
        OFF: {
            // event/transition: target state
            start: "ON",
        },
        // DRY shortcut - every state has `toggle` as available event/transition
        "*": {
            // event/transition returning target state (via another `send` call)
            toggle: (_payload, meta) => {
                const { current, send } = meta;
                return current === "ON" ? send("stop") : send("start");
            },
        },
    },
);

const unsub = fsm.subscribe((state) => {
    console.log(state)
});

assertEquals(fsm.getCurrent(), 'OFF');

// sends "toggle" event, which initiates transition to state "ON"
assertEquals(fsm.send('toggle'), 'ON');

```
