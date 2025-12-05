# API Reference

## Table of Contents

- [FSM Class](#fsm-class)
  - [Constructor](#constructor)
  - [Properties](#properties)
  - [Methods](#methods)
- [Factory Function](#factory-function)
- [Static Methods](#static-methods)
- [Mermaid Parser](#mermaid-parser)
- [Types](#types)

---

## FSM Class

A lightweight, typed, framework-agnostic Finite State Machine.

```typescript
import { FSM } from "@marianmeres/fsm";
```

### Constructor

```typescript
new FSM<TState, TTransition, TContext>(config: FSMConfig<TState, TTransition, TContext>)
```

Creates a new FSM instance.

**Type Parameters:**
- `TState extends string` - Union type of all possible state names
- `TTransition extends string` - Union type of all possible transition event names
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
readonly config: FSMConfig<TState, TTransition, TContext>
```

The original configuration object passed to the constructor.

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
  event: TTransition,
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
canTransition(event: TTransition, payload?: FSMPayload): boolean
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
reset(): FSM<TState, TTransition, TContext>
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
function createFsm<TState, TTransition, TContext>(
  config: FSMConfig<TState, TTransition, TContext>
): FSM<TState, TTransition, TContext>
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
static fromMermaid<TState, TTransition, TContext>(
  mermaidDiagram: string
): FSM<TState, TTransition, TContext>
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
function fromMermaid<TState, TTransition, TContext>(
  mermaidDiagram: string
): FSMConfig<TState, TTransition, TContext>
```

Parses a Mermaid stateDiagram-v2 notation into an FSM configuration object. This function enables round-tripping between FSM configurations and Mermaid diagrams.

**Supported label formats:**
- `event` - Simple transition
- `* (any)` - Wildcard transition
- `event [guard N]`, `event [guarded]`, or `event [guard ...]` - Guarded transition
- `event / (action)` - Transition with action
- `event / (action internal)` - Internal transition (no state change)
- `event [guard ...] / (action)` - Guarded transition with action

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

## Types

### `FSMConfig<TState, TTransition, TContext>`

Constructor configuration object.

```typescript
type FSMConfig<TState, TTransition, TContext> = {
  initial: TState;
  states: FSMStatesConfigMap<TState, TTransition, TContext>;
  context?: TContext | (() => TContext);
  debug?: boolean;
  logger?: Logger;
};
```

**Note on Context Design:** Context should be a plain data object without functions. This ensures serializability, cloneability, testability, and predictability.

---

### `FSMStatesConfigMap<TState, TTransition, TContext>`

Maps state names to their configuration objects.

```typescript
type FSMStatesConfigMap<TState, TTransition, TContext> =
  Record<TState, FSMStatesConfigValue<TState, TTransition, TContext>>;
```

---

### `FSMStatesConfigValue<TState, TTransition, TContext>`

Configuration object for a single state.

```typescript
type FSMStatesConfigValue<TState, TTransition, TContext> = {
  onEnter?: (context: TContext, payload?: FSMPayload) => void;
  on: Partial<Record<TTransition | "*", TransitionDef<TState, TContext>>>;
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
