import type { FSMConfig, FSMPayload, TransitionObj } from "./fsm.ts";

/**
 * Generates TypeScript code from a Mermaid stateDiagram-v2 notation.
 *
 * This function parses the diagram and outputs ready-to-paste TypeScript code
 * with TODO comments where guards and actions need to be implemented.
 *
 * @param mermaidDiagram - A Mermaid stateDiagram-v2 string
 * @param options - Optional configuration
 * @param options.indent - Indentation string (default: "\t")
 * @param options.configName - Variable name for the config (default: "config")
 * @returns TypeScript code string
 *
 * @example
 * ```typescript
 * const tsCode = toTypeScript(`
 *   stateDiagram-v2
 *   [*] --> IDLE
 *   IDLE --> LOADING: load
 *   LOADING --> SUCCESS: resolve [guard hasData]
 * `);
 * console.log(tsCode);
 * // Outputs ready-to-paste TypeScript with type definitions and TODO placeholders
 * ```
 */
export function toTypeScript(
	mermaidDiagram: string,
	options: { indent?: string; configName?: string } = {}
): string {
	const { indent = "\t", configName = "config" } = options;
	const config = fromMermaid(mermaidDiagram);

	// Collect all states and transitions
	const states = new Set<string>();
	const transitions = new Set<string>();

	states.add(config.initial);
	for (const [stateName, stateConfig] of Object.entries(config.states)) {
		states.add(stateName);
		for (const [event, def] of Object.entries(
			(stateConfig as { on: Record<string, unknown> }).on
		)) {
			transitions.add(event);
			// Also collect target states
			if (typeof def === "string") {
				states.add(def);
			} else if (Array.isArray(def)) {
				for (const t of def) {
					if (t.target) states.add(t.target);
				}
			} else if (def && typeof def === "object" && "target" in def && def.target) {
				states.add(def.target as string);
			}
		}
	}

	const statesUnion = Array.from(states)
		.map((s) => `"${s}"`)
		.join(" | ");
	const transitionsUnion = Array.from(transitions)
		.map((t) => `"${t}"`)
		.join(" | ");

	let out = "";

	// Type definitions
	out += `type States = ${statesUnion};\n`;
	out += `type Transitions = ${transitionsUnion};\n`;
	out += `type Context = { /* TODO: define your context */ };\n\n`;

	// Config object
	out += `const ${configName}: FSMConfig<States, Transitions, Context> = {\n`;
	out += `${indent}initial: "${config.initial}",\n`;
	out += `${indent}// context: () => ({ /* TODO */ }),\n`;
	out += `${indent}states: {\n`;

	for (const [stateName, stateConfig] of Object.entries(config.states)) {
		const sc = stateConfig as { on: Record<string, unknown> };
		out += `${indent}${indent}${stateName}: {\n`;
		out += `${indent}${indent}${indent}on: {\n`;

		for (const [event, def] of Object.entries(sc.on)) {
			const eventKey = event === "*" ? '"*"' : event;
			out += formatTransitionDef(eventKey, def, indent, 4);
		}

		out += `${indent}${indent}${indent}},\n`;
		out += `${indent}${indent}},\n`;
	}

	out += `${indent}},\n`;
	out += `};\n`;

	return out;
}

function formatTransitionDef(
	event: string,
	def: unknown,
	indent: string,
	level: number
): string {
	const i = indent.repeat(level);
	const i1 = indent.repeat(level + 1);

	if (typeof def === "string") {
		return `${i}${event}: "${def}",\n`;
	}

	if (Array.isArray(def)) {
		let out = `${i}${event}: [\n`;
		for (const t of def) {
			out += formatSingleTransition(t, indent, level + 1);
		}
		out += `${i}],\n`;
		return out;
	}

	// Single object
	const t = def as TransitionObj<string, unknown> & {
		guard?: { toJSON?: () => string };
		action?: { toJSON?: () => string };
	};

	// Check if it's internal (no target)
	if (!t.target) {
		let out = `${i}${event}: {\n`;
		if (t.action) {
			const actionHint = t.action?.toJSON?.() ?? "[ACTION: action]";
			out += `${i1}action: (ctx) => { /* TODO: ${actionHint} */ },\n`;
		}
		out += `${i}},\n`;
		return out;
	}

	// Simple target with guard/action
	const hasGuard = t.guard !== undefined;
	const hasAction = t.action !== undefined;

	if (!hasGuard && !hasAction) {
		return `${i}${event}: "${t.target}",\n`;
	}

	let out = `${i}${event}: {\n`;
	out += `${i1}target: "${t.target}",\n`;
	if (hasGuard) {
		const guardHint = t.guard?.toJSON?.() ?? "[GUARD: guard]";
		out += `${i1}guard: (ctx) => true, // TODO: ${guardHint}\n`;
	}
	if (hasAction) {
		const actionHint = t.action?.toJSON?.() ?? "[ACTION: action]";
		out += `${i1}action: (ctx) => { /* TODO: ${actionHint} */ },\n`;
	}
	out += `${i}},\n`;
	return out;
}

function formatSingleTransition(
	t: TransitionObj<string, unknown> & {
		guard?: { toJSON?: () => string };
		action?: { toJSON?: () => string };
	},
	indent: string,
	level: number
): string {
	const i = indent.repeat(level);
	const i1 = indent.repeat(level + 1);

	let out = `${i}{\n`;

	if (t.target) {
		out += `${i1}target: "${t.target}",\n`;
	}

	if (t.guard) {
		const guardHint = t.guard?.toJSON?.() ?? "[GUARD: guard]";
		out += `${i1}guard: (ctx) => true, // TODO: ${guardHint}\n`;
	}

	if (t.action) {
		const actionHint = t.action?.toJSON?.() ?? "[ACTION: action]";
		out += `${i1}action: (ctx) => { /* TODO: ${actionHint} */ },\n`;
	}

	out += `${i}},\n`;
	return out;
}

/**
 * Creates a placeholder guard function with toJSON for serialization.
 * The guard always returns true and serializes to a descriptive string.
 */
function createPlaceholderGuard<TContext>(
	notation: string | null
): (context: Readonly<TContext>, payload?: FSMPayload) => boolean {
	const guardFn = () => true;
	(guardFn as unknown as { toJSON: () => string }).toJSON = () =>
		`[GUARD: ${notation ?? "guarded"}]`;
	return guardFn;
}

/**
 * Creates a placeholder action function with toJSON for serialization.
 * The action is a no-op and serializes to a descriptive string.
 */
function createPlaceholderAction<TContext>(
	notation: string | null
): (context: TContext, payload?: FSMPayload) => void {
	const actionFn = () => {};
	(actionFn as unknown as { toJSON: () => string }).toJSON = () =>
		`[ACTION: ${notation ?? "action"}]`;
	return actionFn;
}

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
 * - Guards are placeholder functions that return `true` (with `toJSON()` for serialization)
 * - Actions are placeholder no-op functions (with `toJSON()` for serialization)
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
					transitionObj.action = createPlaceholderAction(parsed.actionNotation);
				}
			} else {
				transitionObj.target = to;
				if (parsed.hasGuard) {
					transitionObj.guard = createPlaceholderGuard(parsed.guardNotation);
				}
				if (parsed.hasAction) {
					transitionObj.action = createPlaceholderAction(parsed.actionNotation);
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
 * - "event / (action any text here)"
 * - "event [guard ...] / (action ...)"
 * - "* (any) / (action)"
 */
function parseLabel(label: string): {
	event: string;
	hasGuard: boolean;
	guardNotation: string | null;
	hasAction: boolean;
	isInternalAction: boolean;
	actionNotation: string | null;
} {
	let event = label;
	let hasGuard = false;
	let guardNotation: string | null = null;
	let hasAction = false;
	let isInternalAction = false;
	let actionNotation: string | null = null;

	// Check for action suffix
	// Supports: (action), (action internal), (action any text here)
	const actionMatch = label.match(/\s*\/\s*\((action(?:\s+[^)]*)?)\)$/);
	if (actionMatch) {
		hasAction = true;
		const actionContent = actionMatch[1]; // e.g., "action internal" or "action save to db"
		isInternalAction = actionContent === "action internal";
		// Extract notation if there's text after "action" (and it's not just "internal")
		if (actionContent !== "action" && actionContent !== "action internal") {
			actionNotation = `(${actionContent})`; // e.g., "(action save to db)"
		}
		// Remove action part from label
		event = label.substring(0, actionMatch.index).trim();
	}

	// Check for guard
	// Supports: [guarded], [guard], [guard N], [guard anything here]
	const guardMatch = event.match(/\s*\[(guard(?:\s+[^\]]+)?|guarded)\]$/);
	if (guardMatch) {
		hasGuard = true;
		guardNotation = guardMatch[0].trim(); // e.g., "[guard amount < price]"
		// Remove guard part from event
		event = event.substring(0, guardMatch.index).trim();
	}

	// Handle wildcard
	if (event === "* (any)") {
		event = "*";
	}

	return { event, hasGuard, guardNotation, hasAction, isInternalAction, actionNotation };
}
