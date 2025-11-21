import { createPubSub, type Unsubscriber } from "@marianmeres/pubsub";

/** Arbitrary transition payload */
export type FSMPayload = Record<string, any>;

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
	context?: TContext;
};

/** Transition configuration object  */
export type TransitionObj<TState, TContext> = {
	target: TState;
	guard?: (context: TContext, payload: FSMPayload) => boolean;
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
>(config: FSMConfig<TState, TTransition, TContext>) {
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
	state: TState;

	/** A custom object accessible throughout the FSM's lifetime, containing arbitrary
	 * data that can be read and modified.*/
	context: TContext;

	/** Internal pub sub */
	#pubsub = createPubSub();

	/** Creates the FSM instance */
	constructor(
		public readonly config: FSMConfig<TState, TTransition, TContext>
	) {
		this.state = this.config.initial;
		this.context = { ...(this.config.context ?? ({} as TContext)) };
	}

	#getNotifyData() {
		return {
			current: this.state,
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
	 * the configuration. Guards and side effects, if defined,
	 * will be synchronously evaluated and executed.
	 *
	 * Execution order during transition:
	 *  1. onExit (OLD state)
	 *  2. state changes
	 *  3. onEnter (NEW state) - initialize, prepare
	 *  5. notify consumers
	 */
	transition(event: TTransition, payload?: any): TState | null {
		const currentStateConfig = this.config.states[this.state];

		if (!currentStateConfig || !currentStateConfig.on) {
			throw new Error(
				`No transitions defined for state "${String(this.state)}"`
			);
		}

		const transition = currentStateConfig.on[event];

		if (!transition) {
			// prettier-ignore
			throw new Error(`Invalid transition "${String(event)}" from state "${String(this.state)}"`);
		}

		const nextState = this.#resolveTransition(transition, payload);

		if (!nextState) {
			// prettier-ignore
			throw new Error(`No valid transition found for event "${String(event)}" in state "${String(this.state)}"`);
		}

		// 1. exit current state side-effect
		if (typeof currentStateConfig.onExit === "function") {
			currentStateConfig.onExit(this.context, payload);
		}

		// 2. save previous and set new state
		this.#previous = this.state;
		this.state = nextState;

		// 3. enter new state side-effect
		const nextStateConfig = this.config.states[nextState];
		if (typeof nextStateConfig.onEnter === "function") {
			nextStateConfig.onEnter(this.context, payload);
		}

		// 4. notify listeners
		this.#notify();

		// return current
		return this.state;
	}

	/**
	 *
	 */
	#resolveTransition(
		transition: TransitionDef<TState, TContext>,
		payload: FSMPayload
	): TState | null {
		// simple string transition
		if (typeof transition === "string") {
			return transition;
		}

		// array of guarded transitions
		if (Array.isArray(transition)) {
			for (const t of transition) {
				if (typeof t.guard === "function" && t.guard(this.context, payload)) {
					return t.target;
				}
			}
			return null;
		}

		// single guarded transition object
		if (typeof transition.guard === "function") {
			return transition.guard(this.context, payload) ? transition.target : null;
		}

		return transition.target;
	}

	/**
	 *
	 */
	reset(): FSM<TState, TTransition, TContext> {
		this.state = this.config.initial;
		this.context = { ...(this.config.context ?? ({} as TContext)) };
		this.#notify();
		return this;
	}

	/** Check whether the FSM is in the given state */
	is(state: TState) {
		return this.state === state;
	}

	/** Generates Mermaid state diagram notation from FSM config */
	toMermaid() {
		let mermaid = "stateDiagram-v2\n";
		mermaid += `    [*] --> ${this.config.initial}\n`;

		for (const entry of Object.entries(this.config.states)) {
			const [stateName, stateConfig] = entry as [
				TState,
				FSMStatesConfigValue<TState, TTransition, TContext>
			];
			if (stateConfig.on) {
				for (const entry2 of Object.entries(stateConfig.on)) {
					const [transition, def] = entry2 as [
						TTransition,
						TransitionDef<TState, TContext>
					];
					if (typeof def === "string") {
						mermaid += `    ${stateName} --> ${def}: ${transition}\n`;
					} else if (Array.isArray(def)) {
						def.forEach((t, idx) => {
							const label = t.guard
								? `${transition} [guard ${idx + 1}]`
								: transition;
							mermaid += `    ${stateName} --> ${t.target}: ${label}\n`;
						});
					} else if (def.target) {
						const label = def.guard ? `${transition} [guarded]` : transition;
						mermaid += `    ${stateName} --> ${def.target}: ${label}\n`;
					}
				}
			}
		}

		return mermaid;
	}
}
