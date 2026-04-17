import { assertEquals, assertThrows } from "@std/assert";
import { createClog, type Logger } from "@marianmeres/clog";
import { createFsm, FSM } from "../src/fsm.ts";

createClog.global.debug = false;

Deno.test("basic", () => {
	type STATES = "ON" | "OFF";
	type TRANSITIONS = "start" | "stop";

	const log: { current: string; previous: string | null; context: unknown }[] =
		[];

	const fsm = createFsm<STATES, TRANSITIONS>({
		initial: "OFF",
		states: {
			// in this example we have a little naming confusion:
			// "ON" as state name and "on" as conventional property for transition definitions
			ON: {
				on: { stop: "OFF" },
			},
			OFF: {
				on: { start: "ON" },
			},
		},
	});

	const unsub = fsm.subscribe((x) => log.push(x));

	assertEquals(log, [{ current: "OFF", previous: null, context: {} }]);

	assertEquals(fsm.state, "OFF");

	assertThrows(() => fsm.transition("stop"));

	assertEquals(fsm.transition("start"), "ON");

	assertThrows(() => fsm.transition("start"));

	assertEquals(log, [
		{ current: "OFF", previous: null, context: {} },
		{ current: "ON", previous: "OFF", context: {} },
	]);

	assertEquals(
		fsm.toMermaid(),
		`stateDiagram-v2
    [*] --> OFF
    ON --> OFF: stop
    OFF --> ON: start
`
	);

	unsub();
});

Deno.test("fetch retry definition", () => {
	type STATES = "IDLE" | "FETCHING" | "RETRYING" | "SUCCESS" | "FAILED";
	type TRANSITIONS = "fetch" | "resolve" | "reject" | "retry" | "reset";
	type CONTEXT = {
		attempts: number;
		maxRetries: number;
		data: unknown;
		error: unknown;
	};

	const log: string[] = [];

	const fsm = new FSM<STATES, TRANSITIONS, CONTEXT>({
		initial: "IDLE",
		context: {
			attempts: 0,
			maxRetries: 2,
			data: null,
			error: null,
		},
		states: {
			IDLE: {
				on: { fetch: "FETCHING" }, // simple string notation
			},
			FETCHING: {
				onEnter: (context) => {
					context.attempts += 1;
				},
				on: {
					resolve: { target: "SUCCESS" }, // as object without guard notation
					// array of objects notation - will resolve to first guard passing state
					reject: [
						{
							target: "RETRYING",
							guard: (ctx) => ctx.attempts < ctx.maxRetries,
							// Action executes specifically on this transition edge
							action: (ctx) => {
								log.push(`Attempt ${ctx.attempts} failed, retrying...`);
							},
						},
						{
							target: "FAILED",
							guard: (ctx) => ctx.attempts >= ctx.maxRetries,
						},
					],
				},
			},
			RETRYING: {
				on: { retry: "FETCHING" },
			},
			SUCCESS: {
				onEnter: (context, data) => {
					context.data = data;
				},
				on: { reset: "IDLE" },
			},
			FAILED: {
				onEnter: (context, error) => {
					context.error = error;
				},
				on: { reset: "IDLE" },
			},
		},
	});

	assertEquals(
		fsm.toMermaid(),
		`stateDiagram-v2
    [*] --> IDLE
    IDLE --> FETCHING: fetch
    FETCHING --> SUCCESS: resolve
    FETCHING --> RETRYING: reject [guard 1] / (action)
    FETCHING --> FAILED: reject [guard 2]
    RETRYING --> FETCHING: retry
    SUCCESS --> IDLE: reset
    FAILED --> IDLE: reset
`
	);

	assertEquals(fsm.is("IDLE"), true);

	assertEquals(fsm.transition("fetch"), "FETCHING");
	assertEquals(fsm.transition("reject"), "RETRYING");
	assertEquals(fsm.transition("retry"), "FETCHING");

	assertEquals(log, ["Attempt 1 failed, retrying..."]);

	// now must not be retrying anymore as the max retry 2 count was reached
	assertEquals(fsm.transition("reject", "some error"), "FAILED");

	// so retry is no more available
	assertThrows(() => fsm.transition("retry"));

	assertEquals(fsm.context, {
		attempts: 2,
		maxRetries: 2,
		data: null,
		error: "some error",
	});

	// reset works
	assertEquals(fsm.reset().is("IDLE"), true);
	fsm.transition("fetch");
	fsm.transition("resolve", { foo: "bar" });

	//
	assertEquals(fsm.context.attempts, 1);
	assertEquals(fsm.context.data, { foo: "bar" });
});

Deno.test("internal action (no target)", () => {
	type STATES = "PLAYING" | "PAUSED";
	type TRANSITIONS = "pause" | "volume_up";
	type CONTEXT = { volume: number };

	const log: string[] = [];

	const fsm = new FSM<STATES, TRANSITIONS, CONTEXT>({
		initial: "PLAYING",
		context: { volume: 5 },
		states: {
			PLAYING: {
				onEnter: () => log.push("enter:PLAYING"),
				onExit: () => log.push("exit:PLAYING"),
				on: {
					pause: "PAUSED",
					// internal transition: No 'target' defined
					volume_up: {
						action: (ctx) => {
							ctx.volume += 1;
							log.push(`volume:${ctx.volume}`);
						},
					},
				},
			},
			PAUSED: {
				on: {
					// external transition (re-entry): explicit 'target' defined
					// this SHOULD trigger exit/enter hooks
					volume_up: {
						target: "PAUSED",
						action: (ctx) => {
							ctx.volume += 1;
							log.push(`volume:${ctx.volume}`);
						},
					},
				},
			},
		},
	});

	// 1. internal transition (PLAYING)
	// action must run, but NO enter/exit logs
	assertEquals(fsm.transition("volume_up"), "PLAYING");
	assertEquals(fsm.context.volume, 6);
	assertEquals(log, ["volume:6"]);

	// 2. switch state to verify standard behavior
	fsm.transition("pause");
	assertEquals(fsm.state, "PAUSED");
	log.length = 0; // clear log

	// 3. external self-transition (PAUSED)
	// action must run, AND enter/exit logs run (because target is explicit)
	assertEquals(fsm.transition("volume_up"), "PAUSED");
	assertEquals(fsm.context.volume, 7);
	assertEquals(log, ["volume:7"]);

	//
	const mermaid = fsm.toMermaid();
	assertEquals(
		mermaid.includes("PLAYING --> PLAYING: volume_up / (action internal)"),
		true
	);
});

Deno.test("canTransition method", () => {
	type STATES = "IDLE" | "LOADING" | "SUCCESS" | "ERROR";
	type TRANSITIONS = "load" | "resolve" | "reject" | "reset";
	type CONTEXT = { attempts: number };

	const fsm = new FSM<STATES, TRANSITIONS, CONTEXT>({
		initial: "IDLE",
		context: { attempts: 0 },
		states: {
			IDLE: {
				on: { load: "LOADING" },
			},
			LOADING: {
				on: {
					resolve: "SUCCESS",
					// guarded transition
					reject: [
						{
							target: "ERROR",
							guard: (ctx) => ctx.attempts < 3,
						},
						{
							target: "IDLE",
							guard: (ctx) => ctx.attempts >= 3,
						},
					],
				},
			},
			SUCCESS: {
				on: { reset: "IDLE" },
			},
			ERROR: {
				on: { reset: "IDLE" },
			},
		},
	});

	// Check valid transitions
	assertEquals(fsm.is("IDLE"), true);
	assertEquals(fsm.canTransition("load"), true);
	assertEquals(fsm.canTransition("resolve"), false);
	assertEquals(fsm.canTransition("reject"), false);

	// Move to LOADING state
	fsm.transition("load");
	assertEquals(fsm.is("LOADING"), true);
	assertEquals(fsm.canTransition("load"), false);
	assertEquals(fsm.canTransition("resolve"), true);
	assertEquals(fsm.canTransition("reject"), true); // first guard passes

	// Test guard evaluation with payload
	fsm.context.attempts = 3;
	assertEquals(fsm.canTransition("reject"), true); // second guard passes

	fsm.context.attempts = 10;
	assertEquals(fsm.canTransition("reject"), true); // second guard still passes
});

Deno.test("wildcard transitions", () => {
	type STATES = "IDLE" | "ACTIVE" | "ERROR";
	type TRANSITIONS = "start" | "stop" | "crash" | "unknown";

	const log: string[] = [];

	const fsm = new FSM<STATES, TRANSITIONS>({
		initial: "IDLE",
		states: {
			IDLE: {
				on: {
					start: "ACTIVE",
				},
			},
			ACTIVE: {
				onExit: () => log.push("exit:ACTIVE"),
				on: {
					stop: "IDLE",
					// Wildcard catches any other transition
					"*": {
						target: "ERROR",
						action: () => log.push("wildcard triggered"),
					},
				},
			},
			ERROR: {
				on: {
					"*": "IDLE", // simple wildcard to IDLE
				},
			},
		},
	});

	assertEquals(fsm.is("IDLE"), true);

	// Normal transition
	fsm.transition("start");
	assertEquals(fsm.is("ACTIVE"), true);

	// Wildcard catches "crash" which isn't explicitly defined
	fsm.transition("crash");
	assertEquals(fsm.is("ERROR"), true);
	assertEquals(log, ["exit:ACTIVE", "wildcard triggered"]);

	// Wildcard in ERROR state catches anything
	fsm.transition("unknown");
	assertEquals(fsm.is("IDLE"), true);

	// Specific transitions take priority over wildcard
	fsm.transition("start");
	assertEquals(fsm.is("ACTIVE"), true);
	fsm.transition("stop"); // specific "stop" transition
	assertEquals(fsm.is("IDLE"), true);

	// Check mermaid output shows wildcard properly
	const mermaid = fsm.toMermaid();
	assertEquals(mermaid.includes("* (any)"), true);
	assertEquals(mermaid.includes("ACTIVE --> ERROR: * (any) / (action)"), true);
	assertEquals(mermaid.includes("ERROR --> IDLE: * (any)"), true);
});

Deno.test("canTransition with wildcards", () => {
	type STATES = "A" | "B";
	type TRANSITIONS = "go" | "anything";

	const fsm = new FSM<STATES, TRANSITIONS>({
		initial: "A",
		states: {
			A: {
				on: {
					go: "B",
				},
			},
			B: {
				on: {
					"*": "A",
				},
			},
		},
	});

	// State A: only "go" is valid
	assertEquals(fsm.canTransition("go"), true);
	assertEquals(fsm.canTransition("anything"), false);

	// Move to state B
	fsm.transition("go");
	assertEquals(fsm.is("B"), true);

	// State B: wildcard catches everything
	assertEquals(fsm.canTransition("go"), true);
	assertEquals(fsm.canTransition("anything"), true);
});

// =============================================================================
// v3 behavior tests
// =============================================================================

Deno.test("v3: constructor validates initial state exists", () => {
	// deno-lint-ignore no-explicit-any
	const badConfig: any = {
		initial: "MISSING",
		states: { IDLE: { on: {} } },
	};
	assertThrows(
		() => new FSM(badConfig),
		Error,
		'initial state "MISSING" is not defined in states'
	);
});

Deno.test("v3: constructor validates transition targets exist", () => {
	// deno-lint-ignore no-explicit-any
	const badConfig: any = {
		initial: "A",
		states: { A: { on: { go: "MISSING" } } },
	};
	assertThrows(
		() => new FSM(badConfig),
		Error,
		'transition "go" in state "A" targets unknown state "MISSING"'
	);
});

Deno.test("v3: constructor validates array transition targets", () => {
	// deno-lint-ignore no-explicit-any
	const badConfig: any = {
		initial: "A",
		states: { A: { on: { go: [{ target: "MISSING" }] } } },
	};
	assertThrows(
		() => new FSM(badConfig),
		Error,
		'transition "go" in state "A" targets unknown state "MISSING"'
	);
});

Deno.test("v3: config is deeply frozen after construction", () => {
	const fsm = new FSM<"A" | "B", "go">({
		initial: "A",
		states: {
			A: { on: { go: "B" } },
			B: { on: {} },
		},
	});

	// Top-level should be frozen
	assertEquals(Object.isFrozen(fsm.config), true);
	// Nested objects should be frozen too
	assertEquals(Object.isFrozen(fsm.config.states), true);
	assertEquals(Object.isFrozen(fsm.config.states.A), true);
	assertEquals(Object.isFrozen(fsm.config.states.A.on), true);
});

Deno.test("v3: PublishedState includes context", () => {
	type CTX = { value: number };
	const fsm = new FSM<"A", "go", CTX>({
		initial: "A",
		context: { value: 42 },
		states: { A: { on: { go: "A" } } },
	});

	let received: { current: string; previous: string | null; context: CTX } | null =
		null;
	fsm.subscribe((data) => {
		received = data;
	});

	assertEquals(received !== null, true);
	assertEquals(received!.current, "A");
	assertEquals(received!.context.value, 42);
});

Deno.test("v3: reset() runs onExit and onEnter hooks", () => {
	type STATES = "IDLE" | "ACTIVE";
	const log: string[] = [];

	const fsm = new FSM<STATES, "start">({
		initial: "IDLE",
		states: {
			IDLE: {
				onEnter: () => log.push("enter:IDLE"),
				onExit: () => log.push("exit:IDLE"),
				on: { start: "ACTIVE" },
			},
			ACTIVE: {
				onEnter: () => log.push("enter:ACTIVE"),
				onExit: () => log.push("exit:ACTIVE"),
				on: {},
			},
		},
	});

	fsm.transition("start");
	assertEquals(log, ["exit:IDLE", "enter:ACTIVE"]);

	log.length = 0;
	fsm.reset();
	// reset runs onExit on current (ACTIVE), then onEnter on initial (IDLE)
	assertEquals(log, ["exit:ACTIVE", "enter:IDLE"]);
});

Deno.test("v3: transition returns null on failure with assert=false", () => {
	const fsm = new FSM<"A" | "B", "go" | "missing">({
		initial: "A",
		states: {
			A: { on: { go: "B" } },
			B: { on: {} },
		},
	});

	// Failure returns null (not the current state)
	const result = fsm.transition("missing", undefined, false);
	assertEquals(result, null);
	assertEquals(fsm.state, "A");

	// Success returns the new state
	assertEquals(fsm.transition("go", undefined, false), "B");
});

Deno.test("v3: deep clone of plain-object context on init", () => {
	type CTX = { nested: { value: number } };
	const original = { nested: { value: 1 } };

	const fsm = new FSM<"A", "go", CTX>({
		initial: "A",
		context: original,
		states: { A: { on: { go: "A" } } },
	});

	// Mutating fsm.context.nested must not leak back to original
	fsm.context.nested.value = 999;
	assertEquals(original.nested.value, 1);

	// reset() restores nested defaults
	fsm.reset();
	assertEquals(fsm.context.nested.value, 1);
});

Deno.test("v3: wildcard fallback fires when specific guard rejects", () => {
	type STATES = "A" | "B" | "C";
	const fsm = new FSM<STATES, "go">({
		initial: "A",
		states: {
			A: {
				on: {
					go: { target: "B", guard: () => false }, // always rejects
					"*": "C", // wildcard fallback
				},
			},
			B: { on: {} },
			C: { on: {} },
		},
	});

	// Specific guard rejects → wildcard fires → C
	assertEquals(fsm.transition("go"), "C");
});

Deno.test("v3: canTransition uses wildcard fallback when specific guard rejects", () => {
	type STATES = "A" | "B" | "C";
	const fsm = new FSM<STATES, "go">({
		initial: "A",
		states: {
			A: {
				on: {
					go: { target: "B", guard: () => false },
					"*": "C",
				},
			},
			B: { on: {} },
			C: { on: {} },
		},
	});

	// canTransition should reflect that the wildcard rescues us
	assertEquals(fsm.canTransition("go"), true);
});

Deno.test("v3: onEnter throw still notifies subscribers", () => {
	type STATES = "A" | "B";
	const log: { current: string }[] = [];

	const fsm = new FSM<STATES, "go">({
		initial: "A",
		states: {
			A: { on: { go: "B" } },
			B: {
				onEnter: () => {
					throw new Error("boom");
				},
				on: {},
			},
		},
	});

	fsm.subscribe(({ current }) => log.push({ current }));
	log.length = 0; // drop initial

	assertThrows(() => fsm.transition("go"), Error, "onEnter");

	// State is committed, subscribers notified, even though onEnter threw
	assertEquals(fsm.state, "B");
	assertEquals(log.length, 1);
	assertEquals(log[0].current, "B");
});

Deno.test("v3: guard throw is wrapped with diagnostic context", () => {
	const fsm = new FSM<"A" | "B", "go">({
		initial: "A",
		states: {
			A: {
				on: {
					go: {
						target: "B",
						guard: () => {
							throw new Error("inner");
						},
					},
				},
			},
			B: { on: {} },
		},
	});

	assertThrows(() => fsm.transition("go"), Error, 'guard for "go" in state "A"');
});

Deno.test("v3: action throw is wrapped with diagnostic context", () => {
	const fsm = new FSM<"A" | "B", "go">({
		initial: "A",
		states: {
			A: {
				on: {
					go: {
						target: "B",
						action: () => {
							throw new Error("inner");
						},
					},
				},
			},
			B: { on: {} },
		},
	});

	assertThrows(() => fsm.transition("go"), Error, 'action for "go" in state "A"');
	// Action threw before state change → state unchanged
	assertEquals(fsm.state, "A");
});

Deno.test("v3: matches() helper", () => {
	const fsm = new FSM<"A" | "B" | "C", "go">({
		initial: "A",
		states: {
			A: { on: { go: "B" } },
			B: { on: { go: "C" } },
			C: { on: {} },
		},
	});

	assertEquals(fsm.matches("A"), true);
	assertEquals(fsm.matches("A", "B"), true);
	assertEquals(fsm.matches("B", "C"), false);
});

Deno.test("v3: cannot() helper", () => {
	const fsm = new FSM<"A" | "B", "go" | "stop">({
		initial: "A",
		states: {
			A: { on: { go: "B" } },
			B: { on: {} },
		},
	});

	assertEquals(fsm.cannot("stop"), true);
	assertEquals(fsm.cannot("go"), false);
});

Deno.test("v3: getSnapshot() returns deep clone of context", () => {
	type CTX = { nested: { count: number } };
	const fsm = new FSM<"A", "go", CTX>({
		initial: "A",
		context: { nested: { count: 1 } },
		states: { A: { on: { go: "A" } } },
	});

	const snap = fsm.getSnapshot();
	assertEquals(snap.state, "A");
	assertEquals(snap.previous, null);
	assertEquals(snap.context.nested.count, 1);

	// Mutating snapshot context must not affect FSM
	snap.context.nested.count = 999;
	assertEquals(fsm.context.nested.count, 1);
});

Deno.test("v3: previous getter exposes prior state", () => {
	const fsm = new FSM<"A" | "B", "go">({
		initial: "A",
		states: {
			A: { on: { go: "B" } },
			B: { on: {} },
		},
	});

	assertEquals(fsm.previous, null);
	fsm.transition("go");
	assertEquals(fsm.previous, "A");
});

Deno.test("v3: toMermaid renders [guarded] for unindexed single guard", () => {
	const fsm = new FSM<"A" | "B", "go">({
		initial: "A",
		states: {
			A: { on: { go: { target: "B", guard: () => true } } },
			B: { on: {} },
		},
	});

	const out = fsm.toMermaid();
	assertEquals(out.includes("A --> B: go [guarded]"), true);
	// No phantom "[guard -1]" anywhere
	assertEquals(out.includes("[guard -1]"), false);
});

Deno.test("v3: toMermaid omits [guard N] for unguarded array entries", () => {
	const fsm = new FSM<"A" | "B" | "C", "go">({
		initial: "A",
		states: {
			A: {
				on: {
					go: [
						{ target: "B", guard: () => false },
						{ target: "C" }, // no guard
					],
				},
			},
			B: { on: {} },
			C: { on: {} },
		},
	});

	const out = fsm.toMermaid();
	// First entry has guard → guard 1
	assertEquals(out.includes("A --> B: go [guard 1]"), true);
	// Second entry has no guard → no "[guard 2]"
	assertEquals(out.includes("A --> C: go\n"), true);
	assertEquals(out.includes("A --> C: go [guard 2]"), false);
});

Deno.test("custom logger with debug mode", () => {
	type STATES = "IDLE" | "ACTIVE";
	type TRANSITIONS = "start" | "stop";

	const debugLog: string[] = [];

	// Custom logger that captures debug messages
	const customLogger: Logger = {
		debug: (...args: unknown[]) => {
			debugLog.push(args.map(String).join(" "));
			return String(args[0] ?? "");
		},
		log: (...args: unknown[]) => String(args[0] ?? ""),
		warn: (...args: unknown[]) => String(args[0] ?? ""),
		error: (...args: unknown[]) => String(args[0] ?? ""),
	};

	const fsm = new FSM<STATES, TRANSITIONS>({
		initial: "IDLE",
		logger: customLogger,
		states: {
			IDLE: { on: { start: "ACTIVE" } },
			ACTIVE: { on: { stop: "IDLE" } },
		},
	});

	// Constructor logs creation
	assertEquals(debugLog.length >= 1, true);
	assertEquals(debugLog[0].includes("FSM created"), true);

	// Clear log and test transition
	debugLog.length = 0;
	fsm.transition("start");

	// Should have logged transition info
	assertEquals(debugLog.length >= 1, true);
	assertEquals(
		debugLog.some((msg) => msg.includes("'start' transition")),
		true
	);

	// Test canTransition logging
	debugLog.length = 0;
	fsm.canTransition("stop");
	assertEquals(
		debugLog.some((msg) => msg.includes("'stop' can trigger")),
		true
	);

	// Test reset logging
	debugLog.length = 0;
	fsm.reset();
	assertEquals(
		debugLog.some((msg) => msg.includes("Resetting FSM")),
		true
	);
});
