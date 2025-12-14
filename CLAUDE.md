# CLAUDE.md - Project Context for Claude Code

## Project Overview

**@marianmeres/fsm** - A lightweight, typed, framework-agnostic finite state machine library for Deno and Node.js.

## Quick Commands

```bash
# Run all tests
deno test

# Run specific test file
deno test tests/fsm.test.ts
deno test tests/compose-fsm-config.test.ts
deno test tests/from-mermaid.test.ts

# Type check
deno check src/mod.ts

# Build for npm
deno task npm:build
```

## Project Structure

```
src/
├── mod.ts                    # Public exports (entry point)
├── fsm.ts                    # Main FSM class, types, transition logic
├── from-mermaid.ts           # Mermaid diagram parser & TypeScript generator
└── compose-fsm-config.ts     # Configuration composition helper

tests/
├── fsm.test.ts               # Core FSM tests
├── compose-fsm-config.test.ts # Composition tests
└── from-mermaid.test.ts      # Mermaid parser tests
```

## Key Concepts

### FSM Configuration

```typescript
{
  initial: string,              // Required: initial state
  context?: T | () => T,        // Optional: shared data or factory
  debug?: boolean,              // Enable logging
  states: {
    [stateName]: {
      onEnter?: (ctx, payload) => void,
      onExit?: (ctx, payload) => void,
      on: {
        [event | "*"]: TransitionDef
      }
    }
  }
}
```

### TransitionDef Forms

1. **String**: `"TARGET_STATE"`
2. **Object**: `{ target?, guard?, action? }`
3. **Array**: `[{ target, guard?, action? }, ...]` (evaluated in order)

### Transition Lifecycle

- **External** (has target): `onExit` → `action` → state change → `onEnter` → notify
- **Internal** (no target): `action` → notify (no state change)

## composeFsmConfig Options

```typescript
composeFsmConfig([...fragments], {
  hooks: "replace" | "compose",           // default: "replace"
  context: "merge" | "replace",           // default: "merge"
  onConflict: "last-wins" | "error",      // default: "last-wins"
  transitions: "replace" | "prepend" | "append"  // default: "replace"
});
```

### Transition Merge Modes

- `"replace"`: Later fragments override earlier handlers (default)
- `"prepend"`: Later fragments' transitions run first (interceptor pattern)
- `"append"`: Later fragments' transitions run last (fallback pattern)

## Code Conventions

- **States**: UPPERCASE nouns (`IDLE`, `LOADING`, `ERROR`)
- **Events**: lowercase verbs (`fetch`, `resolve`, `retry`)
- **Guards**: Pure functions, read-only context
- **Actions**: May mutate context
- **Context**: Data only, no functions (for cloneability/serializability)

## Type Parameters

```typescript
FSM<TState extends string, TEvent extends string, TContext>
```

## Documentation Files

- `README.md` - User-facing documentation with examples
- `API.md` - Complete API reference
- `AGENTS.md` - Machine-readable documentation for AI agents

## Testing Patterns

```typescript
// Basic transition
assertEquals(fsm.transition("event"), "EXPECTED_STATE");

// Guard evaluation
assertEquals(fsm.canTransition("event"), true/false);

// Subscription
const log = [];
fsm.subscribe(data => log.push(data));
```

## Dependencies

- `@marianmeres/pubsub` - Internal pub/sub for subscriptions
- `@std/assert` - Test assertions (dev only)
