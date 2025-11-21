import { assertEquals, assertThrows } from "@std/assert";
import { createFsm, FSM } from "../src/fsm.ts";

Deno.test("basic", () => {
	type STATES = "ON" | "OFF";
	type TRANSITIONS = "start" | "stop";

	const log: any[] = [];

	const fsm = createFsm<STATES, TRANSITIONS>({
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
		data: any;
		error: any;
	};

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
				onEnter: (context: any) => {
					context.attempts += 1;
				},
				on: {
					resolve: { target: "SUCCESS" }, // as object without guard notation
					// array of objects notation - will resolve to first guard passing state
					reject: [
						{
							target: "RETRYING",
							guard: (ctx) => ctx.attempts < ctx.maxRetries,
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
    FETCHING --> RETRYING: reject [guard 1]
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
