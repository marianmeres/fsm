/**
 * @module
 *
 * A lightweight, typed, framework-agnostic Finite State Machine library.
 *
 * This module provides a synchronous FSM implementation that acts as a pure state graph
 * description. It manages state transitions and enforces rules via guards, transition
 * actions, and lifecycle hooks (onEnter/onExit), but contains no business logic by design.
 *
 * @example Basic usage
 * ```typescript
 * import { FSM } from "@marianmeres/fsm";
 *
 * const fsm = new FSM<"IDLE" | "LOADING", "load" | "done">({
 *   initial: "IDLE",
 *   states: {
 *     IDLE: { on: { load: "LOADING" } },
 *     LOADING: { on: { done: "IDLE" } }
 *   }
 * });
 *
 * fsm.subscribe(({ current }) => console.log(current));
 * fsm.transition("load"); // → "LOADING"
 * ```
 *
 * @example Mermaid diagram support
 * ```typescript
 * import { FSM } from "@marianmeres/fsm";
 *
 * const fsm = FSM.fromMermaid(`
 *   stateDiagram-v2
 *   [*] --> IDLE
 *   IDLE --> ACTIVE: start
 *   ACTIVE --> IDLE: stop
 * `);
 * ```
 *
 * @example Configuration composition
 * ```typescript
 * import { composeFsmConfig, createFsm } from "@marianmeres/fsm";
 *
 * const config = composeFsmConfig([coreFragment, featureFragment]);
 * const fsm = createFsm(config);
 * ```
 */

export * from "./fsm.ts";
export * from "./from-mermaid.ts";
export * from "./compose-fsm-config.ts";
