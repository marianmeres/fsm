import { type Logger, createLogger } from "@marianmeres/clog";
import { createPubSub } from "@marianmeres/pubsub";

/**  */
export type LifeCycleEvent<
	TState extends PropertyKey,
	TEvent extends PropertyKey,
	TContext
> = Record<
	"_entry" | "_exit",
	(payload: any, meta: TransitionMetaWithSend<TState, TEvent, TContext>) => void
>;

export type TStateTargetFn<
	TState extends PropertyKey,
	TEvent extends PropertyKey,
	TContext
> = (
	payload: any,
	meta: TransitionMetaWithSend<TState, TEvent, TContext>
) => TState;

/**  */
export type EventDefObj<
	TState extends PropertyKey,
	TEvent extends PropertyKey,
	TContext
> = {
	target: TState | TStateTargetFn<TState, TEvent, TContext>;
	canTransition?: (
		payload: any,
		meta: TransitionMeta<TState, TContext>
	) => boolean;
	effect?: (payload: any, meta: TransitionMeta<TState, TContext>) => void;
};

/**  */
export type FsmState<TState> = { current: TState; previous: TState | null };

/**  */
export type TransitionMeta<TState extends PropertyKey, TContext> = {
	state: FsmState<TState>;
	context?: TContext;
	depth: number;
};

/**  */
export type TransitionMetaWithSend<
	TState extends PropertyKey,
	TEvent extends PropertyKey,
	TContext
> = TransitionMeta<TState, TContext> & {
	trigger: (
		event: EventName<FsmConfig<TState, TEvent, TContext>>,
		payload?: any
	) => TState;
};

/**  */
export type EventDef<
	TState extends PropertyKey,
	TEvent extends PropertyKey,
	TContext
> =
	| TState
	| ((
			payload: any,
			meta: TransitionMetaWithSend<TState, TEvent, TContext>
	  ) => TState)
	| EventDefObj<TState, TEvent, TContext>
	| ((
			payload: any,
			meta: TransitionMetaWithSend<TState, TEvent, TContext>
	  ) => EventDefObj<TState, TEvent, TContext>);

/**  */
export type StateConfig<
	TState extends PropertyKey,
	TEvent extends PropertyKey,
	TContext
> = Record<TEvent, EventDef<TState, TEvent, TContext>> &
	LifeCycleEvent<TState, TEvent, TContext>;

/**  */
export type FsmConfig<
	TState extends PropertyKey,
	TEvent extends PropertyKey,
	TContext
> = Record<TState | "*", Partial<StateConfig<TState, TEvent, TContext>>>;

/** Helper to extract all relevant keys from second-level records */
type EventName<T> = {
	[K in keyof T]: keyof Omit<T[K], "_entry" | "_exit">;
}[keyof T];

/** If input is not a function will return one as a wrapper which returns the input.
 * If input is a function will return it as is. */
function toFn(v: any) {
	return typeof v !== "function" ? (..._args: any[]) => v : v;
}

/** Lightweight, typed, framework-agnostic Finite State Machine. */
export function createFsm<
	TState extends PropertyKey,
	TEvent extends PropertyKey,
	TContext
>(
	initial: TState,
	config: FsmConfig<TState, TEvent, TContext>,
	context?: TContext,
	options: Partial<{ logger: Logger | null }> = {}
): {
	/** Subscribes to state changes. */
	subscribe: (cb: (data: FsmState<TState>) => void) => () => void;

	/** Sends an event to the machine to trigger a transition. Returns state after the event
	 * was handled (could be new could be the same...) */
	trigger: (
		event: EventName<FsmConfig<TState, TEvent, TContext>>,
		payload?: any,
		strict?: boolean
	) => TState;

	/** Non-reactive current state getter. */
	getCurrent: () => null | TState;

	/** Checks if the machine is in a specific state. */
	is: (stateName: TState) => boolean;

	/** Checks if an event is a valid transition from the current state. (Does not check
	 * guards). */
	can: (eventName: EventName<FsmConfig<TState, TEvent, TContext>>) => boolean;
} {
	const { logger = createLogger("FSM") } = options ?? {};

	// (not only) debug helper, to see how deep the potential trigger recursion is
	// (a `trigger` might call another `trigger` - which is completely valid)
	let depth = 0;

	// Use a type assertion for the initial state
	let current: TState = initial;
	let previous: TState | null = null;

	//
	const getState = () => ({ current, previous });
	const createMeta = () => ({ state: getState(), context, depth });
	const createMetaWithSend = () => ({ ...createMeta(), trigger });

	//
	const pubsub = createPubSub();
	const notify = () => pubsub.publish("change", getState());

	//
	function trigger(
		event: EventName<FsmConfig<TState, TEvent, TContext>>,
		payload?: any,
		strict: boolean = true
	): TState {
		depth++;
		const currentStateConfig = config[current];
		const wildcardStateConfig = config["*"] ?? {};
		const def = currentStateConfig?.[event] ?? config["*" as TState]?.[event];

		if (!def) {
			const msg = `Invalid event (transition) "${String(current)}" -> "${String(
				event
			)}"`;
			logger?.warn?.(msg);
			if (strict) throw new Error(msg);
			return current;
		}

		// default fallbacks
		let target: TState | TStateTargetFn<TState, TEvent, TContext>;
		let canTransition: EventDefObj<
			TState,
			TEvent,
			TContext
		>["canTransition"] = () => true;
		let effect: EventDefObj<TState, TEvent, TContext>["effect"] = () => {};

		//
		if (typeof def === "object") {
			target = def.target;
			if (typeof def.canTransition === "function") {
				canTransition = def.canTransition;
			}
			if (typeof def.effect === "function") {
				effect = def.effect;
			}
		} else {
			target = def as TState;
		}

		// sanity check
		if (!target) {
			throw new TypeError(`Empty target for "${String(event)}"`);
		}

		// 1. check the canTransition guard
		if (typeof canTransition === "function") {
			let allowed = false;
			try {
				allowed = canTransition(payload, createMeta());
			} catch (e) {
				logger?.error?.(`Error in canTransition for "${String(event)}": ${e}`);
				allowed = false;
			}

			if (!allowed) {
				logger?.warn?.(`Guard prevented "${String(event)}" transition`);
				return current;
			}
		}

		// 2. execute EXIT handler (of the OLD state)
		const exitAction = currentStateConfig?._exit ?? wildcardStateConfig?._exit;
		if (typeof exitAction === "function") {
			try {
				exitAction(payload, createMetaWithSend());
			} catch (e) {
				logger?.error?.(
					`Error in exit handler for state "${String(current)}": ${e}`
				);
				// here we're swallowing the error, leaving the flow intact
			}
		}

		// 3. execute TRANSITION effect
		if (typeof effect === "function") {
			try {
				effect(payload, createMeta());
			} catch (e) {
				logger?.error?.(`Error in effect for event "${String(event)}": ${e}`);
				// here we're swallowing the error, leaving the flow intact
			}
		}

		// NOTE: this
		const nextState: TState = toFn(target)(payload, createMetaWithSend());

		// sanity check - is the next state actually available?
		// (although this could be checked technically earlier, this is the correct lazy moment)
		if (!config[nextState]) {
			const msg = `Event "${String(
				event
			)}" resolved to invalid target state "${String(nextState)}"`;
			logger?.error?.(msg);
			throw new Error(msg);
		}

		// if we were calling trigger recursively with same output, we validly might not have a change...
		if (current !== nextState) {
			// 4. update state
			previous = current;
			current = nextState;

			// 5. execute ENTRY handler (of the NEW state)
			const entryAction = config[current]?._entry ?? config["*"]?._entry;
			if (typeof entryAction === "function") {
				try {
					entryAction(payload, createMetaWithSend());
				} catch (e) {
					logger?.error?.(`Error in _entry for "${String(current)}": ${e}`);
					// here we're swallowing the error, leaving the flow intact
				}
			}

			// 6. notify
			notify();
		}

		depth--;
		return current;
	}

	//
	const subscribe = (cb: (data: FsmState<TState>) => void): (() => void) => {
		const unsub = pubsub.subscribe("change", cb);
		cb(getState());
		return unsub;
	};

	return {
		//
		subscribe,
		//
		trigger,
		// non-reactive current getter
		getCurrent: () => getState().current,
		//
		is: (stateName: TState): boolean => current === stateName,
		// NOTE: this does not check the `canTransition` guards
		can: (eventName: EventName<FsmConfig<TState, TEvent, TContext>>) =>
			!!config[current]?.[eventName] || !!config["*" as TState]?.[eventName],
	};
}
