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
├── mod.ts                 # Re-exports all public API
├── fsm.ts                 # Main FSM class and types
├── from-mermaid.ts        # Mermaid diagram parser
└── compose-fsm-config.ts  # Configuration composition helper
tests/
├── fsm.test.ts                 # FSM core tests
├── from-mermaid.test.ts        # Mermaid parser tests
└── compose-fsm-config.test.ts  # Composition tests
```

## Core Concepts

### FSM Configuration Structure

```typescript
{
  initial: string,           // Required: initial state name
  context?: T | () => T,     // Optional: shared data or factory function
  debug?: boolean,           // Optional: enable debug logging (default: false)
  logger?: Logger,           // Optional: custom logger (default: console)
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
| `toTypeScript` | function | Generate TypeScript code from Mermaid diagram |
| `composeFsmConfig` | function | Compose multiple config fragments into one |
| `FSMConfig` | type | Constructor configuration type |
| `FSMStatesConfigMap` | type | States configuration map type |
| `FSMStatesConfigValue` | type | Single state configuration type |
| `TransitionDef` | type | Transition definition union type |
| `TransitionObj` | type | Transition object with target/guard/action |
| `PublishedState` | type | Subscriber callback data type |
| `FSMPayload` | type | Transition payload type (unknown) |
| `FSMConfigFragment` | type | Partial config for composition |
| `ComposeFsmConfigOptions` | type | Options for composeFsmConfig |
| `Logger` | interface | Logger interface for debug output |

### FSM Class Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `(config: FSMConfig) => FSM` | Create FSM instance |
| `state` | `get state(): TState` | Get current state (non-reactive) |
| `context` | `TContext` | Mutable context object |
| `config` | `readonly FSMConfig` | Original configuration |
| `debug` | `get debug(): boolean` | Get debug mode status |
| `logger` | `get logger(): Logger` | Get logger instance |
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
Guard expression    → [guard ...]  (e.g., [guard amount < price])
Action              → / (action)
Action with desc    → / (action ...)  (e.g., / (action save to db))
Internal action     → / (action internal)
Wildcard            → * (any)
```

### Parsing Limitations (fromMermaid)

- Guards and actions become placeholder functions (with `toJSON()` for serialization)
- `onEnter`/`onExit` hooks not preserved
- Context structure not inferred
- Type information requires explicit generics

### Code Generation (toTypeScript)

```typescript
toTypeScript(mermaidDiagram, { indent?: string, configName?: string }): string
```

Generates ready-to-paste TypeScript code with:
- Type definitions (`States`, `Transitions`, `Context`)
- FSMConfig object with TODO placeholders for guards and actions
- Useful for diagram-driven development workflow

### Ignored Mermaid Features (fromMermaid)

The parser gracefully ignores non-FSM Mermaid syntax, allowing visually annotated diagrams:

| Ignored Feature | Example |
|-----------------|---------|
| YAML frontmatter | `---\nconfig: ...\n---` |
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
- `TContext = unknown`: Context data type (default: unknown)

## Error Handling

- `transition()` throws on invalid transitions when `assert=true` (default)
- `transition()` returns current state when `assert=false`
- `fromMermaid()` throws on invalid diagram format
- Guards evaluated against cloned context (safe from mutation)

## Debug Logging

Enable debug mode to log FSM operations:

```typescript
const fsm = new FSM({
  initial: "IDLE",
  debug: true,           // Enable debug logging
  logger: customLogger,  // Optional: custom Logger implementation
  states: { ... }
});
```

### Logger Interface

```typescript
interface Logger {
  debug: (...args: unknown[]) => string;
  log: (...args: unknown[]) => string;
  warn: (...args: unknown[]) => string;
  error: (...args: unknown[]) => string;
}
```

Compatible with `console` and `@marianmeres/clog`.

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

### Configuration Composition

```typescript
import { composeFsmConfig, type FSMConfigFragment } from "@marianmeres/fsm";

// Core fragment
const core: FSMConfigFragment<States, Events, Context> = {
  initial: "IDLE",
  states: {
    IDLE: { on: { fetch: "LOADING" } },
    LOADING: { on: { resolve: "SUCCESS", reject: "ERROR" } },
  },
};

// Optional feature fragment
const retryFeature: FSMConfigFragment<States, Events, Context> = {
  states: {
    ERROR: { on: { retry: "LOADING" } },
  },
};

// Compose with conditional inclusion
const config = composeFsmConfig([
  core,
  featureEnabled && retryFeature,
]);
```

**Composition Rules:**
- Falsy values in array are filtered out (enables conditional fragments)
- `initial`: Last fragment wins (or error with `onConflict: "error"`)
- `context`: Shallow-merged by default (or replaced with `context: "replace"`)
- `states.X.on`: Shallow-merged (later transitions override earlier)
- `onEnter`/`onExit`: Replaced by default, or chained with `hooks: "compose"`
