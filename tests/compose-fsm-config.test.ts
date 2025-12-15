import { assertEquals, assertThrows } from "@std/assert";
import { createFsm } from "../src/fsm.ts";
import {
	composeFsmConfig,
	type FSMConfigFragment,
} from "../src/compose-fsm-config.ts";
import { createClog } from "@marianmeres/clog";

createClog.global.debug = false;

Deno.test("basic merge of two fragments", () => {
	type STATES = "IDLE" | "RUNNING" | "STOPPED";
	type TRANSITIONS = "start" | "stop" | "pause";

	const core: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "IDLE",
		states: {
			IDLE: { on: { start: "RUNNING" } },
			RUNNING: { on: { stop: "STOPPED" } },
		},
	};

	const extension: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		states: {
			RUNNING: { on: { pause: "IDLE" } }, // add transition to existing state
			STOPPED: { on: { start: "RUNNING" } }, // add new state
		},
	};

	const config = composeFsmConfig([core, extension]);

	assertEquals(config.initial, "IDLE");
	assertEquals(Object.keys(config.states).sort(), [
		"IDLE",
		"RUNNING",
		"STOPPED",
	]);

	// RUNNING should have both stop and pause
	assertEquals(config.states.RUNNING.on.stop, "STOPPED");
	assertEquals(config.states.RUNNING.on.pause, "IDLE");

	// Create FSM and test it works
	const fsm = createFsm(config);
	assertEquals(fsm.state, "IDLE");
	fsm.transition("start");
	assertEquals(fsm.state, "RUNNING");
	fsm.transition("pause"); // from extension
	assertEquals(fsm.state, "IDLE");
});

Deno.test("conditional fragments (falsy filtering)", () => {
	type STATES = "A" | "B" | "C";
	type TRANSITIONS = "go" | "extra";

	const core: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "A",
		states: {
			A: { on: { go: "B" } },
			B: { on: { go: "A" } },
		},
	};

	const featureEnabled = false;
	const featureFragment: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		states: {
			B: { on: { extra: "C" } },
			C: { on: { go: "A" } },
		},
	};

	// Conditional inclusion - feature is disabled
	const config = composeFsmConfig([core, featureEnabled && featureFragment]);

	// C should not exist
	assertEquals(Object.keys(config.states).sort(), ["A", "B"]);
	assertEquals(config.states.B.on.extra, undefined);
});

Deno.test("with options", () => {
	type STATES = "X" | "Y";
	type TRANSITIONS = "toggle";

	const f1: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "X",
		states: { X: { on: { toggle: "Y" } } },
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		states: { Y: { on: { toggle: "X" } } },
	};

	const config = composeFsmConfig([f1, f2], { hooks: "replace" });

	assertEquals(config.initial, "X");
	assertEquals(config.states.X.on.toggle, "Y");
	assertEquals(config.states.Y.on.toggle, "X");
});

Deno.test("hooks replace mode (default)", () => {
	type STATES = "A";
	type TRANSITIONS = "loop";
	type CTX = { log: string[] };

	const f1: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "A",
		states: {
			A: {
				on: { loop: "A" },
				onEnter: (ctx) => ctx.log.push("f1-enter"),
			},
		},
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		states: {
			A: {
				on: {},
				onEnter: (ctx) => ctx.log.push("f2-enter"),
			},
		},
	};

	const config = composeFsmConfig([f1, f2]);
	const fsm = createFsm<STATES, TRANSITIONS, CTX>({
		...config,
		context: () => ({ log: [] }),
	});

	fsm.transition("loop");
	// In replace mode, only f2's hook should run
	assertEquals(fsm.context.log, ["f2-enter"]);
});

Deno.test("hooks compose mode", () => {
	type STATES = "A";
	type TRANSITIONS = "loop";
	type CTX = { log: string[] };

	const f1: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "A",
		states: {
			A: {
				on: { loop: "A" },
				onEnter: (ctx) => ctx.log.push("f1-enter"),
				onExit: (ctx) => ctx.log.push("f1-exit"),
			},
		},
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		states: {
			A: {
				on: {},
				onEnter: (ctx) => ctx.log.push("f2-enter"),
				onExit: (ctx) => ctx.log.push("f2-exit"),
			},
		},
	};

	const config = composeFsmConfig([f1, f2], { hooks: "compose" });
	const fsm = createFsm<STATES, TRANSITIONS, CTX>({
		...config,
		context: () => ({ log: [] }),
	});

	fsm.transition("loop");
	// In compose mode, both hooks should run in order
	assertEquals(fsm.context.log, ["f1-exit", "f2-exit", "f1-enter", "f2-enter"]);
});

Deno.test("onConflict error mode", () => {
	type STATES = "A" | "B";
	type TRANSITIONS = "go";

	const f1: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "A",
		states: { A: { on: { go: "B" } } },
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "B", // conflict!
		states: { B: { on: { go: "A" } } },
	};

	assertThrows(
		() => composeFsmConfig([f1, f2], { onConflict: "error" }),
		Error,
		"Conflict: multiple fragments define different 'initial' values"
	);
});

Deno.test("onConflict last-wins mode (default)", () => {
	type STATES = "A" | "B";
	type TRANSITIONS = "go";

	const f1: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "A",
		states: { A: { on: { go: "B" } } },
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "B",
		states: { B: { on: { go: "A" } } },
	};

	const config = composeFsmConfig([f1, f2]);
	assertEquals(config.initial, "B"); // f2 wins
});

Deno.test("throws if no fragments", () => {
	assertThrows(
		() => composeFsmConfig([]),
		Error,
		"composeFsmConfig requires at least one valid fragment"
	);
});

Deno.test("throws if all fragments are falsy", () => {
	assertThrows(
		() => composeFsmConfig([null, undefined, false]),
		Error,
		"composeFsmConfig requires at least one valid fragment"
	);
});

Deno.test("throws if no initial defined", () => {
	type STATES = "A";
	type TRANSITIONS = "go";

	const fragment: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		states: { A: { on: { go: "A" } } },
	};

	assertThrows(
		() => composeFsmConfig([fragment]),
		Error,
		"no 'initial' state defined"
	);
});

Deno.test("context merge mode (default)", () => {
	type STATES = "A";
	type TRANSITIONS = "go";
	type CTX = { a: number; b: number; shared: string };

	const f1: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "A",
		context: { a: 1, shared: "from-f1" } as CTX,
		states: { A: { on: { go: "A" } } },
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		context: { b: 2, shared: "from-f2" } as CTX,
		states: {},
	};

	const config = composeFsmConfig([f1, f2]);
	const fsm = createFsm(config);

	// Both fragments' context properties are merged
	assertEquals(fsm.context.a, 1);
	assertEquals(fsm.context.b, 2);
	// Conflicting keys: later fragment wins
	assertEquals(fsm.context.shared, "from-f2");
});

Deno.test("context merge mode with factory functions", () => {
	type STATES = "A";
	type TRANSITIONS = "go";
	type CTX = { a: number; b: number };

	const f1: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "A",
		context: () => ({ a: 1 } as CTX),
		states: { A: { on: { go: "A" } } },
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		context: { b: 2 } as CTX, // static object mixed with factory
		states: {},
	};

	const config = composeFsmConfig([f1, f2]);
	const fsm = createFsm(config);

	// Both merged: factory called + static merged
	assertEquals(fsm.context.a, 1);
	assertEquals(fsm.context.b, 2);

	// Reset should produce fresh merged context
	fsm.context.a = 999;
	fsm.reset();
	assertEquals(fsm.context.a, 1);
});

Deno.test("context replace mode", () => {
	type STATES = "A";
	type TRANSITIONS = "go";
	type CTX = { value: number };

	const f1: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "A",
		context: { value: 1 },
		states: { A: { on: { go: "A" } } },
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		context: { value: 42 },
		states: {},
	};

	const config = composeFsmConfig([f1, f2], { context: "replace" });
	const fsm = createFsm(config);
	// In replace mode, only last context is used
	assertEquals(fsm.context.value, 42);
});

Deno.test("real-world example: feature branches", () => {
	type STATES = "IDLE" | "LOADING" | "SUCCESS" | "ERROR" | "RETRYING";
	type TRANSITIONS = "fetch" | "resolve" | "reject" | "retry" | "reset";
	type CTX = { attempts: number; maxRetries: number; data: unknown };

	// Core fetch flow
	const coreFetch: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "IDLE",
		context: { attempts: 0, maxRetries: 3, data: null },
		states: {
			IDLE: {
				on: { fetch: "LOADING" },
			},
			LOADING: {
				on: {
					resolve: "SUCCESS",
					reject: "ERROR",
				},
			},
			SUCCESS: {
				on: { reset: "IDLE" },
			},
			ERROR: {
				on: { reset: "IDLE" },
			},
		},
	};

	// Optional retry feature
	const retryFeature: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		states: {
			ERROR: {
				on: {
					retry: {
						target: "RETRYING",
						guard: (ctx) => ctx.attempts < ctx.maxRetries,
						action: (ctx) => ctx.attempts++,
					},
				},
			},
			RETRYING: {
				on: {
					resolve: "SUCCESS",
					reject: "ERROR",
				},
				onEnter: (ctx) => {
					// In real app: trigger re-fetch
					console.log(`Retry attempt ${ctx.attempts}`);
				},
			},
		},
	};

	const enableRetry = true;
	const config = composeFsmConfig([coreFetch, enableRetry && retryFeature]);

	const fsm = createFsm(config);

	// Test the flow
	assertEquals(fsm.state, "IDLE");
	fsm.transition("fetch");
	assertEquals(fsm.state, "LOADING");
	fsm.transition("reject");
	assertEquals(fsm.state, "ERROR");

	// Retry should work (from retryFeature)
	fsm.transition("retry");
	assertEquals(fsm.state, "RETRYING");
	assertEquals(fsm.context.attempts, 1);

	// Reset still works (from core)
	fsm.transition("reject");
	fsm.transition("reset");
	assertEquals(fsm.state, "IDLE");
});

Deno.test("transition override (later wins)", () => {
	type STATES = "A" | "B" | "C";
	type TRANSITIONS = "go";

	const f1: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "A",
		states: {
			A: { on: { go: "B" } },
			B: { on: {} },
		},
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		states: {
			A: { on: { go: "C" } }, // override f1's transition
			C: { on: {} },
		},
	};

	const config = composeFsmConfig([f1, f2]);
	const fsm = createFsm(config);

	fsm.transition("go");
	assertEquals(fsm.state, "C"); // f2's transition wins
});

Deno.test("transitions prepend mode - basic", () => {
	type STATES = "A" | "B" | "C";
	type TRANSITIONS = "go";
	type CTX = { authenticated: boolean };

	const base: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "A",
		context: { authenticated: true },
		states: {
			A: { on: { go: { target: "B", guard: () => true } } },
			B: { on: {} },
		},
	};

	const auth: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		states: {
			A: { on: { go: { target: "C", guard: (ctx) => !ctx.authenticated } } },
			C: { on: {} },
		},
	};

	const config = composeFsmConfig([base, auth], { transitions: "prepend" });

	// Auth's handler should be first (prepended)
	const handlers = config.states.A.on.go;
	assertEquals(Array.isArray(handlers), true);
	assertEquals((handlers as unknown[]).length, 2);
});

Deno.test("transitions prepend mode - auth gate pattern", () => {
	type STATES = "IDLE" | "PROCESSING" | "LOGIN_REQUIRED";
	type TRANSITIONS = "submit";
	type CTX = { authenticated: boolean };

	const base: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "IDLE",
		context: { authenticated: false },
		states: {
			IDLE: { on: { submit: "PROCESSING" } },
			PROCESSING: { on: {} },
		},
	};

	const authGate: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		states: {
			IDLE: {
				on: {
					submit: {
						target: "LOGIN_REQUIRED",
						guard: (ctx) => !ctx.authenticated,
					},
				},
			},
			LOGIN_REQUIRED: { on: {} },
		},
	};

	const config = composeFsmConfig([base, authGate], { transitions: "prepend" });
	const fsm = createFsm(config);

	// Not authenticated - should go to LOGIN_REQUIRED (auth guard runs first)
	fsm.transition("submit");
	assertEquals(fsm.state, "LOGIN_REQUIRED");
});

Deno.test("transitions append mode", () => {
	type STATES = "A" | "B" | "C";
	type TRANSITIONS = "go";
	type CTX = { flag: boolean };

	const base: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		initial: "A",
		context: { flag: true },
		states: {
			A: { on: { go: { target: "B", guard: (ctx) => ctx.flag } } },
			B: { on: {} },
		},
	};

	const fallback: FSMConfigFragment<STATES, TRANSITIONS, CTX> = {
		states: {
			A: { on: { go: "C" } }, // fallback with no guard
			C: { on: {} },
		},
	};

	const config = composeFsmConfig([base, fallback], { transitions: "append" });
	const fsm = createFsm(config);

	// Base guard passes, should go to B
	fsm.transition("go");
	assertEquals(fsm.state, "B");

	// Reset and change flag
	fsm.reset();
	fsm.context.flag = false;

	// Base guard fails, fallback (appended) should run
	fsm.transition("go");
	assertEquals(fsm.state, "C");
});

Deno.test("transitions replace mode (default) unchanged", () => {
	type STATES = "A" | "B" | "C";
	type TRANSITIONS = "go";

	const f1: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "A",
		states: { A: { on: { go: "B" } }, B: { on: {} } },
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		states: { A: { on: { go: "C" } }, C: { on: {} } },
	};

	// Default behavior (replace)
	const config = composeFsmConfig([f1, f2]);
	const fsm = createFsm(config);

	fsm.transition("go");
	assertEquals(fsm.state, "C"); // f2 replaced f1
});

Deno.test("transitions prepend with string and object mix", () => {
	type STATES = "A" | "B" | "C";
	type TRANSITIONS = "go";

	const f1: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		initial: "A",
		states: {
			A: { on: { go: "B" } }, // string form
			B: { on: {} },
		},
	};

	const f2: FSMConfigFragment<STATES, TRANSITIONS, unknown> = {
		states: {
			A: { on: { go: { target: "C", guard: () => false } } }, // object form
			C: { on: {} },
		},
	};

	const config = composeFsmConfig([f1, f2], { transitions: "prepend" });
	const fsm = createFsm(config);

	// f2's guard fails, f1's handler (now second) should execute
	fsm.transition("go");
	assertEquals(fsm.state, "B");
});
