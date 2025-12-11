# API Reference

## Table of Contents

- [FSM Class](#fsm-class)
  - [Constructor](#constructor)
  - [Properties](#properties)
  - [Methods](#methods)
- [Factory Function](#factory-function)
- [Static Methods](#static-methods)
- [Mermaid Parser](#mermaid-parser)
- [Configuration Composition](#configuration-composition)
- [Types](#types)

---

## FSM Class

A lightweight, typed, framework-agnostic Finite State Machine.

```typescript
import { FSM } from "@marianmeres/fsm";
```

### Constructor

```typescript
new FSM<TState, TEvent, TContext>(config: FSMConfig<TState, TEvent, TContext>)
```

Creates a new FSM instance.

**Type Parameters:**
- `TState extends string` - Union type of all possible state names
- `TEvent extends string` - Union type of all possible transition event names
- `TContext` - Type of the FSM context object (should contain only data, no functions)

**Parameters:**
- `config` - The FSM configuration object containing:
  - `initial: TState` - The initial state name
  - `states: FSMStatesConfigMap` - Map of state names to their configurations
  - `context?: TContext | (() => TContext)` - Optional context value or factory function
  - `debug?: boolean` - Enable debug logging (default: `false`)
  - `logger?: Logger` - Custom logger implementing Logger interface (default: console)

**Example:**
```typescript
const fsm = new FSM<"IDLE" | "LOADING", "load" | "done", { count: number }>({
  initial: "IDLE",
  context: { count: 0 },
  states: {
    IDLE: { on: { load: "LOADING" } },
    LOADING: { on: { done: "IDLE" } }
  }
});
```

---

### Properties

#### `state`

```typescript
get state(): TState
```

Returns the current state of the FSM. This is a non-reactive getter; use `subscribe()` for reactive updates.

#### `context`

```typescript
context: TContext
```

A custom data object accessible throughout the FSM's lifetime. Context should contain only data (no functions) to ensure serializability and cloneability. Mutate context in action hooks (`action`, `onEnter`, `onExit`), not in guards.

#### `config`

```typescript
readonly config: FSMConfig<TState, TEvent, TContext>
```

The original configuration object passed to the constructor.

#### `debug`

```typescript
get debug(): boolean
```

Returns whether debug mode is enabled. Useful for inspecting FSM configuration after instantiation.

#### `logger`

```typescript
get logger(): Logger
```

Returns the logger instance used by this FSM. Default is `console`. See [Logger](#logger) interface for details.

---

### Methods

#### `subscribe()`

```typescript
subscribe(
  cb: (data: PublishedState<TState> & { context: TContext }) => void
): Unsubscriber
```

Subscribes to FSM state changes. The callback is invoked immediately with the current state and on every subsequent state change.

**Parameters:**
- `cb` - Callback function receiving `{ current, previous, context }`

**Returns:** An unsubscriber function to stop receiving updates.

**Example:**
```typescript
const unsub = fsm.subscribe(({ current, previous, context }) => {
  console.log(`State changed from ${previous} to ${current}`);
});

// Later: stop listening
unsub();
```

---

#### `transition()`

```typescript
transition(
  event: TEvent,
  payload?: FSMPayload,
  assert?: boolean
): TState | null
```

Requests the FSM to transition based on the given event.

**Execution order for external transitions:**
1. `onExit` hook of the current state
2. `action` of the transition edge
3. State changes (previous/current updated)
4. `onEnter` hook of the new state
5. Subscribers notified

For internal transitions (no target defined), only the action runs and subscribers are notified.

**Parameters:**
- `event` - The transition event name
- `payload` - Optional data passed to guards, actions, and lifecycle hooks
- `assert` - If `true` (default), throws on invalid transitions; if `false`, returns current state

**Returns:** The new state after transition, or current state if transition failed in non-assert mode.

**Throws:** Error if the transition is invalid and `assert` is `true`.

**Example:**
```typescript
fsm.transition("fetch");                    // Basic transition
fsm.transition("resolve", { data: "..." }); // With payload
fsm.transition("invalid", null, false);     // Non-throwing mode
```

---

#### `canTransition()`

```typescript
canTransition(event: TEvent, payload?: FSMPayload): boolean
```

Checks whether a transition is valid from the current state without executing it. This is a pure query operation that does not modify FSM state. Guards are evaluated against a cloned context to ensure they cannot mutate state.

**Parameters:**
- `event` - The transition event name to check
- `payload` - Optional payload for guard evaluation

**Returns:** `true` if the transition can be executed, `false` otherwise.

**Example:**
```typescript
if (fsm.canTransition("submit")) {
  fsm.transition("submit");
} else {
  console.log("Submit not available");
}
```

---

#### `is()`

```typescript
is(state: TState): boolean
```

Checks whether the FSM is currently in the given state.

**Parameters:**
- `state` - The state to check against

**Returns:** `true` if the FSM is in the specified state.

**Example:**
```typescript
if (fsm.is("LOADING")) {
  showSpinner();
}
```

---

#### `reset()`

```typescript
reset(): FSM<TState, TEvent, TContext>
```

Resets the FSM to its initial state and re-initializes the context. If context was defined as a factory function, a fresh context is created. Subscribers are notified after reset.

**Returns:** The FSM instance for chaining.

**Example:**
```typescript
fsm.reset().is("IDLE"); // true
```

---

#### `toMermaid()`

```typescript
toMermaid(): string
```

Generates a Mermaid stateDiagram-v2 notation from the FSM configuration. Useful for visualizing the state machine graph.

The output follows UML conventions:
- Guards are shown as `[guard N]` or `[guarded]`
- Actions are shown as `/ (action)` or `/ (action internal)` for internal transitions
- Wildcards are shown as `* (any)`

**Returns:** Mermaid diagram string.

**Example:**
```typescript
console.log(fsm.toMermaid());
// stateDiagram-v2
//     [*] --> IDLE
//     IDLE --> LOADING: load
//     LOADING --> SUCCESS: resolve
```

---

## Factory Function

### `createFsm()`

```typescript
function createFsm<TState, TEvent, TContext>(
  config: FSMConfig<TState, TEvent, TContext>
): FSM<TState, TEvent, TContext>
```

Factory function to create an FSM instance. Equivalent to calling `new FSM(config)`.

**Example:**
```typescript
const fsm = createFsm<"ON" | "OFF", "toggle">({
  initial: "OFF",
  states: {
    ON: { on: { toggle: "OFF" } },
    OFF: { on: { toggle: "ON" } }
  }
});
```

---

## Static Methods

### `FSM.fromMermaid()`

```typescript
static fromMermaid<TState, TEvent, TContext>(
  mermaidDiagram: string
): FSM<TState, TEvent, TContext>
```

Creates an FSM instance from a Mermaid stateDiagram-v2 notation. This is a static factory method that wraps the standalone `fromMermaid` parser.

**Limitations:**
- Cannot recreate actual guard/action functions (sets them to `null` as placeholders)
- Cannot recreate `onEnter`/`onExit` hooks (not represented in Mermaid)
- Cannot infer context structure

**Example:**
```typescript
const fsm = FSM.fromMermaid<"IDLE" | "ACTIVE", "start" | "stop">(`
  stateDiagram-v2
  [*] --> IDLE
  IDLE --> ACTIVE: start
  ACTIVE --> IDLE: stop
`);
```

---

## Mermaid Parser

### `fromMermaid()`

```typescript
function fromMermaid<TState, TEvent, TContext>(
  mermaidDiagram: string
): FSMConfig<TState, TEvent, TContext>
```

Parses a Mermaid stateDiagram-v2 notation into an FSM configuration object. This function enables round-tripping between FSM configurations and Mermaid diagrams.

**Supported label formats:**
- `event` - Simple transition
- `* (any)` - Wildcard transition
- `event [guard N]`, `event [guarded]`, or `event [guard ...]` - Guarded transition
- `event / (action)` - Transition with action
- `event / (action internal)` - Internal transition (no state change)
- `event / (action description here)` - Transition with action and description
- `event [guard ...] / (action ...)` - Guarded transition with action (both can have descriptions)

**Ignored Mermaid features (non-FSM lines):**
- YAML frontmatter (`---\nconfig: ...\n---`)
- Comments (`%%` and `%%{...}%%` directives)
- Direction statements (`direction LR`, `direction TB`, etc.)
- Styling (`classDef`, `class`, `style`)
- State descriptions (`state "Description" as StateName`)
- Composite state braces (`state StateName {` and `}`)
- Notes (`note left of`, `note right of`, etc.)
- Final state transitions (`StateName --> [*]`)
- Any other unrecognized lines (silently ignored)

This allows you to edit diagrams visually with colors, comments, and annotations without breaking the parser.

**Throws:** Error if the diagram is invalid (missing header or initial state).

**Example:**
```typescript
import { fromMermaid, FSM } from "@marianmeres/fsm";

const config = fromMermaid<"ON" | "OFF", "toggle">(`
  stateDiagram-v2
  [*] --> OFF
  OFF --> ON: toggle
  ON --> OFF: toggle
`);
const fsm = new FSM(config);
```

---

### `toTypeScript()`

```typescript
function toTypeScript(
  mermaidDiagram: string,
  options?: { indent?: string; configName?: string }
): string
```

Generates TypeScript code from a Mermaid stateDiagram-v2 notation. This function outputs ready-to-paste TypeScript code with type definitions and TODO comments where guards and actions need to be implemented.

**Parameters:**
- `mermaidDiagram` - A Mermaid stateDiagram-v2 string
- `options.indent` - Indentation string (default: `"\t"`)
- `options.configName` - Variable name for the config (default: `"config"`)

**Returns:** TypeScript code string containing:
- Type definitions (`States`, `Transitions`, `Context`)
- FSMConfig object with TODO placeholders for guards and actions

**Example:**
```typescript
import { toTypeScript } from "@marianmeres/fsm";

const tsCode = toTypeScript(`
  stateDiagram-v2
  [*] --> IDLE
  IDLE --> LOADING: fetch
  LOADING --> SUCCESS: resolve [guard hasData]
`);

// Outputs:
// type States = "IDLE" | "LOADING" | "SUCCESS";
// type Transitions = "fetch" | "resolve";
// type Context = { /* TODO: define your context */ };
//
// const config: FSMConfig<States, Transitions, Context> = {
//   initial: "IDLE",
//   // context: () => ({ /* TODO */ }),
//   states: {
//     IDLE: {
//       on: {
//         fetch: "LOADING",
//       },
//     },
//     LOADING: {
//       on: {
//         resolve: {
//           target: "SUCCESS",
//           guard: (ctx) => true, // TODO: [guard hasData]
//         },
//       },
//     },
//     // ...
//   },
// };
```

---

## Configuration Composition

### `composeFsmConfig()`

```typescript
function composeFsmConfig<TState, TEvent, TContext>(
  fragments: (FSMConfigFragment<TState, TEvent, TContext> | false | null | undefined)[],
  options?: ComposeFsmConfigOptions
): FSMConfig<TState, TEvent, TContext>
```

Composes multiple FSM configuration fragments into a single configuration. This enables building complex FSMs from reusable building blocks.

**Type Parameters:**
- `TState extends string` - Union type of all possible state names
- `TEvent extends string` - Union type of all possible transition event names
- `TContext` - Type of the FSM context object

**Parameters:**
- `fragments` - Array of FSM config fragments. Falsy values (`false`, `null`, `undefined`) are filtered out, enabling conditional inclusion
- `options` - Optional composition options

**Returns:** A merged `FSMConfig` ready to pass to `createFsm()` or `new FSM()`.

**Throws:**
- Error if no valid fragments are provided
- Error if no `initial` state is defined in any fragment
- Error if `onConflict: "error"` and multiple fragments define conflicting values

**Example:**
```typescript
import { composeFsmConfig, createFsm, type FSMConfigFragment } from "@marianmeres/fsm";

type States = "IDLE" | "LOADING" | "ERROR";
type Events = "fetch" | "resolve" | "reject";

const core: FSMConfigFragment<States, Events, unknown> = {
  initial: "IDLE",
  states: {
    IDLE: { on: { fetch: "LOADING" } },
    LOADING: { on: { resolve: "IDLE", reject: "ERROR" } },
  },
};

const errorHandling: FSMConfigFragment<States, Events, unknown> = {
  states: {
    ERROR: { on: { fetch: "LOADING" } },
  },
};

const config = composeFsmConfig([core, errorHandling]);
const fsm = createFsm(config);
```

---

### `FSMConfigFragment<TState, TEvent, TContext>`

A partial FSM configuration fragment for composition. All fields are optional to allow building configs piece by piece.

```typescript
type FSMConfigFragment<TState, TEvent, TContext> = {
  initial?: TState;
  states?: {
    [K in TState]?: Partial<FSMStatesConfigValue<TState, TEvent, TContext>>;
  };
  context?: TContext | (() => TContext);
  debug?: boolean;
};
```

Unlike `FSMConfig`, fragments:
- Don't require `initial` (but at least one fragment must define it)
- Don't require all states to be defined
- Can partially define state configurations (e.g., only `on` transitions)

---

### `ComposeFsmConfigOptions`

Options for controlling how fragments are composed.

```typescript
type ComposeFsmConfigOptions = {
  hooks?: "replace" | "compose";
  context?: "merge" | "replace";
  onConflict?: "last-wins" | "error";
};
```

**Properties:**

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `hooks` | `"replace"` | `"replace"` | Later fragments override earlier hooks |
| | `"compose"` | | All hooks run sequentially in fragment order |
| `context` | `"merge"` | `"merge"` | Shallow-merge context from all fragments |
| | `"replace"` | | Later fragments completely override earlier context |
| `onConflict` | `"last-wins"` | `"last-wins"` | Later fragments override `initial` |
| | `"error"` | | Throw if multiple fragments define different `initial` values |

**Context Merging:**

When using `context: "merge"` (the default), context objects from all fragments are shallow-merged in order. This works with both static objects and factory functions:

```typescript
const f1 = { context: { a: 1, shared: "from-f1" } };
const f2 = { context: () => ({ b: 2, shared: "from-f2" }) };

const config = composeFsmConfig([f1, f2]);
// Resulting context: { a: 1, b: 2, shared: "from-f2" }
```

The merged context is always wrapped in a factory function to ensure proper reset behavior.

**Example with options:**
```typescript
const config = composeFsmConfig(
  [fragment1, fragment2],
  {
    hooks: "compose",      // Both fragments' onEnter/onExit run
    context: "merge",      // Merge context from all fragments (default)
    onConflict: "error"    // Throw if both define different 'initial'
  }
);
```

---

## Types

### `FSMConfig<TState, TEvent, TContext>`

Constructor configuration object.

```typescript
type FSMConfig<TState, TEvent, TContext> = {
  initial: TState;
  states: FSMStatesConfigMap<TState, TEvent, TContext>;
  context?: TContext | (() => TContext);
  debug?: boolean;
  logger?: Logger;
};
```

**Note on Context Design:** Context should be a plain data object without functions. This ensures serializability, cloneability, testability, and predictability.

---

### `FSMStatesConfigMap<TState, TEvent, TContext>`

Maps state names to their configuration objects.

```typescript
type FSMStatesConfigMap<TState, TEvent, TContext> =
  Record<TState, FSMStatesConfigValue<TState, TEvent, TContext>>;
```

---

### `FSMStatesConfigValue<TState, TEvent, TContext>`

Configuration object for a single state.

```typescript
type FSMStatesConfigValue<TState, TEvent, TContext> = {
  onEnter?: (context: TContext, payload?: FSMPayload) => void;
  on: Partial<Record<TEvent | "*", TransitionDef<TState, TContext>>>;
  onExit?: (context: TContext, payload?: FSMPayload) => void;
};
```

---

### `TransitionDef<TState, TContext>`

Transition configuration definition. Can be specified in three forms.

```typescript
type TransitionDef<TState, TContext> =
  | TState                              // Simple string target
  | TransitionObj<TState, TContext>     // Single object
  | TransitionObj<TState, TContext>[];  // Array of guarded transitions
```

---

### `TransitionObj<TState, TContext>`

Transition configuration object.

```typescript
type TransitionObj<TState, TContext> = {
  target?: TState;  // Optional: omit for internal transitions
  guard?: (context: Readonly<TContext>, payload?: FSMPayload) => boolean;
  action?: (context: TContext, payload?: FSMPayload) => void;
};
```

**Important:**
- `guard` - MUST be a pure function that only reads context and returns a boolean
- `action` - Hook for edge-specific side effects; may mutate context
- If `target` is omitted, the transition is "internal" (action runs, no state change)

---

### `PublishedState<TState>`

Published state data sent to subscribers.

```typescript
type PublishedState<TState> = {
  current: TState;
  previous: TState | null;
};
```

---

### `FSMPayload`

Arbitrary payload data passed during transitions.

```typescript
type FSMPayload = unknown;
```

---

### `Unsubscriber`

Function returned by `subscribe()` to stop receiving updates.

```typescript
type Unsubscriber = () => void;
```

---

### `Logger`

Logger interface compatible with console and `@marianmeres/clog`.

```typescript
interface Logger {
  debug: (...args: unknown[]) => string;
  log: (...args: unknown[]) => string;
  warn: (...args: unknown[]) => string;
  error: (...args: unknown[]) => string;
}
```

All methods accept variadic arguments and return a string (first argument converted to string). The FSM uses only the `debug` method for logging when `debug: true` is set.
