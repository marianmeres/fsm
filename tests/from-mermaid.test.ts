import { assertEquals, assertThrows } from "@std/assert";
import { fromMermaid } from "../src/from-mermaid.ts";
import { FSM } from "../src/fsm.ts";

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
	assertEquals((rejectTransitions as any).length, 2);

	const [first, second] = rejectTransitions as any[];
	assertEquals(first.target, "RETRYING");
	assertEquals(first.guard, null); // placeholder
	assertEquals(first.action, null); // placeholder

	assertEquals(second.target, "FAILED");
	assertEquals(second.guard, null); // placeholder
	assertEquals(second.action, undefined);
});

Deno.test("internal transitions", () => {
	const mermaid = `stateDiagram-v2
    [*] --> PLAYING
    PLAYING --> PLAYING: volume_up / (action internal)
`;

	const config = fromMermaid(mermaid);

	assertEquals(config.initial, "PLAYING");

	const volumeUp = config.states.PLAYING.on.volume_up;
	assertEquals(typeof volumeUp, "object");
	assertEquals((volumeUp as any).target, undefined);
	assertEquals((volumeUp as any).action, null); // placeholder
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
	const activeWildcard = config.states.ACTIVE.on["*"];
	assertEquals(typeof activeWildcard, "object");
	assertEquals((activeWildcard as any).target, "ERROR");
	assertEquals((activeWildcard as any).action, null); // placeholder

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

	const guarded = config.states.B.on.guarded;
	assertEquals((guarded as any).target, "C");
	assertEquals((guarded as any).guard, null);

	const withAction = config.states.C.on.with_action;
	assertEquals((withAction as any).target, "D");
	assertEquals((withAction as any).action, null);

	const guardedAction = config.states.D.on.guarded_action;
	assertEquals((guardedAction as any).target, "E");
	assertEquals((guardedAction as any).guard, null);
	assertEquals((guardedAction as any).action, null);
});

Deno.test("invalid: missing header", () => {
	const mermaid = `[*] --> A
    A --> B: go
`;

	assertThrows(
		() => fromMermaid(mermaid),
		Error,
		'must start with "stateDiagram-v2"'
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

	const transitions = config.states.A.on.event;
	assertEquals(Array.isArray(transitions), true);
	assertEquals((transitions as any[]).length, 3);

	assertEquals((transitions as any[])[0].target, "B");
	assertEquals((transitions as any[])[1].target, "C");
	assertEquals((transitions as any[])[2].target, "D");
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
	assertEquals((config1.states.ACTIVE.on["*"] as any).action, null);

	// toMermaid won't output the action since it's null, so roundtrip won't preserve it
	const fsm = new FSM(config1);
	const mermaid2 = fsm.toMermaid();
	const config2 = fromMermaid(mermaid2);

	// After roundtrip, the action info is lost (becomes simple string)
	assertEquals(config2.initial, "IDLE");
	assertEquals(config2.states.IDLE.on.start, "ACTIVE");
	assertEquals(config2.states.ACTIVE.on["*"], "ERROR"); // Now simple string
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
	assertEquals((config1.states.PLAYING.on.volume_up as any).target, undefined);
	assertEquals((config1.states.PLAYING.on.volume_up as any).action, null);

	// toMermaid won't output action marker when action is null
	// So internal transitions become regular self-transitions in roundtrip
	const fsm = new FSM(config1);
	const mermaid2 = fsm.toMermaid();
	const config2 = fromMermaid(mermaid2);

	// After roundtrip, becomes a simple self-transition (info is lost)
	assertEquals(config2.initial, "PLAYING");
	assertEquals(config2.states.PLAYING.on.volume_up, "PLAYING"); // Now simple string
	assertEquals(config2.states.PLAYING.on.stop, "STOPPED");
});
