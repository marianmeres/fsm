import { createPubSub, type Unsubscriber } from "@marianmeres/pubsub";
import { createClog, withNamespace, type Logger } from "@marianmeres/clog";
import { fromMermaid as fromMermaidParser } from "./from-mermaid.ts";

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
 * @template TEvent - Union type of all possible transition event names
 * @template TContext - Type of the FSM context object
 */
export type FSMStatesConfigValue<
	TState extends string,
	TEvent extends string,
	TContext
> = {
	onEnter?: (context: TContext, payload?: FSMPayload) => void;
	on: Partial<Record<TEvent | "*", TransitionDef<TState, TContext>>>;
	onExit?: (context: TContext, payload?: FSMPayload) => void;
};

/**
 * Maps state names to their configuration objects.
 *
 * @template TState - Union type of all possible state names
 * @template TEvent - Union type of all possible transition event names
 * @template TContext - Type of the FSM context object
 */
export type FSMStatesConfigMap<
	TState extends string,
	TEvent extends string,
	TContext
> = Record<TState, FSMStatesConfigValue<TState, TEvent, TContext>>;

/**
 * Constructor configuration.
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
	TEvent extends string,
	TContext
> = {
	initial: TState;
	states: FSMStatesConfigMap<TState, TEvent, TContext>;
	// accepts a value OR a factory function for true resets
	context?: TContext | (() => TContext);
	/** Custom logger implementing Logger interface (default: console) */
	logger?: Logger;
};

/**
 * Transition configuration object.
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
 *   guard: (ctx) => ctx.attempts < ctx.maxRetries  // read-only check
 *
 * Bad practice:
 *   guard: (ctx) => { ctx.attempts++; return true }  // mutating in guard
 *   context: { count: 0, increment: () => {} }       // functions in context
 *
 * For mutations, use action hooks (action, onEnter, onExit) which are designed
 * for side effects.
 */
export type TransitionObj<TState, TContext> = {
	// target is optional... if undefined, the transition is "internal"
	// and only the action will run (no onExit/onEnter, no state change)
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
 * Contains the current state, previous state (null if initial), and live context reference.
 *
 * @template TState - Union type of all possible state names
 * @template TContext - Type of the FSM context object
 */
export type PublishedState<TState, TContext = unknown> = {
	current: TState;
	previous: TState | null;
	context: TContext;
};

/**
 * Snapshot of FSM state, suitable for testing, persistence, or time-travel.
 *
 * @template TState - Union type of all possible state names
 * @template TContext - Type of the FSM context object
 */
export type FSMSnapshot<TState, TContext> = {
	state: TState;
	previous: TState | null;
	context: TContext;
};

/**
 * Factory function to create an FSM instance.
 * Equivalent to calling `new FSM(config)`.
 *
 * @template TState - Union type of all possible state names
 * @template TEvent - Union type of all possible transition event names
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
	TEvent extends string,
	TContext = unknown
>(config: FSMConfig<TState, TEvent, TContext>): FSM<TState, TEvent, TContext> {
	return new FSM<TState, TEvent, TContext>(config);
}

/** Recursively freezes plain objects/arrays. Skips functions to avoid surprising side effects. */
function deepFreeze<T>(obj: T): T {
	if (obj === null || typeof obj !== "object") return obj;
	if (Object.isFrozen(obj)) return obj;
	Object.freeze(obj);
	for (const key of Object.keys(obj as object)) {
		const value = (obj as Record<string, unknown>)[key];
		if (value !== null && typeof value === "object") {
			deepFreeze(value);
		}
	}
	return obj;
}

/** Collects target states referenced by a transition definition. */
function collectTargets<TState extends string, TContext>(
	def: TransitionDef<TState, TContext>
): TState[] {
	if (typeof def === "string") return [def];
	if (Array.isArray(def)) {
		return def.flatMap((t) =>
			t.target !== undefined ? [t.target] : []
		);
	}
	const obj = def as TransitionObj<TState, TContext>;
	return obj.target !== undefined ? [obj.target] : [];
}

/**
 * A lightweight, typed, framework-agnostic Finite State Machine.
 *
 * This FSM implementation is synchronous and acts as a pure state graph description.
 * It manages state transitions and enforces rules via guards, transition actions,
 * and lifecycle hooks (onEnter/onExit), but contains no business logic by design.
 *
 * **Transition types:**
 * - **External transitions** (with target): Execute full lifecycle (onExit → action → state change → onEnter → notify)
 * - **Internal transitions** (no target): Execute only action → notify, without onExit/onEnter
 * - **Self-loop transitions** (target === current): Execute full lifecycle; useful for retry/refresh patterns
 *
 * **Note on self-loops:** When transitioning to the same state, onExit and onEnter still fire.
 * Be cautious when calling `transition()` from within subscribers to avoid infinite loops.
 * Use `if (current !== previous)` checks when needed. See `subscribe()` docs for details.
 *
 * @template TState - Union type of all possible state names
 * @template TEvent - Union type of all possible transition event names
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
	TEvent extends string,
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

	/**
	 * Creates a new FSM instance.
	 *
	 * The configuration is validated at construction time:
	 * - `initial` must reference a state defined in `states`
	 * - All transition targets must reference states defined in `states`
	 *
	 * The configuration object is deep-frozen after construction to prevent accidental
	 * mutation. User-supplied functions are not frozen.
	 *
	 * @param config - The FSM configuration containing initial state, states definition, and optional context
	 * @throws Error if the configuration is invalid
	 */
	constructor(public readonly config: FSMConfig<TState, TEvent, TContext>) {
		this.#logger = withNamespace(config.logger ?? createClog(), "FSM");
		this.#validateConfig(config);
		this.#state = this.config.initial;
		this.context = this.#initContext();
		// freeze last so validation errors carry the original message untouched
		deepFreeze(this.config);
		this.#logger.debug(`FSM created with initial state "${this.#state}"`);
	}

	/**
	 * Returns the logger instance used by this FSM.
	 * @returns The Logger instance (default: console)
	 */
	get logger(): Logger {
		return this.#logger;
	}

	/**
	 * Returns the current state of the FSM.
	 * This is a non-reactive getter; use `subscribe()` for reactive updates.
	 * @returns The current state name
	 */
	get state(): TState {
		return this.#state;
	}

	/**
	 * Returns the previous state of the FSM, or `null` if no transition has occurred yet.
	 * @returns The previous state name, or `null`
	 */
	get previous(): TState | null {
		return this.#previous;
	}

	#validateConfig(config: FSMConfig<TState, TEvent, TContext>) {
		if (!config || typeof config !== "object") {
			throw new Error("FSM: config must be an object");
		}
		if (typeof config.initial !== "string") {
			throw new Error("FSM: config.initial must be a string");
		}
		if (!config.states || typeof config.states !== "object") {
			throw new Error("FSM: config.states must be an object");
		}
		if (!(config.initial in config.states)) {
			throw new Error(
				`FSM: initial state "${config.initial}" is not defined in states`
			);
		}
		for (const [stateName, stateConfig] of Object.entries(config.states)) {
			if (!stateConfig || typeof stateConfig !== "object") {
				throw new Error(`FSM: state "${stateName}" must be an object`);
			}
			const sc = stateConfig as FSMStatesConfigValue<TState, TEvent, TContext>;
			if (!sc.on || typeof sc.on !== "object") {
				throw new Error(`FSM: state "${stateName}" is missing "on" map`);
			}
			for (const [event, def] of Object.entries(sc.on)) {
				if (def === undefined) continue;
				const targets = collectTargets(
					def as TransitionDef<TState, TContext>
				);
				for (const target of targets) {
					if (!(target in config.states)) {
						throw new Error(
							`FSM: transition "${event}" in state "${stateName}" targets unknown state "${target}"`
						);
					}
				}
			}
		}
	}

	/** Helper to initialize context from object or factory function. */
	#initContext(): TContext {
		if (typeof this.config.context === "function") {
			return (this.config.context as () => TContext)();
		}
		if (this.config.context === undefined) return {} as TContext;
		// Deep-clone plain object context so mutations on this.context never leak
		// back to config.context, and reset() truly produces a fresh tree.
		return structuredClone(this.config.context);
	}

	#getNotifyData(): PublishedState<TState, TContext> {
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
	 * **Important:** Subscribers are notified synchronously. If you call `transition()` from within
	 * a subscriber callback, be careful to avoid infinite loops. Self-loop transitions (where the
	 * target state equals the current state) are valid FSM semantics and will trigger notifications.
	 *
	 * To prevent infinite loops when transitioning from within a subscriber:
	 * ```typescript
	 * fsm.subscribe(({ current, previous }) => {
	 *   // Only react to actual state changes, not self-loops
	 *   if (current !== previous) {
	 *     fsm.transition("someEvent");
	 *   }
	 * });
	 * ```
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
		cb: (data: PublishedState<TState, TContext>) => void
	): Unsubscriber {
		this.#logger.debug("New subscription registered.");
		const unsub = this.#pubsub.subscribe("change", cb);
		cb(this.#getNotifyData());
		return unsub;
	}

	#wrapHookError(
		fn: () => void,
		hookName: string,
		event: string,
		state: string
	) {
		try {
			fn();
		} catch (e) {
			throw new Error(
				`FSM: ${hookName} for "${event}" in state "${state}" threw: ${
					e instanceof Error ? e.message : String(e)
				}`,
				{ cause: e }
			);
		}
	}

	#invokeGuard(
		guard: (ctx: Readonly<TContext>, payload?: FSMPayload) => boolean,
		ctx: Readonly<TContext>,
		payload: FSMPayload | undefined,
		event: string,
		state: string
	): boolean {
		try {
			return guard(ctx, payload);
		} catch (e) {
			throw new Error(
				`FSM: guard for "${event}" in state "${state}" threw: ${
					e instanceof Error ? e.message : String(e)
				}`,
				{ cause: e }
			);
		}
	}

	/**
	 * Requests the FSM to transition based on the given event.
	 *
	 * **Resolution order:**
	 * 1. Try the specific event handler. If it resolves to a valid transition, use it.
	 * 2. Otherwise (no specific handler, or all its guards rejected), try the wildcard `"*"` handler.
	 * 3. If neither resolves, throw (when `assert` is true) or return `null`.
	 *
	 * **Execution order during external transitions:**
	 * 1. `onExit` hook of the current state
	 * 2. `action` of the transition edge
	 * 3. State changes (previous/current updated)
	 * 4. `onEnter` hook of the new state
	 * 5. Subscribers notified
	 *
	 * For internal transitions (no target defined), only the action runs and subscribers are notified.
	 *
	 * **Error handling:**
	 * - Errors thrown by `onExit`, `action`, guards, or `onEnter` propagate to the caller, wrapped
	 *   with the originating event/state for diagnostics (original error preserved as `cause`).
	 * - If `onExit` or `action` throws, no state change happens.
	 * - If `onEnter` throws, the state has already changed; subscribers are still notified
	 *   (in a `finally` block) before the error propagates.
	 *
	 * **Self-loop transitions:** When the target state equals the current state, the full transition
	 * lifecycle still executes (onExit, action, onEnter, notify). This is intentional — self-loops
	 * are valid FSM semantics for scenarios like retry logic, refresh, or re-initialization.
	 * Be cautious when calling `transition()` from within a subscriber callback to avoid infinite
	 * loops. See `subscribe()` documentation for prevention patterns.
	 *
	 * @param event - The transition event name
	 * @param payload - Optional data passed to guards, actions, and lifecycle hooks
	 * @param assert - If true (default), throws on invalid transitions; if false, returns `null`
	 * @returns The new state after transition, or `null` if transition failed in non-assert mode
	 * @throws Error if the transition is invalid and assert is true
	 *
	 * @example
	 * ```typescript
	 * fsm.transition("fetch");                      // Basic transition
	 * fsm.transition("resolve", data);              // With payload
	 * const result = fsm.transition("invalid", null, false);
	 * if (result === null) { ... }                  // Failed
	 * ```
	 */
	transition(
		event: TEvent,
		payload?: FSMPayload,
		assert = true
	): TState | null {
		this.#logger.debug(
			`Attempting '${event}' transition from '${this.#state}' state.`
		);
		const currentStateConfig = this.config.states[this.#state];

		// Constructor validation guarantees state exists; defensive check for safety
		if (!currentStateConfig || !currentStateConfig.on) {
			throw new Error(`No transitions defined for state "${this.#state}"`);
		}

		// 1. Try specific event handler first
		let activeTransition: TransitionObj<TState, TContext> | null = null;
		let usedWildcard = false;

		const specificDef = currentStateConfig.on[event];
		if (specificDef !== undefined) {
			activeTransition = this.#resolveTransition(
				specificDef,
				event,
				payload
			);
		}

		// 2. Fall back to wildcard if specific has no handler OR specific's guards all failed
		if (activeTransition === null) {
			const wildcardDef = currentStateConfig.on["*" as TEvent];
			if (wildcardDef !== undefined) {
				activeTransition = this.#resolveTransition(
					wildcardDef,
					event,
					payload
				);
				usedWildcard = activeTransition !== null;
			}
		}

		if (activeTransition === null) {
			this.#logger.debug(
				`Transition on '${event}' failed: no matching handler.`
			);
			if (assert) {
				throw new Error(
					`Invalid transition "${event}" from state "${this.#state}"`
				);
			}
			return null;
		}

		if (usedWildcard) {
			this.#logger.debug(`Using wildcard handler for '${event}' event.`);
		}

		// INTERNAL TRANSITION
		// if there is no target, we stay in the same state and ONLY run the action.
		if (activeTransition.target === undefined) {
			this.#logger.debug(`Processing '${event}' as internal transition.`);
			if (typeof activeTransition.action === "function") {
				this.#logger.debug(`Executing action for '${event}' transition.`);
				const action = activeTransition.action;
				const stateName = this.#state;
				this.#wrapHookError(
					() => action(this.context, payload),
					"action",
					event,
					stateName
				);
			}
			// Notify even for internal transitions: actions may have changed context
			this.#notify();
			return this.#state;
		}

		const nextState = activeTransition.target;
		this.#logger.debug(
			`Transitioning from '${this.#state}' to '${nextState}' on '${event}'.`
		);

		// 1. exit current state side-effect (errors propagate, no state change)
		if (typeof currentStateConfig.onExit === "function") {
			this.#logger.debug(`Executing onExit hook for '${this.#state}' state.`);
			const onExit = currentStateConfig.onExit;
			const stateName = this.#state;
			this.#wrapHookError(
				() => onExit(this.context, payload),
				"onExit",
				event,
				stateName
			);
		}

		// 2. execute transition action (errors propagate, no state change)
		if (typeof activeTransition.action === "function") {
			this.#logger.debug(`Executing action for '${event}' transition.`);
			const action = activeTransition.action;
			const stateName = this.#state;
			this.#wrapHookError(
				() => action(this.context, payload),
				"action",
				event,
				stateName
			);
		}

		// 3. commit state change
		this.#previous = this.#state;
		this.#state = nextState;

		// 4. enter new state side-effect — always notify (in finally) even if onEnter throws
		const nextStateConfig = this.config.states[nextState];
		try {
			if (typeof nextStateConfig.onEnter === "function") {
				this.#logger.debug(
					`Executing onEnter hook for '${nextState}' state.`
				);
				const onEnter = nextStateConfig.onEnter;
				this.#wrapHookError(
					() => onEnter(this.context, payload),
					"onEnter",
					event,
					nextState
				);
			}
		} finally {
			// 5. notify listeners — even if onEnter threw, subscribers see the new state
			this.#notify();
		}

		return this.#state;
	}

	/**
	 * Resolves the transition definition into a normalized object.
	 * Guards are evaluated against a cloned context to ensure they cannot mutate state.
	 * Returns `null` if no transition resolves (e.g., all guards in an array rejected).
	 */
	#resolveTransition(
		transition: TransitionDef<TState, TContext>,
		event: string,
		payload?: FSMPayload
	): TransitionObj<TState, TContext> | null {
		// simple string transition -> normalize to object
		if (typeof transition === "string") {
			return { target: transition };
		}

		// Clone context for guard evaluation to enforce purity
		// Guards should never mutate context - mutations belong in actions/hooks
		const clonedContext = structuredClone(this.context);
		const stateName = this.#state;

		// array of guarded transitions
		if (Array.isArray(transition)) {
			for (const t of transition) {
				if (typeof t.guard === "function") {
					if (
						this.#invokeGuard(
							t.guard,
							clonedContext,
							payload,
							event,
							stateName
						)
					) {
						return t;
					}
				} else {
					// Unconditional match (catch-all in array)
					return t;
				}
			}
			return null;
		}

		// single guarded transition object
		if (typeof transition.guard === "function") {
			return this.#invokeGuard(
				transition.guard,
				clonedContext,
				payload,
				event,
				stateName
			)
				? transition
				: null;
		}

		// single object without guard
		return transition;
	}

	/**
	 * Resets the FSM to its initial state and re-initializes the context.
	 *
	 * Lifecycle hooks fire as in any external transition: `onExit` of the current state,
	 * then context is rebuilt, then `onEnter` of the initial state, then subscribers are notified.
	 * If the current state IS the initial state, this is treated as a self-loop reset and still
	 * runs both hooks.
	 *
	 * If context was defined as a factory function, a fresh context is created. If it was a
	 * plain object, it is deep-cloned from the original config.
	 *
	 * Hooks receive `undefined` as payload. If a hook throws, the FSM is restored to its
	 * pre-reset state and the error propagates.
	 *
	 * @returns The FSM instance for chaining
	 *
	 * @example
	 * ```typescript
	 * fsm.reset().is("IDLE"); // true
	 * ```
	 */
	reset(): FSM<TState, TEvent, TContext> {
		this.#logger.debug(
			`Resetting FSM to initial '${this.config.initial}' state.`
		);

		const prevState = this.#state;
		const prevPrevious = this.#previous;
		const prevContext = this.context;

		try {
			// 1. exit current state
			const currentStateConfig = this.config.states[prevState];
			if (typeof currentStateConfig?.onExit === "function") {
				const onExit = currentStateConfig.onExit;
				this.#wrapHookError(
					() => onExit(this.context, undefined),
					"onExit",
					"reset",
					prevState
				);
			}

			// 2. swap to initial + fresh context
			this.#state = this.config.initial;
			this.#previous = null;
			this.context = this.#initContext();

			// 3. enter initial state — notify in finally even if onEnter throws
			const initialStateConfig = this.config.states[this.config.initial];
			try {
				if (typeof initialStateConfig?.onEnter === "function") {
					const onEnter = initialStateConfig.onEnter;
					this.#wrapHookError(
						() => onEnter(this.context, undefined),
						"onEnter",
						"reset",
						this.config.initial
					);
				}
			} finally {
				this.#notify();
			}
		} catch (e) {
			// onExit failed before we mutated anything: restore for safety
			if (this.#state === prevState && this.context === prevContext) {
				// no-op, nothing changed
			} else if (this.#state !== this.config.initial) {
				// shouldn't happen, but be safe
				this.#state = prevState;
				this.#previous = prevPrevious;
				this.context = prevContext;
			}
			throw e;
		}

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
	 * Checks whether the FSM is currently in any of the given states.
	 *
	 * @param states - One or more states to check against
	 * @returns True if the FSM is in any of the specified states
	 *
	 * @example
	 * ```typescript
	 * if (fsm.matches("LOADING", "RETRYING")) {
	 *   showSpinner();
	 * }
	 * ```
	 */
	matches(...states: TState[]): boolean {
		return states.includes(this.#state);
	}

	/**
	 * Returns an immutable-shaped snapshot of the current FSM state.
	 * The returned object is a fresh structure, but `context` is a deep clone — mutating
	 * it does not affect the FSM.
	 *
	 * @returns Snapshot containing `state`, `previous`, and a deep-cloned `context`
	 *
	 * @example
	 * ```typescript
	 * const snap = fsm.getSnapshot();
	 * localStorage.setItem("fsm", JSON.stringify(snap));
	 * ```
	 */
	getSnapshot(): FSMSnapshot<TState, TContext> {
		return {
			state: this.#state,
			previous: this.#previous,
			context: structuredClone(this.context),
		};
	}

	/**
	 * Checks whether a transition is valid from the current state without executing it.
	 * This is a pure query operation that does not modify FSM state.
	 * Guards are evaluated against a cloned context to ensure they cannot mutate state.
	 *
	 * Resolution order matches `transition()`: specific event first, then wildcard fallback
	 * (used when the specific handler is missing OR all its guards reject).
	 *
	 * @param event - The transition event name to check
	 * @param payload - Optional payload for guard evaluation
	 * @returns `true` if the transition can be executed, `false` otherwise
	 *
	 * @example
	 * ```typescript
	 * if (fsm.canTransition("submit")) {
	 *   fsm.transition("submit");
	 * } else {
	 *   console.log("Submit not available");
	 * }
	 * ```
	 */
	canTransition(event: TEvent, payload?: FSMPayload): boolean {
		this.#logger.debug(
			`Checking if '${event}' can trigger transition from '${this.#state}'.`
		);
		const currentStateConfig = this.config.states[this.#state];

		if (!currentStateConfig || !currentStateConfig.on) {
			this.#logger.debug(
				`Cannot transition on '${event}': no transitions defined for current state.`
			);
			return false;
		}

		// Try specific event first
		const specificDef = currentStateConfig.on[event];
		if (specificDef !== undefined) {
			const resolved = this.#resolveTransition(specificDef, event, payload);
			if (resolved !== null) {
				this.#logger.debug(`Transition on '${event}' is allowed.`);
				return true;
			}
		}

		// Fall back to wildcard
		const wildcardDef = currentStateConfig.on["*" as TEvent];
		if (wildcardDef !== undefined) {
			const resolved = this.#resolveTransition(wildcardDef, event, payload);
			if (resolved !== null) {
				this.#logger.debug(`Transition on '${event}' is allowed (via wildcard).`);
				return true;
			}
		}

		this.#logger.debug(`Transition on '${event}' is denied.`);
		return false;
	}

	/**
	 * Inverse of `canTransition()` — returns `true` if the transition cannot fire.
	 *
	 * @param event - The transition event name to check
	 * @param payload - Optional payload for guard evaluation
	 * @returns `true` if the transition is NOT allowed
	 */
	cannot(event: TEvent, payload?: FSMPayload): boolean {
		return !this.canTransition(event, payload);
	}

	/**
	 * Creates an FSM instance from a Mermaid stateDiagram-v2 notation.
	 * This is a static factory method that wraps the standalone fromMermaid parser.
	 *
	 * Limitations:
	 * - Cannot recreate actual guard/action functions (sets them to placeholders that always pass)
	 * - Cannot recreate onEnter/onExit hooks (not represented in Mermaid)
	 * - Cannot infer context structure
	 *
	 * @param mermaidDiagram - A Mermaid stateDiagram-v2 string
	 * @returns A new FSM instance parsed from the diagram
	 *
	 * @example
	 * ```typescript
	 * const fsm = FSM.fromMermaid<"IDLE" | "ACTIVE", "start" | "stop">(`
	 *   stateDiagram-v2
	 *   [*] --> IDLE
	 *   IDLE --> ACTIVE: start
	 *   ACTIVE --> IDLE: stop
	 * `);
	 * ```
	 */
	static fromMermaid<
		TState extends string = string,
		TEvent extends string = string,
		TContext = unknown
	>(mermaidDiagram: string): FSM<TState, TEvent, TContext> {
		const config = fromMermaidParser<TState, TEvent, TContext>(mermaidDiagram);
		return new FSM<TState, TEvent, TContext>(config);
	}

	/**
	 * Generates a Mermaid stateDiagram-v2 notation from the FSM configuration.
	 * Useful for visualizing the state machine graph.
	 *
	 * The output follows UML conventions:
	 * - Indexed guards (array transitions) are shown as `[guard N]`
	 * - Single unindexed guard is shown as `[guarded]`
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

		// Helper to format the label: "Event [Guard] / Action"
		// guardIdx semantics:
		//   null   → no guard
		//   -1     → guarded (single, unindexed)
		//   1..N   → indexed (array entry N)
		const formatLabel = (
			evt: string,
			guardIdx: number | null,
			hasAction: boolean,
			isInternal: boolean
		) => {
			let label = evt === "*" ? "* (any)" : evt;
			if (guardIdx === -1) label += ` [guarded]`;
			else if (guardIdx !== null) label += ` [guard ${guardIdx}]`;

			if (hasAction) {
				label += isInternal ? ` / (action internal)` : ` / (action)`;
			}
			return label;
		};

		for (const [stateName, stateConfig] of Object.entries(this.config.states)) {
			const sc = stateConfig as FSMStatesConfigValue<
				TState,
				TEvent,
				TContext
			>;
			for (const [event, def] of Object.entries(sc.on ?? {})) {
				if (def === undefined) continue;
				const transitionDef = def as TransitionDef<TState, TContext>;

				if (typeof transitionDef === "string") {
					const label = event === "*" ? "* (any)" : event;
					mermaid += `    ${stateName} --> ${transitionDef}: ${label}\n`;
				} else if (Array.isArray(transitionDef)) {
					transitionDef.forEach((t, idx) => {
						const target = t.target ?? stateName;
						// Only emit a guard label for entries that actually have a guard
						const guardIdx = t.guard ? idx + 1 : null;
						const label = formatLabel(
							event,
							guardIdx,
							!!t.action,
							t.target === undefined
						);
						mermaid += `    ${stateName} --> ${target}: ${label}\n`;
					});
				} else {
					const target = transitionDef.target ?? stateName;
					const label = formatLabel(
						event,
						transitionDef.guard ? -1 : null,
						!!transitionDef.action,
						transitionDef.target === undefined
					);
					mermaid += `    ${stateName} --> ${target}: ${label}\n`;
				}
			}
		}

		return mermaid;
	}
}
