import type {
	FSMConfig,
	FSMStatesConfigValue,
	FSMPayload,
} from "./fsm.ts";

/**
 * A partial FSM configuration fragment for composition.
 * All fields are optional to allow building configs piece by piece.
 * States can be partially defined - you don't need to define all states in each fragment.
 */
export type FSMConfigFragment<
	TState extends string,
	TTransition extends string,
	TContext
> = {
	initial?: TState;
	states?: {
		[K in TState]?: Partial<FSMStatesConfigValue<TState, TTransition, TContext>>;
	};
	context?: TContext | (() => TContext);
	debug?: boolean;
};

/**
 * Options for composing FSM configurations.
 */
export type ComposeFsmConfigOptions = {
	/**
	 * How to handle lifecycle hooks (onEnter, onExit) when multiple fragments
	 * define them for the same state.
	 *
	 * - 'replace': Later fragments override earlier ones (default)
	 * - 'compose': Chain hooks - all hooks run in fragment order
	 */
	hooks?: "replace" | "compose";

	/**
	 * How to handle context when multiple fragments define it.
	 *
	 * - 'merge': Shallow-merge context objects from all fragments (default)
	 * - 'replace': Later fragments completely override earlier context
	 *
	 * When merging, if context is a factory function, it will be called
	 * and its result merged. The final result is always wrapped in a
	 * factory function for proper reset behavior.
	 */
	context?: "merge" | "replace";

	/**
	 * How to handle conflicts for singular values like `initial`.
	 *
	 * - 'last-wins': Later fragments override earlier ones (default)
	 * - 'error': Throw an error if multiple fragments define the same value
	 */
	onConflict?: "last-wins" | "error";
};

type HookFn<TContext> = (context: TContext, payload?: FSMPayload) => void;

/**
 * Composes multiple FSM configuration fragments into a single config.
 *
 * This allows building complex FSMs from reusable building blocks:
 * - Define a core configuration with common states
 * - Add/remove feature branches conditionally
 * - Share state definitions across different FSM variants
 *
 * @example
 * ```typescript
 * const core = {
 *   initial: "IDLE",
 *   states: {
 *     IDLE: { on: { START: "RUNNING" } },
 *     RUNNING: { on: { STOP: "IDLE" } },
 *   }
 * };
 *
 * const errorHandling = {
 *   states: {
 *     RUNNING: { on: { ERROR: "FAILED" } },  // extends RUNNING
 *     FAILED: { on: { RETRY: "RUNNING", RESET: "IDLE" } },
 *   }
 * };
 *
 * const config = composeFsmConfig([core, errorHandling]);
 * // Result: RUNNING now has both STOP and ERROR transitions
 * ```
 *
 * @param fragments - Array of FSM config fragments (falsy values are filtered out)
 * @param options - Composition options
 * @returns A merged FSM configuration
 */
export function composeFsmConfig<
	TState extends string,
	TTransition extends string,
	TContext
>(
	fragments: (FSMConfigFragment<TState, TTransition, TContext> | false | null | undefined)[],
	options: ComposeFsmConfigOptions = {}
): FSMConfig<TState, TTransition, TContext> {
	const { hooks = "replace", context: contextMode = "merge", onConflict = "last-wins" } = options;

	// Filter out falsy values (allows conditional fragments)
	const validFragments = fragments.filter(
		(f): f is FSMConfigFragment<TState, TTransition, TContext> => Boolean(f)
	);

	if (validFragments.length === 0) {
		throw new Error("composeFsmConfig requires at least one valid fragment");
	}

	// Track values for conflict detection
	let initial: TState | undefined;
	let debug: boolean | undefined;

	// For context merging, we collect all context values/factories
	const contextSources: (TContext | (() => TContext))[] = [];

	// Merged states map
	const mergedStates: Record<string, FSMStatesConfigValue<TState, TTransition, TContext>> = {};

	// Track hooks for composition mode
	const hookCollectors: Record<
		string,
		{ onEnter: HookFn<TContext>[]; onExit: HookFn<TContext>[] }
	> = {};

	for (const fragment of validFragments) {
		// Handle initial
		if (fragment.initial !== undefined) {
			if (onConflict === "error" && initial !== undefined && initial !== fragment.initial) {
				throw new Error(
					`Conflict: multiple fragments define different 'initial' values: "${initial}" vs "${fragment.initial}"`
				);
			}
			initial = fragment.initial;
		}

		// Handle context
		if (fragment.context !== undefined) {
			contextSources.push(fragment.context);
		}

		// Handle debug
		if (fragment.debug !== undefined) {
			debug = fragment.debug;
		}

		// Merge states
		if (fragment.states) {
			for (const [stateName, stateConfig] of Object.entries(fragment.states)) {
				const state = stateName as TState;
				const config = stateConfig as FSMStatesConfigValue<TState, TTransition, TContext>;

				if (!mergedStates[state]) {
					mergedStates[state] = { on: {} };
					hookCollectors[state] = { onEnter: [], onExit: [] };
				}

				// Merge transitions (on)
				if (config.on) {
					mergedStates[state]!.on = {
						...mergedStates[state]!.on,
						...config.on,
					};
				}

				// Handle hooks based on mode
				if (hooks === "compose") {
					if (config.onEnter) {
						hookCollectors[state].onEnter.push(config.onEnter);
					}
					if (config.onExit) {
						hookCollectors[state].onExit.push(config.onExit);
					}
				} else {
					// replace mode
					if (config.onEnter) {
						mergedStates[state]!.onEnter = config.onEnter;
					}
					if (config.onExit) {
						mergedStates[state]!.onExit = config.onExit;
					}
				}
			}
		}
	}

	// In compose mode, create composed hook functions
	if (hooks === "compose") {
		for (const [stateName, collectors] of Object.entries(hookCollectors)) {
			const state = stateName as TState;
			if (collectors.onEnter.length > 0) {
				mergedStates[state]!.onEnter = composeHooks(collectors.onEnter);
			}
			if (collectors.onExit.length > 0) {
				mergedStates[state]!.onExit = composeHooks(collectors.onExit);
			}
		}
	}

	if (initial === undefined) {
		throw new Error("composeFsmConfig: no 'initial' state defined in any fragment");
	}

	const result: FSMConfig<TState, TTransition, TContext> = {
		initial,
		states: mergedStates as Record<TState, FSMStatesConfigValue<TState, TTransition, TContext>>,
	};

	// Handle context based on mode
	if (contextSources.length > 0) {
		if (contextMode === "replace") {
			// Last context wins
			result.context = contextSources[contextSources.length - 1];
		} else {
			// Merge mode (default): create a factory that merges all contexts
			result.context = () => {
				let merged = {} as TContext;
				for (const source of contextSources) {
					const value = typeof source === "function" ? (source as () => TContext)() : source;
					merged = { ...merged, ...value };
				}
				return merged;
			};
		}
	}

	if (debug !== undefined) {
		result.debug = debug;
	}

	return result;
}

/**
 * Creates a single hook function that runs multiple hooks in sequence.
 */
function composeHooks<TContext>(hooks: HookFn<TContext>[]): HookFn<TContext> {
	return (context: TContext, payload?: FSMPayload) => {
		for (const hook of hooks) {
			hook(context, payload);
		}
	};
}
