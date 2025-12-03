# AGENTS.md - Machine-Readable Package Documentation

## Package Overview

- **Name**: `@marianmeres/fsm`
- **Type**: Finite State Machine library
- **Runtime**: Deno and Node.js (via npm build)
- **Language**: TypeScript
- **Paradigm**: Synchronous, reactive, type-safe
- **Entry Point**: `src/mod.ts`

## Architecture

```
src/
├── mod.ts           # Re-exports all public API
├── fsm.ts           # Main FSM class and types
└── from-mermaid.ts  # Mermaid diagram parser
tests/
├── fsm.test.ts           # FSM core tests
└── from-mermaid.test.ts  # Mermaid parser tests
```

## Core Concepts

### FSM Configuration Structure

```typescript
{
  initial: string,           // Required: initial state name
  context?: T | () => T,     // Optional: shared data or factory function
  states: {
    [stateName: string]: {
      onEnter?: (ctx, payload) => void,   // Lifecycle: entering state
      onExit?: (ctx, payload) => void,    // Lifecycle: exiting state
      on: {
        [eventName | "*"]: TransitionDef  // Transitions or wildcard
      }
    }
  }
}
```

### Transition Definition Forms

1. **Simple string**: `"TARGET_STATE"`
2. **Object**: `{ target?, guard?, action? }`
3. **Array**: `[ { target, guard?, action? }, ... ]` (evaluated in order)

### Internal vs External Transitions

- **External**: Has `target` property → triggers `onExit` → `action` → `onEnter`
- **Internal**: No `target` property → triggers only `action`, no state change

### Wildcard Transitions

- Use `"*"` as event name for fallback handling
- Specific transitions take priority over wildcards
- In Mermaid output, rendered as `* (any)`

## Public API

### Exports from `mod.ts`

| Export | Type | Description |
|--------|------|-------------|
| `FSM` | class | Main finite state machine class |
| `createFsm` | function | Factory function (alias for `new FSM()`) |
| `fromMermaid` | function | Parse Mermaid diagram to FSM config |
| `FSMConfig` | type | Constructor configuration type |
| `FSMStatesConfigMap` | type | States configuration map type |
| `FSMStatesConfigValue` | type | Single state configuration type |
| `TransitionDef` | type | Transition definition union type |
| `TransitionObj` | type | Transition object with target/guard/action |
| `PublishedState` | type | Subscriber callback data type |
| `FSMPayload` | type | Transition payload type (any) |

### FSM Class Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `(config: FSMConfig) => FSM` | Create FSM instance |
| `state` | `get state(): TState` | Get current state (non-reactive) |
| `context` | `TContext` | Mutable context object |
| `config` | `readonly FSMConfig` | Original configuration |
| `subscribe` | `(cb) => Unsubscriber` | Subscribe to state changes |
| `transition` | `(event, payload?, assert?) => TState \| null` | Execute transition |
| `canTransition` | `(event, payload?) => boolean` | Check if transition is valid |
| `is` | `(state) => boolean` | Check current state |
| `reset` | `() => FSM` | Reset to initial state |
| `toMermaid` | `() => string` | Generate Mermaid diagram |
| `fromMermaid` | `static (diagram) => FSM` | Parse Mermaid to FSM |

## Transition Lifecycle

```
EXTERNAL TRANSITION:
  1. onExit(currentState)
  2. action(transition)
  3. state = newState
  4. onEnter(newState)
  5. notify subscribers

INTERNAL TRANSITION (no target):
  1. action(transition)
  2. notify subscribers
```

## Context Best Practices

- **Data only**: No functions in context (ensures cloneability/serializability)
- **Pure guards**: Guards must only read context, never mutate
- **Action mutations**: Use `action`, `onEnter`, `onExit` for context mutations
- **Factory function**: Use `context: () => ({...})` for proper reset behavior

## Mermaid Roundtrip

### Serialization (toMermaid)

```
Guard with index    → [guard N]
Guard without index → [guarded]
Action              → / (action)
Internal action     → / (action internal)
Wildcard            → * (any)
```

### Parsing Limitations (fromMermaid)

- Guards and actions become `null` placeholders
- `onEnter`/`onExit` hooks not preserved
- Context structure not inferred
- Type information requires explicit generics

### Ignored Mermaid Features (fromMermaid)

The parser gracefully ignores non-FSM Mermaid syntax, allowing visually annotated diagrams:

| Ignored Feature | Example |
|-----------------|---------|
| Comments | `%% comment` or `%%{ directive }%%` |
| Direction | `direction LR`, `direction TB` |
| Styling | `classDef`, `class`, `style` |
| State descriptions | `state "Label" as STATE` |
| Composite braces | `state NAME {` and `}` |
| Notes | `note left of STATE: text` |
| Final state | `STATE --> [*]` |
| Unknown lines | Any unrecognized syntax |

Note: Transitions inside composite state blocks ARE parsed as regular transitions.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@marianmeres/pubsub` | Internal pub/sub for reactive subscriptions |
| `@std/assert` | Test assertions (dev) |

## Build System

- **Runtime**: Deno
- **Test**: `deno test` / `deno task test`
- **NPM Build**: `deno task npm:build` (uses `@marianmeres/npmbuild`)
- **Publish NPM**: `deno task npm:publish`

## Type Parameters Convention

```typescript
FSM<TState, TTransition, TContext>
```

- `TState extends string`: Union of state names (e.g., `"IDLE" | "LOADING"`)
- `TTransition extends string`: Union of event names (e.g., `"load" | "done"`)
- `TContext = any`: Context data type (default: any)

## Error Handling

- `transition()` throws on invalid transitions when `assert=true` (default)
- `transition()` returns current state when `assert=false`
- `fromMermaid()` throws on invalid diagram format
- Guards evaluated against cloned context (safe from mutation)

## Testing Patterns

```typescript
// Basic transition test
assertEquals(fsm.transition("event"), "EXPECTED_STATE");

// Guard evaluation test
fsm.context.value = testValue;
assertEquals(fsm.canTransition("event"), expected);

// Subscription test
const log = [];
fsm.subscribe(data => log.push(data));
fsm.transition("event");
assertEquals(log.length, 2); // Initial + transition

// Reset test
fsm.reset();
assertEquals(fsm.is("INITIAL_STATE"), true);
```

## Common Patterns

### Retry with Max Attempts

```typescript
{
  FETCHING: {
    onEnter: ctx => ctx.attempts++,
    on: {
      reject: [
        { target: "RETRYING", guard: ctx => ctx.attempts < ctx.max },
        { target: "FAILED", guard: ctx => ctx.attempts >= ctx.max }
      ]
    }
  }
}
```

### Volume Control (Internal Transition)

```typescript
{
  PLAYING: {
    on: {
      volumeUp: { action: ctx => ctx.volume++ }  // No target = internal
    }
  }
}
```

### Error Fallback (Wildcard)

```typescript
{
  ACTIVE: {
    on: {
      stop: "IDLE",
      "*": "ERROR"  // Catch all other events
    }
  }
}
```
