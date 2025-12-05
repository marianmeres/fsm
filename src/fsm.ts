import { createPubSub, type Unsubscriber } from "@marianmeres/pubsub";
import { fromMermaid as fromMermaidParser } from "./from-mermaid.ts";

/**
 * Logger interface compatible with console and @marianmeres/clog.
 * All methods accept variadic arguments and return a string.
 */
export interface Logger {
	debug: (...args: unknown[]) => string;
	log: (...args: unknown[]) => string;
	warn: (...args: unknown[]) => string;
	error: (...args: unknown[]) => string;
}

/**
 * Default console-based logger that wraps console methods.
 * Returns the first argument as a string (or empty string if no args).
 */
const defaultLogger: Logger = {
	debug: (...args: unknown[]) => {
		console.debug(...args);
		return String(args[0] ?? "");
	},
	log: (...args: unknown[]) => {
		console.log(...args);
		return String(args[0] ?? "");
	},
	warn: (...args: unknown[]) => {
		console.warn(...args);
		return String(args[0] ?? "");
	},
	error: (...args: unknown[]) => {
		console.error(...args);
		return String(args[0] ?? "");
	},
};

/**
 * Arbitrary payload data passed during transitions.
 * This can be any value and is forwarded to guards, actions, onEnter, and onExit hooks.
 */
export type FSMPayload = unknown;

/**
 * Configuration object for a single state.
 * Defines the available transitions from this state and optional lifecycle hooks.
 *
 * @template TState - Union type of all possible state names
 * @template TTransition - Union type of all possible transition event names
 * @template TContext - Type of the FSM context object
 */
export type FSMStatesConfigValue<
	TState extends string,
	TTransition extends string,
	TContext
> = {
	onEnter?: (context: TContext, payload?: FSMPayload) => void;
	on: Partial<Record<TTransition | "*", TransitionDef<TState, TContext>>>;
	onExit?: (context: TContext, payload?: FSMPayload) => void;
};

/**
 * Maps state names to their configuration objects.
 *
 * @template TState - Union type of all possible state names
 * @template TTransition - Union type of all possible transition event names
 * @template TContext - Type of the FSM context object
 */
export type FSMStatesConfigMap<
	TState extends string,
	TTransition extends string,
	TContext
> = Record<TState, FSMStatesConfigValue<TState, TTransition, TContext>>;

/**
 * Constructor configuration
 *
 * Note on Context Design:
 * Context should be a plain data object without functions. This ensures:
 * - Serializability (localStorage, network, debugging)
 * - Cloneability (safe canTransition queries)
 * - Testability (easy assertions and snapshots)
 * - Predictability (pure data transformations)
 *
 * Define helper functions outside the FSM and pass context as parameters.
 */
export type FSMConfig<
	TState extends string,
	TTransition extends string,
	TContext
> = {
	initial: TState;
	states: FSMStatesConfigMap<TState, TTransition, TContext>;
	// accepts a value OR a factory function for true resets
	context?: TContext | (() => TContext);
	/** Enable debug logging (default: false) */
	debug?: boolean;
	/** Custom logger implementing Logger interface (default: console) */
	logger?: Logger;
};

/**
 * Transition configuration object
 *
 * IMPORTANT - Context Design Philosophy:
 * The context parameter should be treated as READ-ONLY in guard functions and should
 * contain ONLY data (no functions). This ensures:
 * - Guards remain pure predicate functions
 * - Context can be safely cloned (e.g., for canTransition safety)
 * - State is serializable for debugging, persistence, and time-travel
 * - Behavior is predictable and testable
 *
 * Good practice:
 *   guard: (ctx) => ctx.attempts < ctx.maxRetries  // ✅ Read-only check
 *
 * Bad practice:
 *   guard: (ctx) => { ctx.attempts++; return true }  // ❌ Mutating in guard
 *   context: { count: 0, increment: () => {} }       // ❌ Functions in context
 *
 * For mutations, use action hooks (action, onEnter, onExit) which are designed
 * for side effects. For helper functions, define them outside the FSM and pass
 * context as parameters.
 */
export type TransitionObj<TState, TContext> = {
	// target is optional... if undefined, the transition will be considered as "internal"
	// and in such case only the action will re-run
	target?: TState;
	/**
	 * Guard function to conditionally allow a transition.
	 * MUST be a pure function that only reads context and returns a boolean.
	 * Do NOT mutate context in guards - use action/onEnter/onExit for mutations.
	 * Context should contain only data (no functions) to ensure it's cloneable.
	 */
	guard?: (context: Readonly<TContext>, payload?: FSMPayload) => boolean;
	// action hook for edge-specific side effects
	action?: (context: TContext, payload?: FSMPayload) => void;
};

/**
 * Transition configuration definition.
 * Can be specified in three forms:
 * - Simple string: target state name (e.g., `"IDLE"`)
 * - Single object: `{ target, guard?, action? }`
 * - Array of objects: multiple guarded transitions evaluated in order
 *
 * @template TState - Union type of all possible state names
 * @template TContext - Type of the FSM context object
 */
export type TransitionDef<TState, TContext> =
	| TState
	| TransitionObj<TState, TContext>
	| TransitionObj<TState, TContext>[];

/**
 * Published state data sent to subscribers.
 * Contains the current state, previous state (null if initial), and context.
 *
 * @template TState - Union type of all possible state names
 */
export type PublishedState<TState> = {
	current: TState;
	previous: TState | null;
};

/**
 * Factory function to create an FSM instance.
 * Equivalent to calling `new FSM(config)`.
 *
 * @template TState - Union type of all possible state names
 * @template TTransition - Union type of all possible transition event names
 * @template TContext - Type of the FSM context object
 * @param config - The FSM configuration object
 * @returns A new FSM instance
 *
 * @example
 * ```typescript
 * const fsm = createFsm<"ON" | "OFF", "toggle">({
 *   initial: "OFF",
 *   states: {
 *     ON: { on: { toggle: "OFF" } },
 *     OFF: { on: { toggle: "ON" } }
 *   }
 * });
 * ```
 */
export function createFsm<
	TState extends string,
	TTransition extends string,
	TContext = unknown
>(
	config: FSMConfig<TState, TTransition, TContext>
): FSM<TState, TTransition, TContext> {
	return new FSM<TState, TTransition, TContext>(config);
}

/**
 * A lightweight, typed, framework-agnostic Finite State Machine.
 *
 * This FSM implementation is synchronous and acts as a pure state graph description.
 * It manages state transitions and enforces rules via guards, transition actions,
 * and lifecycle hooks (onEnter/onExit), but contains no business logic by design.
 *
 * @template TState - Union type of all possible state names
 * @template TTransition - Union type of all possible transition event names
 * @template TContext - Type of the FSM context object (should contain only data, no functions)
 *
 * @example
 * ```typescript
 * const fsm = new FSM<"IDLE" | "LOADING", "load" | "done">({
 *   initial: "IDLE",
 *   context: { count: 0 },
 *   states: {
 *     IDLE: { on: { load: "LOADING" } },
 *     LOADING: { on: { done: "IDLE" } }
 *   }
 * });
 *
 * fsm.subscribe(({ current, context }) => console.log(current, context));
 * fsm.transition("load"); // → "LOADING"
 * ```
 */
export class FSM<
	TState extends string,
	TTransition extends string,
	TContext = unknown
> {
	/** FSM's previous state */
	#previous: TState | null = null;

	/** FSM's current state */
	#state: TState;

	/**
	 * A custom data object accessible throughout the FSM's lifetime.
	 * Context should contain only data (no functions) to ensure serializability and cloneability.
	 * Mutate context in action hooks (action, onEnter, onExit), not in guards.
	 */
	context: TContext;

	/** Internal pub sub */
	#pubsub = createPubSub();

	/** Logger instance */
	#logger: Logger;

	/** Debug mode flag */
	#debug: boolean;

	/**
	 * Creates a new FSM instance.
	 * @param config - The FSM configuration containing initial state, states definition, and optional context
	 */
	constructor(
		public readonly config: FSMConfig<TState, TTransition, TContext>
	) {
		this.#debug = config.debug ?? false;
		this.#logger = config.logger ?? defaultLogger;
		this.#state = this.config.initial;
		this.context = this.#initContext();
		this.#log(`FSM created with initial state "${this.#state}"`);
	}

	/** Log debug message if debug mode is enabled */
	#log(...args: unknown[]): void {
		if (this.#debug) {
			this.#logger.debug("[FSM]", ...args);
		}
	}

	/**
	 * Returns the current state of the FSM.
	 * This is a non-reactive getter; use `subscribe()` for reactive updates.
	 * @returns The current state name
	 */
	get state(): TState {
		return this.#state;
	}

	/** Helper to initialize context from object or factory function */
	#initContext(): TContext {
		if (typeof this.config.context === "function") {
			return (this.config.context as () => TContext)();
		}
		// fallback to shallow copy if a static object is passed
		return { ...(this.config.context ?? ({} as TContext)) };
	}

	#getNotifyData() {
		return {
			current: this.#state,
			previous: this.#previous,
			context: this.context,
		};
	}

	#notify() {
		this.#pubsub.publish("change", this.#getNotifyData());
	}

	/**
	 * Subscribes to FSM state changes.
	 * The callback is invoked immediately with the current state and on every subsequent state change.
	 *
	 * @param cb - Callback function receiving current state, previous state, and context
	 * @returns Unsubscriber function to stop receiving updates
	 *
	 * @example
	 * ```typescript
	 * const unsub = fsm.subscribe(({ current, previous, context }) => {
	 *   console.log(`State changed from ${previous} to ${current}`);
	 * });
	 * // Later: unsub() to stop listening
	 * ```
	 */
	subscribe(
		cb: (data: PublishedState<TState> & { context: TContext }) => void
	): Unsubscriber {
		this.#log("subscribe() called");
		const unsub = this.#pubsub.subscribe("change", cb);
		cb(this.#getNotifyData());
		return unsub;
	}

	/**
	 * Requests the FSM to transition based on the given event.
	 *
	 * Execution order during external transitions:
	 * 1. `onExit` hook of the current state
	 * 2. `action` of the transition edge
	 * 3. State changes (previous/current updated)
	 * 4. `onEnter` hook of the new state
	 * 5. Subscribers notified
	 *
	 * For internal transitions (no target defined), only the action runs and subscribers are notified.
	 *
	 * @param event - The transition event name
	 * @param payload - Optional data passed to guards, actions, and lifecycle hooks
	 * @param assert - If true (default), throws on invalid transitions; if false, returns current state
	 * @returns The new state after transition, or current state if transition failed in non-assert mode
	 * @throws Error if the transition is invalid and assert is true
	 *
	 * @example
	 * ```typescript
	 * fsm.transition("fetch");           // Basic transition
	 * fsm.transition("resolve", data);   // With payload
	 * fsm.transition("invalid", null, false); // Non-throwing mode
	 * ```
	 */
	transition(
		event: TTransition,
		payload?: FSMPayload,
		assert = true
	): TState | null {
		this.#log(`transition("${event}") called from state "${this.#state}"`);
		const currentStateConfig = this.config.states[this.#state];

		if (!currentStateConfig || !currentStateConfig.on) {
			throw new Error(`No transitions defined for state "${this.#state}"`);
		}

		// Try the specific event first, then fall back to wildcard "*"
		let transitionDef = currentStateConfig.on[event];
		let usedWildcard = false;

		if (!transitionDef) {
			// Try wildcard transition as fallback
			transitionDef = currentStateConfig.on["*" as TTransition];
			usedWildcard = !!transitionDef;

			if (!transitionDef) {
				this.#log(`transition("${event}") failed: no matching transition`);
				if (assert) {
					// prettier-ignore
					throw new Error(`Invalid transition "${event}" from state "${this.#state}"`);
				} else {
					// just return current if non-assert mode
					return this.#state;
				}
			}
		}

		if (usedWildcard) {
			this.#log(`transition("${event}") using wildcard "*"`);
		}

		// returns the full normalized transition object
		const activeTransition = this.#resolveTransition(transitionDef, payload);

		if (!activeTransition) {
			this.#log(`transition("${event}") failed: guard rejected`);
			if (assert) {
				// prettier-ignore
				throw new Error(`No valid transition found for event "${event}" in state "${this.#state}"`);
			} else {
				// just return current if non-assert mode
				return this.#state;
			}
		}

		// INTERNAL TRANSITION
		// if there is no target, we stay in the same state and ONLY run the action.
		if (!activeTransition.target) {
			this.#log(`transition("${event}") internal (no state change)`);
			if (typeof activeTransition.action === "function") {
				this.#log(`transition("${event}") executing action`);
				activeTransition.action(this.context, payload);
			}
			// here we do NOT fire onExit, onEnter, or update this.#previous, BUT we
			// notify consumers, since actions may change context
			this.#notify();
			return this.#state;
		}

		const nextState = activeTransition.target;
		this.#log(`transition("${event}"): "${this.#state}" -> "${nextState}"`);

		// 1. exit current state side-effect
		if (typeof currentStateConfig.onExit === "function") {
			this.#log(`transition("${event}") executing onExit for "${this.#state}"`);
			currentStateConfig.onExit(this.context, payload);
		}

		// 2. execute transition action (if defined)
		if (typeof activeTransition.action === "function") {
			this.#log(`transition("${event}") executing action`);
			activeTransition.action(this.context, payload);
		}

		// 3. save previous and set new state
		this.#previous = this.#state;
		this.#state = nextState;

		// 4. enter new state side-effect
		const nextStateConfig = this.config.states[nextState];
		if (typeof nextStateConfig.onEnter === "function") {
			this.#log(`transition("${event}") executing onEnter for "${nextState}"`);
			nextStateConfig.onEnter(this.context, payload);
		}

		// 5. notify listeners
		this.#notify();

		// return current
		return this.#state;
	}

	/**
	 * Resolves the transition definition into a normalized object.
	 * Guards are evaluated against a cloned context to ensure they cannot mutate state.
	 */
	#resolveTransition(
		transition: TransitionDef<TState, TContext>,
		payload?: FSMPayload
	): TransitionObj<TState, TContext> | null {
		// simple string transition -> normalize to object
		if (typeof transition === "string") {
			return { target: transition };
		}

		// Clone context for guard evaluation to enforce purity
		// Guards should never mutate context - mutations belong in actions/hooks
		const clonedContext = structuredClone(this.context);

		// array of guarded transitions
		if (Array.isArray(transition)) {
			for (const t of transition) {
				if (typeof t.guard === "function") {
					if (t.guard(clonedContext, payload)) return t;
				} else {
					// If no guard is present in an array item, it's an unconditional match
					return t;
				}
			}
			return null;
		}

		// single guarded transition object
		if (typeof transition.guard === "function") {
			return transition.guard(clonedContext, payload) ? transition : null;
		}

		// single object without guard
		return transition;
	}

	/**
	 * Resets the FSM to its initial state and re-initializes the context.
	 * If context was defined as a factory function, a fresh context is created.
	 * Subscribers are notified after reset.
	 *
	 * @returns The FSM instance for chaining
	 *
	 * @example
	 * ```typescript
	 * fsm.reset().is("IDLE"); // true
	 * ```
	 */
	reset(): FSM<TState, TTransition, TContext> {
		this.#log(`reset() called, returning to "${this.config.initial}"`);
		this.#state = this.config.initial;
		this.#previous = null;
		this.context = this.#initContext();
		this.#notify();
		return this;
	}

	/**
	 * Checks whether the FSM is currently in the given state.
	 *
	 * @param state - The state to check against
	 * @returns True if the FSM is in the specified state
	 *
	 * @example
	 * ```typescript
	 * if (fsm.is("LOADING")) {
	 *   showSpinner();
	 * }
	 * ```
	 */
	is(state: TState): boolean {
		return this.#state === state;
	}

	/**
	 * Check whether a transition is valid from the current state.
	 * Returns true if the transition can be executed, false otherwise.
	 * Respects guards and transition definitions.
	 *
	 * This is a pure query operation that does not modify FSM state.
	 */
	canTransition(event: TTransition, payload?: FSMPayload): boolean {
		this.#log(`canTransition("${event}") called from state "${this.#state}"`);
		const currentStateConfig = this.config.states[this.#state];

		if (!currentStateConfig || !currentStateConfig.on) {
			this.#log(`canTransition("${event}") -> false (no transitions defined)`);
			return false;
		}

		// Try the specific event first, then fall back to wildcard "*"
		let transitionDef = currentStateConfig.on[event];

		if (!transitionDef) {
			// Try wildcard transition as fallback
			transitionDef = currentStateConfig.on["*" as TTransition];

			if (!transitionDef) {
				this.#log(`canTransition("${event}") -> false (no matching transition)`);
				return false;
			}
		}

		// Check if transition resolves to a valid target
		const activeTransition = this.#resolveTransition(transitionDef, payload);
		const result = activeTransition !== null;
		this.#log(`canTransition("${event}") -> ${result}`);

		return result;
	}

	/**
	 * Creates an FSM instance from a Mermaid stateDiagram-v2 notation.
	 * This is a static factory method that wraps the standalone fromMermaid parser.
	 *
	 * Limitations:
	 * - Cannot recreate actual guard/action functions (sets them to null as placeholders)
	 * - Cannot recreate onEnter/onExit hooks (not represented in mermaid)
	 * - Cannot infer context structure
	 *
	 * Primarily useful for documentation/visualization roundtripping.
	 */
	static fromMermaid<
		TState extends string = string,
		TTransition extends string = string,
		TContext = unknown
	>(mermaidDiagram: string): FSM<TState, TTransition, TContext> {
		const config = fromMermaidParser<TState, TTransition, TContext>(
			mermaidDiagram
		);
		return new FSM<TState, TTransition, TContext>(config);
	}

	/**
	 * Generates a Mermaid stateDiagram-v2 notation from the FSM configuration.
	 * Useful for visualizing the state machine graph.
	 *
	 * The output follows UML conventions:
	 * - Guards are shown as `[guard N]` or `[guarded]`
	 * - Actions are shown as `/ (action)` or `/ (action internal)` for internal transitions
	 * - Wildcards are shown as `* (any)`
	 *
	 * @returns Mermaid diagram string
	 *
	 * @example
	 * ```typescript
	 * console.log(fsm.toMermaid());
	 * // stateDiagram-v2
	 * //     [*] --> IDLE
	 * //     IDLE --> LOADING: load
	 * //     LOADING --> SUCCESS: resolve
	 * ```
	 */
	toMermaid(): string {
		let mermaid = "stateDiagram-v2\n";
		mermaid += `    [*] --> ${this.config.initial}\n`;

		for (const [stateName, stateConfig] of Object.entries(this.config.states)) {
			// @ts-expect-error - Object.entries loses type info, but we know the structure
			for (const [event, _def] of Object.entries(stateConfig?.on ?? {})) {
				const def = _def as TransitionDef<TState, TContext>;
				// Helper to format the label: "Event [Guard] / Action"
				const formatLabel = (
					evt: string,
					guardIdx: number | null,
					hasAction: boolean,
					isInternal: boolean
				) => {
					// Make wildcard more descriptive in the diagram
					let label = evt === "*" ? "* (any)" : evt;
					if (guardIdx !== null) label += ` [guard ${guardIdx}]`;
					else if (guardIdx === -1) label += ` [guarded]`;

					// UML convention: Event [Guard] / Action
					if (hasAction) {
						if (isInternal) {
							// mark internal transitions explicitly
							label += ` / (action internal)`;
						} else {
							label += ` / (action)`;
						}
					}

					return label;
				};

				if (typeof def === "string") {
					// simple string: "TARGET"
					const label = event === "*" ? "* (any)" : event;
					mermaid += `    ${stateName} --> ${def}: ${label}\n`;
				} else if (Array.isArray(def)) {
					// array of objects
					def.forEach((t, idx) => {
						const target = t.target ?? stateName;
						const label = formatLabel(event, idx + 1, !!t.action, !t.target);
						mermaid += `    ${stateName} --> ${target}: ${label}\n`;
					});
				} else {
					// single object
					const target = def.target ?? stateName;
					const label = formatLabel(
						event,
						def.guard ? -1 : null,
						!!def.action,
						!def.target
					);
					mermaid += `    ${stateName} --> ${target}: ${label}\n`;
				}
			}
		}

		return mermaid;
	}
}
