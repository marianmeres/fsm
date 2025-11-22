import { createPubSub, type Unsubscriber } from "@marianmeres/pubsub";

/** Arbitrary transition payload */
export type FSMPayload = any;

/** State configuration value */
export type FSMStatesConfigValue<
	TState extends string,
	TTransition extends string,
	TContext
> = {
	onEnter?: (context: TContext, payload?: FSMPayload) => void;
	on: Partial<Record<TTransition, TransitionDef<TState, TContext>>>;
	onExit?: (context: TContext, payload?: FSMPayload) => void;
};

/** State to configuration map */
export type FSMStatesConfigMap<
	TState extends string,
	TTransition extends string,
	TContext
> = Record<TState, FSMStatesConfigValue<TState, TTransition, TContext>>;

/** Constructor configuration */
export type FSMConfig<
	TState extends string,
	TTransition extends string,
	TContext
> = {
	initial: TState;
	states: FSMStatesConfigMap<TState, TTransition, TContext>;
	// accepts a value OR a factory function for true resets
	context?: TContext | (() => TContext);
};

/** Transition configuration object  */
export type TransitionObj<TState, TContext> = {
	// target is optional... if undefined, the transition will be considered as "internal"
	// and in such case only the action will re-run
	target?: TState;
	guard?: (context: TContext, payload?: FSMPayload) => boolean;
	// action hook for edge-specific side effects
	action?: (context: TContext, payload?: FSMPayload) => void;
};

/** Transition configuration definition */
export type TransitionDef<TState, TContext> =
	| TState
	| TransitionObj<TState, TContext>
	| TransitionObj<TState, TContext>[];

/** FSM's published state */
export type PublishedState<TState> = {
	current: TState;
	previous: TState | null;
};

/** For historical reasons exporting a factory fn as well (same as calling `new FSM`) */
export function createFsm<
	TState extends string,
	TTransition extends string,
	TContext = any
>(
	config: FSMConfig<TState, TTransition, TContext>
): FSM<TState, TTransition, TContext> {
	return new FSM<TState, TTransition, TContext>(config);
}

/**
 * Lightweight, typed, framework-agnostic Finite State Machine.
 */
export class FSM<
	TState extends string,
	TTransition extends string,
	TContext = any
> {
	/** FSM's previous state */
	#previous: TState | null = null;

	/** FSM's current state */
	#state: TState;

	/** A custom object accessible throughout the FSM's lifetime. */
	context: TContext;

	/** Internal pub sub */
	#pubsub = createPubSub();

	/** Creates the FSM instance */
	constructor(
		public readonly config: FSMConfig<TState, TTransition, TContext>
	) {
		this.#state = this.config.initial;
		this.context = this.#initContext();
	}

	/** Non-reactive getter from the outside */
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

	/** Reactive subscription to FSM's state */
	subscribe(
		cb: (data: PublishedState<TState> & { context: TContext }) => void
	): Unsubscriber {
		const unsub = this.#pubsub.subscribe("change", cb);
		cb(this.#getNotifyData());
		return unsub;
	}

	/**
	 * "Requests" FSM to transition to target state providing payload and respecting
	 * the configuration.
	 *
	 * Execution order during transition:
	 * 1. onExit (OLD state)
	 * 2. action (TRANSITION edge)
	 * 3. state changes
	 * 4. onEnter (NEW state)
	 * 5. notify consumers
	 */
	transition(
		event: TTransition,
		payload?: FSMPayload,
		assert = true
	): TState | null {
		const currentStateConfig = this.config.states[this.#state];

		if (!currentStateConfig || !currentStateConfig.on) {
			throw new Error(`No transitions defined for state "${this.#state}"`);
		}

		const transitionDef = currentStateConfig.on[event];

		if (!transitionDef) {
			if (assert) {
				// prettier-ignore
				throw new Error(`Invalid transition "${event}" from state "${this.#state}"`);
			} else {
				// just return current if non-assert mode
				return this.#state;
			}
		}

		// returns the full normalized transition object
		const activeTransition = this.#resolveTransition(transitionDef, payload);

		if (!activeTransition) {
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
			if (typeof activeTransition.action === "function") {
				activeTransition.action(this.context, payload);
			}
			// here we do NOT fire onExit, onEnter, or update this.#previous, BUT we
			// notify consumers, since actions may change context
			this.#notify();
			return this.#state;
		}

		const nextState = activeTransition.target;

		// 1. exit current state side-effect
		if (typeof currentStateConfig.onExit === "function") {
			currentStateConfig.onExit(this.context, payload);
		}

		// 2. execute transition action (if defined)
		if (typeof activeTransition.action === "function") {
			activeTransition.action(this.context, payload);
		}

		// 3. save previous and set new state
		this.#previous = this.#state;
		this.#state = nextState;

		// 4. enter new state side-effect
		const nextStateConfig = this.config.states[nextState];
		if (typeof nextStateConfig.onEnter === "function") {
			nextStateConfig.onEnter(this.context, payload);
		}

		// 5. notify listeners
		this.#notify();

		// return current
		return this.#state;
	}

	/** Resolves the transition definition into a normalized object */
	#resolveTransition(
		transition: TransitionDef<TState, TContext>,
		payload?: FSMPayload
	): TransitionObj<TState, TContext> | null {
		// simple string transition -> normalize to object
		if (typeof transition === "string") {
			return { target: transition };
		}

		// array of guarded transitions
		if (Array.isArray(transition)) {
			for (const t of transition) {
				if (typeof t.guard === "function") {
					if (t.guard(this.context, payload)) return t;
				} else {
					// If no guard is present in an array item, it's an unconditional match
					return t;
				}
			}
			return null;
		}

		// single guarded transition object
		if (typeof transition.guard === "function") {
			return transition.guard(this.context, payload) ? transition : null;
		}

		// single object without guard
		return transition;
	}

	/** Resets the FSM to initial state and re-initializes context */
	reset(): FSM<TState, TTransition, TContext> {
		this.#state = this.config.initial;
		this.#previous = null;
		this.context = this.#initContext();
		this.#notify();
		return this;
	}

	/** Check whether the FSM is in the given state */
	is(state: TState): boolean {
		return this.#state === state;
	}

	/** Generates Mermaid state diagram notation from FSM config */
	toMermaid(): string {
		let mermaid = "stateDiagram-v2\n";
		mermaid += `    [*] --> ${this.config.initial}\n`;

		for (const [stateName, stateConfig] of Object.entries<any>(
			this.config.states
		)) {
			for (const [event, def] of Object.entries<any>(stateConfig?.on ?? {})) {
				// Helper to format the label: "Event [Guard] / Action"
				const formatLabel = (
					evt: string,
					guardIdx: number | null,
					hasAction: boolean,
					isInternal: boolean
				) => {
					let label = evt;
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
					mermaid += `    ${stateName} --> ${def}: ${event}\n`;
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
