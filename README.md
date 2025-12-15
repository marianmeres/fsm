# @marianmeres/fsm

[![NPM version](https://img.shields.io/npm/v/@marianmeres/fsm.svg)](https://www.npmjs.com/package/@marianmeres/fsm)
[![JSR version](https://jsr.io/badges/@marianmeres/fsm)](https://jsr.io/@marianmeres/fsm)

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
type EVENTS = "fetch" | "resolve" | "reject" | "retry" | "reset";
type CONTEXT = { attempts: number; maxRetries: number; data: unknown; error: unknown; };

const fsm = new FSM<STATES, EVENTS, CONTEXT>({
    initial: "IDLE",
    // Use a factory function for context to ensure a fresh object on reset()
    context: () => ({ attempts: 0, maxRetries: 2, data: null, error: null }),
    states: {
        IDLE: {
            on: { fetch: "FETCHING" }, // simple string notation
        },
        FETCHING: {
            onEnter: (context) => {
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
const unsub = fsm.subscribe(({ current, context }) => log.push({ current, context }));

assertEquals(fsm.is("IDLE"), true);

// `transition` is the main API function
assertEquals(fsm.transition("fetch"), "FETCHING");

// this must throw - cannot "retry" from "FETCHING"
assertThrows(() => fsm.transition("retry"));

// non-reactive props
console.log(fsm.state, fsm.context);

```

## Events vs Transitions

Understanding the distinction between **events** and **transitions** helps clarify FSM concepts:

| **Event** | **Transition** |
|-----------|----------------|
| The trigger/signal — *what happened* | The response/rule — *what to do about it* |
| A name like `"click"`, `"submit"`, `"timeout"` | The full definition: target state + guard + action |
| External input to the FSM | Internal FSM configuration |
| **Sent** to the machine | **Defined** in the machine |

In the configuration, the `on` property maps **events** to **transitions**:

```typescript
states: {
    IDLE: {
        on: {
            "load": "LOADING"  // ← "load" is the EVENT
                               // ← "LOADING" (or full object) is the TRANSITION
        }
    }
}
```

**Mental model:** Think of a vending machine — you press button "A3" (the **event**), and the machine's internal rule says "if in READY state and button A3 pressed, dispense item and go to DISPENSING state" (the **transition**).

More simply: **Event** = "What did you say?" / **Transition** = "What I'll do about it."

## Mermaid Diagram Support

The FSM includes built-in support for [Mermaid](https://mermaid.js.org/) state diagrams, enabling visualization, documentation, and even diagram-driven development.

### Exporting to Mermaid (`toMermaid`)

Generate a Mermaid state diagram from your FSM definition:

```typescript
console.log(fsm.toMermaid());
```

Output:
```
stateDiagram-v2
    [*] --> IDLE
    IDLE --> FETCHING: fetch
    FETCHING --> SUCCESS: resolve
    FETCHING --> RETRYING: reject [guard 1] / (action)
    FETCHING --> FAILED: reject [guard 2]
    RETRYING --> FETCHING: retry
    SUCCESS --> IDLE: reset
    FAILED --> IDLE: reset
```

![State Diagram](mermaid.png "State Diagram")

This is useful for:
- **Documentation**: Automatically generate up-to-date diagrams from code
- **Debugging**: Visualize complex state machines to understand flow
- **Communication**: Share state machine designs with non-technical stakeholders

### Parsing from Mermaid (`fromMermaid`)

Create an FSM instance directly from a Mermaid diagram string:

```typescript
const fsm = FSM.fromMermaid(`
stateDiagram-v2
    [*] --> IDLE
    IDLE --> LOADING: fetch
    LOADING --> SUCCESS: resolve
    LOADING --> ERROR: reject
    SUCCESS --> IDLE: reset
    ERROR --> IDLE: reset
`);

// The FSM is fully functional
fsm.transition("fetch");  // → LOADING
fsm.transition("resolve"); // → SUCCESS
```

This enables **diagram-driven development**: design your state machine visually first, then parse it into a working FSM.

### Roundtripping

You can export an FSM to Mermaid and parse it back:

```typescript
const fsm2 = FSM.fromMermaid(fsm.toMermaid());
```

**Note:** Guards and actions become placeholder functions when parsing from Mermaid (since diagrams only capture structure, not logic). Lifecycle hooks (`onEnter`/`onExit`) are also not preserved.

### Generating TypeScript Code (`toTypeScript`)

For a complete workflow where you design visually and implement in code, use `toTypeScript` to generate ready-to-paste TypeScript with TODO placeholders:

```typescript
import { toTypeScript } from "@marianmeres/fsm";

const tsCode = toTypeScript(`
stateDiagram-v2
    [*] --> IDLE
    IDLE --> LOADING: fetch
    LOADING --> SUCCESS: resolve [guard hasData]
    LOADING --> ERROR: reject
`);
console.log(tsCode);
```

Output:
```typescript
type States = "IDLE" | "LOADING" | "SUCCESS" | "ERROR";
type Transitions = "fetch" | "resolve" | "reject";
type Context = { /* TODO: define your context */ };

const config: FSMConfig<States, Transitions, Context> = {
	initial: "IDLE",
	// context: () => ({ /* TODO */ }),
	states: {
		IDLE: {
			on: {
				fetch: "LOADING",
			},
		},
		LOADING: {
			on: {
				resolve: {
					target: "SUCCESS",
					guard: (ctx) => true, // TODO: [guard hasData]
				},
				reject: "ERROR",
			},
		},
		// ... rest of states
	},
};
```

This is useful for **diagram-driven development**: design your state machine visually, generate the TypeScript skeleton, then implement the guards and actions.

You can automate this process even further by combining deno task with optional `pbcopy`. For example:

```json
{
    "tasks": {
        "mermaid-to-typescript": "deno run -A jsr:@marianmeres/fsm/mermaid-to-typescript"
    }
}
```

And then:

```sh
deno task mermaid-to-typescript --infile my/file.mermaid | pbcopy
```

### Complex Diagram Support

The parser handles real-world Mermaid diagrams with visual annotations:

```typescript
const fsm = FSM.fromMermaid(`
stateDiagram-v2
    direction LR

    %% Traffic Light Controller
    %% Author: Your Name

    [*] --> RED

    state "Stop" as RED
    state "Go" as GREEN

    RED --> GREEN: timer
    GREEN --> RED: timer

    classDef danger fill:#f00
    class RED danger

    note right of RED: Vehicles must stop
`);
```

YAML frontmatter, comments (`%%`), styling (`classDef`, `class`), notes, directions, and state aliases are gracefully ignored during parsing, extracting only the structural information needed to build the FSM.

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

### Self-Loop Transitions and Infinite Loops

**Self-loop transitions** (where the target state equals the current state) are valid FSM semantics. When a self-loop occurs, the full lifecycle executes: `onExit` → `action` → `onEnter` → notify subscribers. This is useful for retry logic, refresh patterns, or re-initialization.

However, be cautious when calling `transition()` from within a subscriber callback. Since notifications are synchronous, transitioning to the same state (or any state that leads back) can cause an infinite loop:

```typescript
// ⚠️ DANGER: This will cause an infinite loop!
fsm.subscribe(({ current }) => {
    if (current === "LOADING") {
        fsm.transition("refresh"); // If "refresh" targets "LOADING" again...
    }
});
```

**Prevention patterns:**

1. **Check for actual state changes:**
```typescript
fsm.subscribe(({ current, previous }) => {
    // Only react to actual state changes, not self-loops
    if (current !== previous) {
        fsm.transition("someEvent");
    }
});
```

2. **Use guards to prevent repeated transitions:**
```typescript
{
    on: {
        refresh: {
            target: "LOADING",
            guard: (ctx) => !ctx.isRefreshing,
            action: (ctx) => ctx.isRefreshing = true
        }
    }
}
```

3. **Use internal transitions** when you only need to run an action without re-entering the state:
```typescript
{
    on: {
        // No target = internal transition, no onExit/onEnter, but still notifies
        updateData: { action: (ctx) => ctx.data = fetchedData }
    }
}
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

## Debug Logging

The FSM uses `@marianmeres/clog` for debug logging. Debug output is controlled via the clog library's global setting or by providing a custom logger:

```typescript
import { createClog } from "@marianmeres/clog";

// Enable debug logging globally
createClog.global.debug = true;

const fsm = new FSM({
    initial: "IDLE",
    states: { ... }
});
```

Debug logging covers FSM creation, transitions, guard evaluations, lifecycle hooks, and reset operations.

### Custom Logger

You can provide a custom logger implementing the `Logger` interface (from `@marianmeres/clog`):

```typescript
import { FSM } from "@marianmeres/fsm";
import { createClog } from "@marianmeres/clog";

const fsm = new FSM({
    initial: "IDLE",
    logger: createClog('my-app-fsm'), // see @marianmeres/clog for more
    states: { ... }
});
```

## Configuration Composition

When building complex applications, you may need FSMs that share common behavior but differ in certain areas. For example, a data-fetching FSM might optionally support retry logic, or different user roles might enable different state branches.

The `composeFsmConfig` helper allows you to build FSM configurations from reusable fragments that are merged together at runtime. This helper is completely standalone from the FSM core - it simply produces a valid `FSMConfig` object before it reaches the FSM constructor.

### Motivation

- **Reusability**: Define core state logic once, extend it for different use cases
- **Conditional features**: Include or exclude entire state branches based on runtime conditions
- **Separation of concerns**: Keep feature-specific states in dedicated fragments

### Basic Usage

```typescript
import { composeFsmConfig, createFsm, type FSMConfigFragment } from "@marianmeres/fsm";

type States = "IDLE" | "LOADING" | "SUCCESS" | "ERROR" | "RETRYING";
type Events = "fetch" | "resolve" | "reject" | "retry" | "reset";
type Context = { attempts: number; maxRetries: number };

// Core fetch flow - always included
const coreFetch: FSMConfigFragment<States, Events, Context> = {
    initial: "IDLE",
    context: { attempts: 0, maxRetries: 3 },
    states: {
        IDLE: { on: { fetch: "LOADING" } },
        LOADING: { on: { resolve: "SUCCESS", reject: "ERROR" } },
        SUCCESS: { on: { reset: "IDLE" } },
        ERROR: { on: { reset: "IDLE" } },
    },
};

// Optional retry feature - conditionally included
const retryFeature: FSMConfigFragment<States, Events, Context> = {
    states: {
        ERROR: {
            on: {
                retry: {
                    target: "RETRYING",
                    guard: (ctx) => ctx.attempts < ctx.maxRetries,
                },
            },
        },
        RETRYING: {
            onEnter: (ctx) => ctx.attempts++,
            on: { resolve: "SUCCESS", reject: "ERROR" },
        },
    },
};

// Compose based on feature flag
const enableRetry = true;
const config = composeFsmConfig([coreFetch, enableRetry && retryFeature]);
const fsm = createFsm(config);
```

### Merge Behavior

Understanding how fragments merge is important:

| Property | Behavior |
|----------|----------|
| `initial` | Last fragment defining it wins |
| `context` | Shallow-merged by default (configurable) |
| `states.X.on` | Transitions are replaced by default (configurable) |
| `states.X.onEnter/onExit` | Configurable via `hooks` option |

### Options

```typescript
composeFsmConfig([...fragments], {
    hooks: "replace" | "compose",        // default: "replace"
    context: "merge" | "replace",        // default: "merge"
    onConflict: "last-wins" | "error",   // default: "last-wins"
    transitions: "replace" | "prepend" | "append"  // default: "replace"
});
```

- **`hooks: "replace"`** (default): Later fragment's hooks override earlier ones
- **`hooks: "compose"`**: All hooks run sequentially in fragment order
- **`context: "merge"`** (default): Shallow-merge context from all fragments
- **`context: "replace"`**: Later fragment's context completely overrides earlier
- **`onConflict: "error"`**: Throws if multiple fragments define different `initial` values
- **`transitions: "replace"`** (default): Later fragment's transitions override earlier ones
- **`transitions: "prepend"`**: Later fragment's transitions are prepended (run first)
- **`transitions: "append"`**: Later fragment's transitions are appended (run last)

### Transition Merging with Interceptor Pattern

The `transitions` option enables powerful composition patterns like authentication gates or confirmation dialogs without tight coupling between fragments:

```typescript
// Core application flow
const coreFetch: FSMConfigFragment<States, Events, Context> = {
    initial: "IDLE",
    states: {
        IDLE: { on: { submit: "PROCESSING" } },
        PROCESSING: { on: { resolve: "SUCCESS", reject: "ERROR" } },
        SUCCESS: { on: { reset: "IDLE" } },
        ERROR: { on: { reset: "IDLE" } },
    },
};

// Auth gate - intercepts transitions when not authenticated
const authGate: FSMConfigFragment<States, Events, Context> = {
    states: {
        IDLE: {
            on: {
                submit: {
                    target: "LOGIN_REQUIRED",
                    guard: (ctx) => !ctx.authenticated,
                },
            },
        },
        LOGIN_REQUIRED: { on: { login: "IDLE", cancel: "IDLE" } },
    },
};

// With "prepend", auth check runs BEFORE the base submit handler
const config = composeFsmConfig([coreFetch, authGate], {
    transitions: "prepend",
});

// Result: When "submit" is triggered from IDLE:
// 1. Auth guard checked first - if !authenticated, go to LOGIN_REQUIRED
// 2. If authenticated, fall through to base handler → PROCESSING
```

This pattern allows fragments to remain independent - the auth fragment doesn't need to know the implementation details of the base fragment.

### Conditional Fragments

Falsy values are automatically filtered out, enabling clean conditional inclusion:

```typescript
const config = composeFsmConfig([
    coreFragment,
    userIsAdmin && adminFeatures,
    featureFlags.retryEnabled && retryFeature,
    debugMode && debugFragment,
]);
```

## API Reference

For complete API documentation including all types, methods, and detailed parameter descriptions, see [API.md](API.md).
