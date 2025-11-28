# @marianmeres/fsm

A lightweight, typed, framework agnostic and synchronous finite state machine that acts as a pure state graph description.

It manages state transitions and enforces rules via **guards**, **transition actions**, and **lifecycle hooks** (`onEnter`/`onExit`), but contains no business logic by design.

To integrate into your application, wrap this FSM in a layer that handles your business logic and calls `fsm.transition(name, payload)` in response to events.

This separation ensures the state machine remains simple, testable, and reusable across different contexts.

## Install
```sh
deno add jsr:@marianmeres/fsm
```
```sh
npm install @marianmeres/fsm
```

## Example

```typescript
import { FSM } from "@marianmeres/fsm";
```

```typescript
type STATES = "IDLE" | "FETCHING" | "RETRYING" | "SUCCESS" | "FAILED";
type TRANSITIONS = "fetch" | "resolve" | "reject" | "retry" | "reset";
type CONTEXT = { attempts: number; maxRetries: number; data: any; error: any; };

const fsm = new FSM<STATES, TRANSITIONS, CONTEXT>({
    initial: "IDLE",
    // Use a factory function for context to ensure a fresh object on reset()
    context: () => ({ attempts: 0, maxRetries: 2, data: null, error: null }),
    states: {
        IDLE: {
            on: { fetch: "FETCHING" }, // simple string notation
        },
        FETCHING: {
            onEnter: (context: any) => {
                context.attempts += 1;
            },
            on: {
                resolve: "SUCCESS",
                // will resolve to first guard passing state
                reject: [
                    {
                        target: "RETRYING",
                        guard: (ctx) => ctx.attempts < ctx.maxRetries,
                        // Action executes specifically on this transition edge
                        action: (ctx) => {
                            console.log(`Attempt ${ctx.attempts} failed...`)
                        },
                    },
                    {
                        target: "FAILED",
                        guard: (ctx) => ctx.attempts >= ctx.maxRetries,
                    },
                ],
            },
        },
        RETRYING: {
            on: { retry: "FETCHING" },
        },
        SUCCESS: {
            onEnter: (context, data) => {
                context.data = data;
            },
            on: { reset: "IDLE" },
        },
        FAILED: {
            onEnter: (context, error) => {
                context.error = error;
            },
            on: { reset: "IDLE" },
        },
    },
}); 

// examples:

// subscribe to reactive updates
const unsub = fsm.subscribe(({ state, context }) => log.push({ state, context }));

assertEquals(fsm.is("IDLE"), true);

// `transition` is the main API function
assertEquals(fsm.transition("fetch"), "FETCHING");

// this must throw - cannot "retry" from "FETCHING"
assertThrows(() => fsm.transition("retry"));

// non-reactive props
console.log(fsm.state, fsm.context);

// built-in mermaid helper so you can easily visualize the graph
console.log(fsm.toMermaid());
/**
stateDiagram-v2
    [*] --> IDLE
    IDLE --> FETCHING: fetch
    FETCHING --> SUCCESS: resolve
    FETCHING --> RETRYING: reject [guard 1] / (action)
    FETCHING --> FAILED: reject [guard 2]
    RETRYING --> FETCHING: retry
    SUCCESS --> IDLE: reset
    FAILED --> IDLE: reset
*/

// parse mermaid diagram back to FSM (for documentation/visualization roundtripping)
const fsm2 = FSM.fromMermaid(fsm.toMermaid());
// Note: guards/actions become placeholders (null), onEnter/onExit hooks are not preserved
```

![State Diagram](mermaid.png "State Diagram")

## Transitions

Transitions execute synchronously following a strict lifecycle order: `onExit` (current state) → `action` (transition edge) → `onEnter` (target state). This design isolates "edge-specific" side effects from general state initialization logic. 

The FSM also supports **internal transitions** (defined without a target), allowing you to execute actions and update context without triggering state changes or lifecycle hooks.

### Internal vs. External Transitions

* **External Transition (Re-entry):** If `target` is defined, the FSM executes: `onExit` → `action` → `onEnter`. Use this to "reset" a state.
* **Internal Transition:** If `target` is omitted, the FSM executes **only** the `action`. Lifecycle hooks are skipped. Use this for side effects without re-initialization.

```typescript
const fsm = new FSM({
    states: {
        PLAYING: {
            onEnter: () => console.log('Started'),
            onExit: () => console.log('Stopped'),
            on: {
                // External: triggers onExit -> Action -> onEnter
                restart: { target: 'PLAYING' },

                // Internal: triggers action ONLY (no exit/enter logs)
                volumeUp: {
                    action: (ctx) => ctx.volume += 1
                }
            }
        }
    }
});
```

## Wildcard Transitions

Use the wildcard `"*"` to define a fallback transition that catches any event not explicitly defined. Specific transitions always take priority over wildcards.

```typescript
const fsm = new FSM({
    initial: "IDLE",
    states: {
        ACTIVE: {
            on: {
                stop: "IDLE",      // specific transition takes priority
                "*": "ERROR"        // wildcard catches everything else
            }
        },
        ERROR: {
            on: {
                "*": "IDLE"         // any event returns to IDLE
            }
        }
    }
});

fsm.transition("stop");      // → IDLE (specific)
fsm.transition("crash");     // → ERROR (wildcard)
fsm.transition("anything");  // → IDLE (wildcard)

// Mermaid diagrams show wildcards as "* (any)"
console.log(fsm.toMermaid());
// Output includes: "ACTIVE --> ERROR: * (any)"
```

Wildcards support all transition features including guards and actions:

```typescript
{
    on: {
        "*": {
            target: "ERROR",
            guard: (ctx) => ctx.errorCount < 3,
            action: (ctx) => ctx.errorCount++
        }
    }
}
```

## Checking Transition Validity

Use `canTransition()` to check if a transition is valid without executing it. This respects guards and wildcard rules.

```typescript
if (fsm.canTransition("submit")) {
    fsm.transition("submit");
} else {
    console.log("Submit not available in current state");
}

// Works with guarded transitions
const canRetry = fsm.canTransition("retry", payload);
```

**Note on Safety:** `canTransition()` is a pure query method that internally clones the context before evaluating guards. This ensures that even if a guard mistakenly mutates context, the actual FSM state remains unaffected.

## Naming Conventions

The following naming conventions are recommended for clarity and consistency:

- **States**: `UPPERCASE` nouns describing a condition or mode
  - Examples: `IDLE`, `LOADING`, `SUCCESS`, `ERROR`
  - States represent "being" - what mode the system is in

- **Transitions**: `lowercase` verbs describing an action or command
  - Examples: `fetch`, `resolve`, `retry`, `reset`
  - Transitions represent "doing" - what causes the state to change

These conventions make state machines more readable by visually distinguishing states from transitions, and semantically aligning with their nature (nouns for static conditions, verbs for dynamic actions).

## Context and Guards Best Practices

**Guards should be pure functions** that only read context and return a boolean. They should never mutate context.

**Context should contain only data** (no functions). This ensures:
- Context can be safely cloned (for `canTransition` safety)
- State is serializable (for debugging, persistence, localStorage)
- Behavior is predictable and testable

```typescript
// ✅ Good: Pure guard, data-only context
type Context = { attempts: number; maxRetries: number };
guard: (ctx) => ctx.attempts < ctx.maxRetries

// ❌ Bad: Mutating in guard
guard: (ctx) => { ctx.attempts++; return true }

// ❌ Bad: Functions in context
context: { count: 0, increment: () => {} }
```

For mutations, use **action hooks** (`action`, `onEnter`, `onExit`) which are designed for side effects. For helper functions, define them outside the FSM and pass context as parameters.