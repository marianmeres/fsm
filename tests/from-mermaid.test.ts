import { assertEquals, assertThrows } from "@std/assert";
import { fromMermaid, toTypeScript } from "../src/from-mermaid.ts";
import { FSM, type TransitionObj } from "../src/fsm.ts";

Deno.test("simple state machine", () => {
	const mermaid = `stateDiagram-v2
    [*] --> OFF
    ON --> OFF: stop
    OFF --> ON: start
`;

	const config = fromMermaid<"ON" | "OFF", "start" | "stop">(mermaid);

	assertEquals(config.initial, "OFF");
	assertEquals(config.states.ON.on.stop, "OFF");
	assertEquals(config.states.OFF.on.start, "ON");
});

Deno.test("with guards and actions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> FETCHING: fetch
    FETCHING --> SUCCESS: resolve
    FETCHING --> RETRYING: reject [guard 1] / (action)
    FETCHING --> FAILED: reject [guard 2]
    RETRYING --> FETCHING: retry
    SUCCESS --> IDLE: reset
    FAILED --> IDLE: reset
`;

	const config = fromMermaid(mermaid);

	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.fetch, "FETCHING");
	assertEquals(config.states.FETCHING.on.resolve, "SUCCESS");

	// Check guarded array transitions
	const rejectTransitions = config.states.FETCHING.on.reject;
	assertEquals(Array.isArray(rejectTransitions), true);
	assertEquals(
		(rejectTransitions as TransitionObj<string, unknown>[]).length,
		2
	);

	const [first, second] = rejectTransitions as TransitionObj<string, unknown>[];
	assertEquals(first.target, "RETRYING");
	assertEquals(typeof first.guard, "function"); // placeholder function
	assertEquals(typeof first.action, "function"); // placeholder function

	assertEquals(second.target, "FAILED");
	assertEquals(typeof second.guard, "function"); // placeholder function
	assertEquals(second.action, undefined);
});

Deno.test("internal transitions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> PLAYING
    PLAYING --> PLAYING: volume_up / (action internal)
`;

	const config = fromMermaid(mermaid);

	assertEquals(config.initial, "PLAYING");

	const volumeUp = config.states.PLAYING.on.volume_up as TransitionObj<
		string,
		unknown
	>;
	assertEquals(typeof volumeUp, "object");
	assertEquals(volumeUp.target, undefined);
	assertEquals(typeof volumeUp.action, "function"); // placeholder function
});

Deno.test("wildcard transitions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> ACTIVE: start
    ACTIVE --> ERROR: * (any) / (action)
    ERROR --> IDLE: * (any)
`;

	const config = fromMermaid(mermaid);

	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.start, "ACTIVE");

	// Wildcard with action
	const activeWildcard = config.states.ACTIVE.on["*"] as TransitionObj<
		string,
		unknown
	>;
	assertEquals(typeof activeWildcard, "object");
	assertEquals(activeWildcard.target, "ERROR");
	assertEquals(typeof activeWildcard.action, "function"); // placeholder function

	// Wildcard without action
	assertEquals(config.states.ERROR.on["*"], "IDLE");
});

Deno.test("various label formats", () => {
	const mermaid = `stateDiagram-v2
    [*] --> A
    A --> B: simple
    B --> C: guarded [guarded]
    C --> D: with_action / (action)
    D --> E: guarded_action [guard 1] / (action)
    E --> A: reset
`;

	const config = fromMermaid(mermaid);

	assertEquals(config.initial, "A");
	assertEquals(config.states.A.on.simple, "B");

	const guarded = config.states.B.on.guarded as TransitionObj<string, unknown>;
	assertEquals(guarded.target, "C");
	assertEquals(typeof guarded.guard, "function"); // placeholder function

	const withAction = config.states.C.on.with_action as TransitionObj<
		string,
		unknown
	>;
	assertEquals(withAction.target, "D");
	assertEquals(typeof withAction.action, "function"); // placeholder function

	const guardedAction = config.states.D.on.guarded_action as TransitionObj<
		string,
		unknown
	>;
	assertEquals(guardedAction.target, "E");
	assertEquals(typeof guardedAction.guard, "function"); // placeholder function
	assertEquals(typeof guardedAction.action, "function"); // placeholder function
});

Deno.test("invalid: missing header", () => {
	const mermaid = `[*] --> A
    A --> B: go
`;

	assertThrows(
		() => fromMermaid(mermaid),
		Error,
		'must contain "stateDiagram-v2"'
	);
});

Deno.test("invalid: missing initial state", () => {
	const mermaid = `stateDiagram-v2
    A --> B: go
`;

	assertThrows(() => fromMermaid(mermaid), Error, "no initial state found");
});

Deno.test("empty lines and whitespace handling", () => {
	const mermaid = `stateDiagram-v2

    [*] --> A

    A --> B: go

`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "A");
	assertEquals(config.states.A.on.go, "B");
});

Deno.test("multiple guards numbered", () => {
	const mermaid = `stateDiagram-v2
    [*] --> A
    A --> B: event [guard 1]
    A --> C: event [guard 2]
    A --> D: event [guard 3]
`;

	const config = fromMermaid(mermaid);

	const transitions = config.states.A.on.event as TransitionObj<
		string,
		unknown
	>[];
	assertEquals(Array.isArray(transitions), true);
	assertEquals(transitions.length, 3);

	assertEquals(transitions[0].target, "B");
	assertEquals(transitions[1].target, "C");
	assertEquals(transitions[2].target, "D");
});

Deno.test("FSM.fromMermaid - static factory method", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> ACTIVE: start
    ACTIVE --> IDLE: stop
`;

	const fsm = FSM.fromMermaid<"IDLE" | "ACTIVE", "start" | "stop">(mermaid);

	assertEquals(fsm.state, "IDLE");
	assertEquals(fsm.config.initial, "IDLE");

	// Should be able to transition (though guards/actions are placeholders)
	fsm.transition("start");
	assertEquals(fsm.state, "ACTIVE");

	fsm.transition("stop");
	assertEquals(fsm.state, "IDLE");
});

Deno.test("roundtrip with toMermaid (simple)", () => {
	type STATES = "ON" | "OFF";
	type TRANSITIONS = "start" | "stop";

	const fsm1 = new FSM<STATES, TRANSITIONS>({
		initial: "OFF",
		states: {
			ON: {
				on: { stop: "OFF" },
			},
			OFF: {
				on: { start: "ON" },
			},
		},
	});

	const mermaid = fsm1.toMermaid();
	const config = fromMermaid<STATES, TRANSITIONS>(mermaid);

	assertEquals(config.initial, "OFF");
	assertEquals(config.states.ON.on.stop, "OFF");
	assertEquals(config.states.OFF.on.start, "ON");
});

Deno.test("roundtrip preserves structure (guarded)", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> FETCHING: fetch
    FETCHING --> SUCCESS: resolve
    FETCHING --> RETRYING: reject [guard 1] / (action)
    FETCHING --> FAILED: reject [guard 2]
`;

	const config1 = fromMermaid(mermaid);
	const fsm = new FSM(config1);
	const mermaid2 = fsm.toMermaid();
	const config2 = fromMermaid(mermaid2);

	// Structure should be preserved
	assertEquals(config2.initial, config1.initial);
	assertEquals(
		Array.isArray(config2.states.FETCHING.on.reject),
		Array.isArray(config1.states.FETCHING.on.reject)
	);
});

Deno.test("roundtrip with wildcards", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> ACTIVE: start
    ACTIVE --> ERROR: * (any) / (action)
    ERROR --> IDLE: * (any)
`;

	const config1 = fromMermaid(mermaid);

	// First parse should have action placeholder
	assertEquals(typeof config1.states.ACTIVE.on["*"], "object");
	assertEquals(
		typeof (config1.states.ACTIVE.on["*"] as TransitionObj<string, unknown>)
			.action,
		"function"
	);

	// toMermaid outputs the action since it's a function now
	const fsm = new FSM(config1);
	const mermaid2 = fsm.toMermaid();
	const config2 = fromMermaid(mermaid2);

	// After roundtrip, action structure is preserved
	assertEquals(config2.initial, "IDLE");
	assertEquals(config2.states.IDLE.on.start, "ACTIVE");
	// ACTIVE has action, so it stays as object
	const activeWildcard = config2.states.ACTIVE.on["*"] as TransitionObj<
		string,
		unknown
	>;
	assertEquals(activeWildcard.target, "ERROR");
	assertEquals(typeof activeWildcard.action, "function");
	// ERROR has no action, so it becomes simple string
	assertEquals(config2.states.ERROR.on["*"], "IDLE");
});

Deno.test("roundtrip with internal transitions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> PLAYING
    PLAYING --> PLAYING: volume_up / (action internal)
    PLAYING --> STOPPED: stop
`;

	const config1 = fromMermaid(mermaid);

	// First parse should have internal action structure
	const volumeUp = config1.states.PLAYING.on.volume_up as TransitionObj<
		string,
		unknown
	>;
	assertEquals(volumeUp.target, undefined);
	assertEquals(typeof volumeUp.action, "function"); // placeholder function

	// toMermaid outputs internal action marker since action is now a function
	const fsm = new FSM(config1);
	const mermaid2 = fsm.toMermaid();
	const config2 = fromMermaid(mermaid2);

	// After roundtrip, internal action structure is preserved
	assertEquals(config2.initial, "PLAYING");
	const volumeUp2 = config2.states.PLAYING.on.volume_up as TransitionObj<
		string,
		unknown
	>;
	assertEquals(volumeUp2.target, undefined); // Still internal (no target)
	assertEquals(typeof volumeUp2.action, "function");
	assertEquals(config2.states.PLAYING.on.stop, "STOPPED");
});

// =============================================================================
// Tests for ignoring non-FSM Mermaid features
// =============================================================================

Deno.test("ignores YAML frontmatter", () => {
	const mermaid = `---
config:
  layout: elk
  look: neo
---
stateDiagram-v2
    [*] --> IDLE
    IDLE --> ACTIVE: start
    ACTIVE --> IDLE: stop
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.start, "ACTIVE");
	assertEquals(config.states.ACTIVE.on.stop, "IDLE");
});

Deno.test("ignores comments", () => {
	const mermaid = `stateDiagram-v2
    %% This is a comment
    [*] --> IDLE
    %% Another comment about the transition
    IDLE --> ACTIVE: start
    %%{ init: { 'theme': 'dark' } }%%
    ACTIVE --> IDLE: stop
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.start, "ACTIVE");
	assertEquals(config.states.ACTIVE.on.stop, "IDLE");
});

Deno.test("ignores direction statements", () => {
	const mermaid = `stateDiagram-v2
    direction LR
    [*] --> OFF
    OFF --> ON: toggle
    ON --> OFF: toggle
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "OFF");
	assertEquals(config.states.OFF.on.toggle, "ON");
	assertEquals(config.states.ON.on.toggle, "OFF");
});

Deno.test("ignores styling (classDef, class, style)", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> ERROR: fail
    ERROR --> IDLE: reset

    classDef errorState fill:#f00,color:white
    class ERROR errorState
    style IDLE fill:#0f0
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.fail, "ERROR");
	assertEquals(config.states.ERROR.on.reset, "IDLE");
});

Deno.test("ignores state descriptions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    state "Waiting for input" as IDLE
    state "Processing request" as LOADING
    IDLE --> LOADING: submit
    LOADING --> IDLE: done
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.submit, "LOADING");
	assertEquals(config.states.LOADING.on.done, "IDLE");
});

Deno.test("ignores notes", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> ACTIVE: start
    note right of IDLE: This is the initial state
    note left of ACTIVE
        This is a multiline note
        about the active state
    end note
    ACTIVE --> IDLE: stop
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.start, "ACTIVE");
	assertEquals(config.states.ACTIVE.on.stop, "IDLE");
});

Deno.test("ignores final state transitions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> RUNNING: start
    RUNNING --> IDLE: stop
    RUNNING --> [*]
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.start, "RUNNING");
	assertEquals(config.states.RUNNING.on.stop, "IDLE");
	// The final state transition is ignored, no error thrown
});

Deno.test("ignores composite state syntax (braces only)", () => {
	// Note: transitions inside composite states ARE parsed as regular transitions.
	// Only the `state StateName {` and `}` lines are ignored.
	// This is intentional - inner transitions are still valid FSM transitions.
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> ACTIVE: start
    state ACTIVE {
    }
    ACTIVE --> IDLE: stop
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.start, "ACTIVE");
	assertEquals(config.states.ACTIVE.on.stop, "IDLE");
});

Deno.test("parses transitions inside composite state blocks", () => {
	// Transitions inside composite state blocks ARE parsed
	// (the braces are ignored but transitions are kept)
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> ACTIVE: start
    state ACTIVE {
        RUNNING --> PAUSED: pause
        PAUSED --> RUNNING: resume
    }
    ACTIVE --> IDLE: stop
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.start, "ACTIVE");
	assertEquals(config.states.ACTIVE.on.stop, "IDLE");
	// Inner transitions are parsed as regular transitions
	assertEquals(config.states.RUNNING.on.pause, "PAUSED");
	assertEquals(config.states.PAUSED.on.resume, "RUNNING");
});

Deno.test("complex diagram with multiple ignored features", () => {
	const mermaid = `stateDiagram-v2
    direction TB

    %% Traffic Light State Machine
    %% Author: Someone

    [*] --> RED

    state "Stop - Wait" as RED
    state "Prepare to go" as YELLOW
    state "Go!" as GREEN

    RED --> GREEN: timer
    GREEN --> YELLOW: timer
    YELLOW --> RED: timer

    %% Emergency override
    RED --> RED: emergency / (action internal)
    GREEN --> RED: emergency
    YELLOW --> RED: emergency

    GREEN --> [*]

    classDef danger fill:#f00,color:white
    classDef warning fill:#ff0,color:black
    classDef safe fill:#0f0,color:black

    class RED danger
    class YELLOW warning
    class GREEN safe

    note right of RED: All vehicles must stop
    note right of GREEN: Vehicles may proceed
`;

	const config = fromMermaid(mermaid);

	assertEquals(config.initial, "RED");
	assertEquals(config.states.RED.on.timer, "GREEN");
	assertEquals(config.states.GREEN.on.timer, "YELLOW");
	assertEquals(config.states.YELLOW.on.timer, "RED");

	// Internal transition for emergency on RED
	const emergency = config.states.RED.on.emergency as TransitionObj<
		string,
		unknown
	>;
	assertEquals(emergency.target, undefined);
	assertEquals(typeof emergency.action, "function"); // placeholder function

	// External transitions for emergency on other states
	assertEquals(config.states.GREEN.on.emergency, "RED");
	assertEquals(config.states.YELLOW.on.emergency, "RED");
});

Deno.test("ignores unknown/unrecognized lines gracefully", () => {
	const mermaid = `stateDiagram-v2
    [*] --> A
    some random text that is not valid mermaid
    A --> B: go
    this: is also: not: valid
    B --> A: back
    ---
    :::mermaid
`;

	const config = fromMermaid(mermaid);
	assertEquals(config.initial, "A");
	assertEquals(config.states.A.on.go, "B");
	assertEquals(config.states.B.on.back, "A");
});

Deno.test("extended guard notation with expressions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> CHECKING: submit
    CHECKING --> APPROVED: validate [guard amount < price]
    CHECKING --> REJECTED: validate [guard amount >= price]
    CHECKING --> PREMIUM: validate [guard user.isPremium && amount > 1000] / (action)
    APPROVED --> IDLE: reset
    REJECTED --> IDLE: reset
    PREMIUM --> IDLE: reset
`;

	const config = fromMermaid(mermaid);

	assertEquals(config.initial, "IDLE");
	assertEquals(config.states.IDLE.on.submit, "CHECKING");

	// Check guarded array transitions
	const validateTransitions = config.states.CHECKING.on
		.validate as TransitionObj<string, unknown>[];
	assertEquals(Array.isArray(validateTransitions), true);
	assertEquals(validateTransitions.length, 3);

	const [first, second, third] = validateTransitions;

	// First guard: amount < price
	assertEquals(first.target, "APPROVED");
	assertEquals(typeof first.guard, "function"); // placeholder function

	// Second guard: amount >= price
	assertEquals(second.target, "REJECTED");
	assertEquals(typeof second.guard, "function"); // placeholder function

	// Third guard with action: user.isPremium && amount > 1000
	assertEquals(third.target, "PREMIUM");
	assertEquals(typeof third.guard, "function"); // placeholder function
	assertEquals(typeof third.action, "function"); // placeholder function
});

Deno.test("toTypeScript generates valid TypeScript code", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> LOADING: fetch
    LOADING --> SUCCESS: resolve
    LOADING --> ERROR: reject [guard 1]
    LOADING --> ERROR: reject [guard 2] / (action)
    SUCCESS --> IDLE: reset
    ERROR --> IDLE: reset
`;

	const tsCode = toTypeScript(mermaid);

	// Check type definitions
	assertEquals(tsCode.includes('type States = "IDLE"'), true);
	assertEquals(tsCode.includes('"LOADING"'), true);
	assertEquals(tsCode.includes('"SUCCESS"'), true);
	assertEquals(tsCode.includes('"ERROR"'), true);
	assertEquals(tsCode.includes('type Transitions = "fetch"'), true);
	assertEquals(tsCode.includes('"resolve"'), true);
	assertEquals(tsCode.includes('"reject"'), true);
	assertEquals(tsCode.includes('"reset"'), true);
	assertEquals(tsCode.includes("type Context = { /* TODO:"), true);

	// Check config structure
	assertEquals(tsCode.includes("const config: FSMConfig<States, Transitions, Context>"), true);
	assertEquals(tsCode.includes('initial: "IDLE"'), true);

	// Check states
	assertEquals(tsCode.includes("IDLE: {"), true);
	assertEquals(tsCode.includes("LOADING: {"), true);
	assertEquals(tsCode.includes("SUCCESS: {"), true);
	assertEquals(tsCode.includes("ERROR: {"), true);

	// Check simple transition
	assertEquals(tsCode.includes('fetch: "LOADING"'), true);

	// Check guarded array transitions
	assertEquals(tsCode.includes("reject: ["), true);
	assertEquals(tsCode.includes('target: "ERROR"'), true);
	assertEquals(tsCode.includes("guard: (ctx) => true, // TODO:"), true);

	// Check action placeholder
	assertEquals(tsCode.includes("action: (ctx) => { /* TODO: [ACTION: action] */ }"), true);
});

Deno.test("toTypeScript respects custom options", () => {
	const mermaid = `stateDiagram-v2
    [*] --> OFF
    OFF --> ON: toggle
    ON --> OFF: toggle
`;

	const tsCode = toTypeScript(mermaid, { indent: "  ", configName: "myFsmConfig" });

	assertEquals(tsCode.includes("const myFsmConfig: FSMConfig"), true);
	// Check 2-space indentation is used
	assertEquals(tsCode.includes("  initial:"), true);
	assertEquals(tsCode.includes("  states:"), true);
});

Deno.test("toTypeScript handles wildcards", () => {
	const mermaid = `stateDiagram-v2
    [*] --> ACTIVE
    ACTIVE --> IDLE: stop
    ACTIVE --> ERROR: * (any)
`;

	const tsCode = toTypeScript(mermaid);

	assertEquals(tsCode.includes('"*": "ERROR"'), true);
});

Deno.test("toTypeScript handles internal transitions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> PLAYING
    PLAYING --> PLAYING: volumeUp / (action internal)
`;

	const tsCode = toTypeScript(mermaid);

	// Internal transition should have action but no target
	assertEquals(tsCode.includes("volumeUp: {"), true);
	assertEquals(tsCode.includes("action: (ctx) => { /* TODO: [ACTION: action] */ }"), true);
});

Deno.test("extended action notation with descriptions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> SAVING: save / (action persist to database)
    SAVING --> IDLE: done
    IDLE --> IDLE: log / (action internal)
    IDLE --> NOTIFY: alert / (action send email notification)
    NOTIFY --> IDLE: ack
`;

	const config = fromMermaid(mermaid);

	assertEquals(config.initial, "IDLE");

	// Check that action notations are preserved in toJSON
	const saveAction = config.states.IDLE.on.save as TransitionObj<string, unknown>;
	assertEquals(saveAction.target, "SAVING");
	assertEquals(typeof saveAction.action, "function");
	// The toJSON should include the description
	assertEquals(
		(saveAction.action as unknown as { toJSON: () => string }).toJSON(),
		"[ACTION: (action persist to database)]"
	);

	const alertAction = config.states.IDLE.on.alert as TransitionObj<string, unknown>;
	assertEquals(alertAction.target, "NOTIFY");
	assertEquals(
		(alertAction.action as unknown as { toJSON: () => string }).toJSON(),
		"[ACTION: (action send email notification)]"
	);

	// Internal action without description should have default
	const logAction = config.states.IDLE.on.log as TransitionObj<string, unknown>;
	assertEquals(logAction.target, undefined); // internal
	assertEquals(
		(logAction.action as unknown as { toJSON: () => string }).toJSON(),
		"[ACTION: action]"
	);
});

Deno.test("toTypeScript includes action descriptions in TODO comments", () => {
	const mermaid = `stateDiagram-v2
    [*] --> IDLE
    IDLE --> SAVING: save [guard isValid] / (action persist to database)
    SAVING --> IDLE: done
`;

	const tsCode = toTypeScript(mermaid);

	// Check that action description is in TODO
	assertEquals(
		tsCode.includes("action: (ctx) => { /* TODO: [ACTION: (action persist to database)] */ }"),
		true
	);
	// Check guard is also preserved
	assertEquals(tsCode.includes("guard: (ctx) => true, // TODO: [GUARD: [guard isValid]]"), true);
});
