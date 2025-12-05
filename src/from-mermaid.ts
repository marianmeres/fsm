import type { FSMConfig, TransitionObj } from "./fsm.ts";

/**
 * Parses a Mermaid stateDiagram-v2 notation into an FSM configuration object.
 *
 * This function enables round-tripping between FSM configurations and Mermaid diagrams,
 * making it useful for documentation, visualization, and testing.
 *
 * **Supported label formats:**
 * - `event` - Simple transition
 * - `* (any)` - Wildcard transition
 * - `event [guard N]`, `event [guarded]`, or `event [guard ...]` - Guarded transition
 * - `event / (action)` - Transition with action
 * - `event / (action internal)` - Internal transition (no state change)
 * - `event [guard ...] / (action)` - Guarded transition with action
 *
 * **Ignored Mermaid features (non-FSM lines):**
 * - YAML frontmatter (`---\nconfig: ...\n---`)
 * - Comments (`%%`)
 * - Directives (`%%{...}%%`)
 * - Styling (`classDef`, `class`, `style`)
 * - State descriptions (`state "Description" as StateName`)
 * - Composite states / subgraphs (`state StateName { ... }`)
 * - Notes (`note left of`, `note right of`)
 * - Final state transitions (`StateName --> [*]`)
 * - Direction statements (`direction LR`, `direction TB`, etc.)
 * - Any other unrecognized lines
 *
 * **Limitations:**
 * - Cannot recreate actual guard/action functions (sets them to `null` as placeholders)
 * - Cannot recreate `onEnter`/`onExit` hooks (not represented in Mermaid)
 * - Cannot infer context structure
 * - Type information must be provided via generics
 *
 * @template TState - Union type of all possible state names
 * @template TTransition - Union type of all possible transition event names
 * @template TContext - Type of the FSM context object
 * @param mermaidDiagram - A Mermaid stateDiagram-v2 string
 * @returns FSM configuration object ready to pass to the FSM constructor
 * @throws Error if the diagram is invalid (missing header or initial state)
 *
 * @example
 * ```typescript
 * const config = fromMermaid<"ON" | "OFF", "toggle">(`
 *   stateDiagram-v2
 *   [*] --> OFF
 *   OFF --> ON: toggle
 *   ON --> OFF: toggle
 * `);
 * const fsm = new FSM(config);
 * ```
 */
export function fromMermaid<
	TState extends string = string,
	TTransition extends string = string,
	TContext = unknown
>(mermaidDiagram: string): FSMConfig<TState, TTransition, TContext> {
	const lines = mermaidDiagram.trim().split("\n");

	// Find the stateDiagram-v2 header, skipping any YAML frontmatter
	// (e.g., ---\nconfig:\n  layout: elk\n---\nstateDiagram-v2)
	const startIndex = lines.findIndex((line) =>
		line.trim().startsWith("stateDiagram-v2")
	);

	if (startIndex === -1) {
		throw new Error('Invalid mermaid diagram: must contain "stateDiagram-v2"');
	}

	let initial: TState | null = null;
	const statesMap = new Map<
		TState,
		Map<TTransition, Array<TransitionObj<TState, TContext>>>
	>();

	for (let i = startIndex + 1; i < lines.length; i++) {
		const line = lines[i].trim();

		// Skip empty lines
		if (!line) continue;

		// Skip comments (both %% comment and %%{ directive }%%)
		if (line.startsWith("%%")) continue;

		// Skip direction statements (direction LR, direction TB, etc.)
		if (line.startsWith("direction ")) continue;

		// Skip styling: classDef, class, style
		if (/^(classDef|class|style)\s/.test(line)) continue;

		// Skip state descriptions: state "Description" as StateName
		if (/^state\s+["']/.test(line)) continue;

		// Skip composite state definitions: state StateName { or just {
		if (/^state\s+\w+\s*\{/.test(line) || line === "{" || line === "}")
			continue;

		// Skip notes: note left of, note right of, note
		if (/^note\s/.test(line)) continue;

		// Skip final state transitions: StateName --> [*]
		if (/-->\s*\[\*\]\s*$/.test(line)) continue;

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
					transitionObj.action = null as unknown as TransitionObj<
						TState,
						TContext
					>["action"]; // placeholder
				}
			} else {
				transitionObj.target = to;
				if (parsed.hasGuard) {
					transitionObj.guard = null as unknown as TransitionObj<
						TState,
						TContext
					>["guard"]; // placeholder
				}
				if (parsed.hasAction) {
					transitionObj.action = null as unknown as TransitionObj<
						TState,
						TContext
					>["action"]; // placeholder
				}
			}

			stateTransitions.get(event)!.push(transitionObj);
		}
		// Any other unrecognized lines are silently ignored
	}

	if (!initial) {
		throw new Error(
			"Invalid mermaid diagram: no initial state found ([*] --> State)"
		);
	}

	// Convert to FSM config format
	// Using Record types for flexibility since we're building the config dynamically
	const states: Record<string, { on: Record<string, unknown> }> = {};

	for (const [stateName, transitions] of statesMap.entries()) {
		const on: Record<string, unknown> = {};

		for (const [event, transitionArray] of transitions.entries()) {
			if (transitionArray.length === 1) {
				const t = transitionArray[0];
				// If it's a simple string target with no guards/actions and has a target
				const hasOnlyTarget =
					t.target && t.guard === undefined && t.action === undefined;

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
	} as FSMConfig<TState, TTransition, TContext>;
}

/**
 * Parses a transition label into structured information.
 *
 * Supported formats:
 * - "event"
 * - "* (any)"
 * - "event [guard N]"
 * - "event [guarded]"
 * - "event [guard anything here]"
 * - "event / (action)"
 * - "event / (action internal)"
 * - "event [guard ...] / (action)"
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
	// Supports: [guarded], [guard], [guard N], [guard anything here]
	const guardMatch = event.match(/\s*\[(guard(?:\s+[^\]]+)?|guarded)\]$/);
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
