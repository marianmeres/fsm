import type { FSMConfig, TransitionObj } from "./fsm.ts";

/**
 * Parses a Mermaid stateDiagram-v2 notation into an FSM config structure.
 *
 * Limitations:
 * - Cannot recreate actual guard/action functions (sets them to null as placeholders)
 * - Cannot recreate onEnter/onExit hooks (not represented in mermaid)
 * - Cannot infer context structure
 * - Type information must be provided via generics
 *
 * This is primarily useful for documentation/visualization roundtripping.
 */
export function fromMermaid<
	TState extends string = string,
	TTransition extends string = string,
	TContext = any
>(mermaidDiagram: string): FSMConfig<TState, TTransition, TContext> {
	const lines = mermaidDiagram.trim().split("\n");

	// Validate header
	if (!lines[0]?.trim().startsWith("stateDiagram-v2")) {
		throw new Error(
			'Invalid mermaid diagram: must start with "stateDiagram-v2"'
		);
	}

	let initial: TState | null = null;
	const statesMap = new Map<
		TState,
		Map<TTransition, Array<TransitionObj<TState, TContext>>>
	>();

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		// Match: [*] --> StateName
		const initialMatch = line.match(/^\[\*\]\s*-->\s*(\w+)$/);
		if (initialMatch) {
			initial = initialMatch[1] as TState;
			continue;
		}

		// Match: StateA --> StateB: label
		const transitionMatch = line.match(/^(\w+)\s*-->\s*(\w+):\s*(.+)$/);
		if (transitionMatch) {
			const [, fromState, toState, label] = transitionMatch;
			const parsed = parseLabel(label.trim());

			const from = fromState as TState;
			const to = toState as TState;
			const event = parsed.event as TTransition;

			// Initialize state if not exists
			if (!statesMap.has(from)) {
				statesMap.set(from, new Map());
			}

			// Initialize event array if not exists
			const stateTransitions = statesMap.get(from)!;
			if (!stateTransitions.has(event)) {
				stateTransitions.set(event, []);
			}

			// Build transition object
			const transitionObj: TransitionObj<TState, TContext> = {};

			// Internal transition check (same source and target with internal action)
			if (from === to && parsed.isInternalAction) {
				// No target for internal transitions
				if (parsed.hasAction) {
					transitionObj.action = null as any; // placeholder
				}
			} else {
				transitionObj.target = to;
				if (parsed.hasGuard) {
					transitionObj.guard = null as any; // placeholder
				}
				if (parsed.hasAction) {
					transitionObj.action = null as any; // placeholder
				}
			}

			stateTransitions.get(event)!.push(transitionObj);
		}
	}

	if (!initial) {
		throw new Error('Invalid mermaid diagram: no initial state found ([*] --> State)');
	}

	// Convert to FSM config format
	const states: any = {};

	for (const [stateName, transitions] of statesMap.entries()) {
		const on: any = {};

		for (const [event, transitionArray] of transitions.entries()) {
			if (transitionArray.length === 1) {
				const t = transitionArray[0];
				// If it's a simple string target with no guards/actions and has a target
				const hasOnlyTarget = t.target &&
					t.guard === undefined &&
					t.action === undefined;

				if (hasOnlyTarget) {
					on[event] = t.target;
				} else {
					on[event] = t;
				}
			} else {
				// Multiple guarded transitions -> array
				on[event] = transitionArray;
			}
		}

		states[stateName] = { on };
	}

	return {
		initial,
		states,
	};
}

/**
 * Parses a transition label into structured information.
 *
 * Supported formats:
 * - "event"
 * - "* (any)"
 * - "event [guard N]"
 * - "event [guarded]"
 * - "event / (action)"
 * - "event / (action internal)"
 * - "event [guard N] / (action)"
 * - "* (any) / (action)"
 */
function parseLabel(label: string): {
	event: string;
	hasGuard: boolean;
	hasAction: boolean;
	isInternalAction: boolean;
} {
	let event = label;
	let hasGuard = false;
	let hasAction = false;
	let isInternalAction = false;

	// Check for action suffix
	const actionMatch = label.match(/\s*\/\s*\((action(?:\s+internal)?)\)$/);
	if (actionMatch) {
		hasAction = true;
		isInternalAction = actionMatch[1].includes("internal");
		// Remove action part from label
		event = label.substring(0, actionMatch.index).trim();
	}

	// Check for guard
	const guardMatch = event.match(/\s*\[(guard(?:\s+\d+)?|guarded)\]$/);
	if (guardMatch) {
		hasGuard = true;
		// Remove guard part from event
		event = event.substring(0, guardMatch.index).trim();
	}

	// Handle wildcard
	if (event === "* (any)") {
		event = "*";
	}

	return { event, hasGuard, hasAction, isInternalAction };
}
