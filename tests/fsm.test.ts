import { createFsm } from "../src/fsm.ts";
import { assertEquals, assertThrows } from "@std/assert";
import { omit } from "@std/collections";

type SwitchState = "ON" | "OFF";
type SwitchEvent = "toggle" | "start" | "stop";

Deno.test("basic flow, simple notation", () => {
	const log: any[] = [];
	const context = { foo: "bar" };

	const fsm = createFsm<SwitchState, SwitchEvent, typeof context>(
		"OFF",
		{
			ON: {
				stop: "OFF",
			},
			OFF: {
				start: "ON",
			},
			// will be available for every state
			"*": {
				toggle: (payload, meta) => {
					const { state, send } = meta;
					return state.current === "ON" ? send("stop") : send("start");
				},
			},
		},
		context,
		{ logger: null }
	);

	const unsub = fsm.subscribe((x) => log.push(x));

	// initial is OFF
	assertEquals(fsm.getCurrent(), "OFF");
	assertEquals(log, [{ current: "OFF", previous: null }]);

	// check current
	assertEquals(fsm.can("start"), true);
	assertEquals(fsm.can("stop"), false);
	assertEquals(fsm.can("xxx" as any), false); // unknown altogether

	// wildcard check
	assertEquals(fsm.can("toggle"), true);

	// fire BAD event (a.k.a initiate transition)
	assertThrows(() => fsm.send("stop"));

	// fire BAD event in non-strict silent mode (if needed)
	assertEquals(fsm.send("stop", null, false), "OFF");

	// fire CORRECT event (a.k.a initiate transition)
	assertEquals(fsm.send("start"), "ON");

	//
	assertEquals(fsm.getCurrent(), "ON");
	assertEquals(log, [
		{ current: "OFF", previous: null },
		{ current: "ON", previous: "OFF" },
	]);

	// now wilcard toggle
	assertEquals(fsm.send("toggle"), "OFF");
	assertEquals(fsm.getCurrent(), "OFF");
	assertEquals(fsm.send("toggle"), "ON");
	assertEquals(fsm.getCurrent(), "ON");

	// console.log(log);

	return unsub();
});

//
Deno.test("basic flow, entry, exit, full notation", () => {
	let log: any[] = [];
	const context = { counter: 0 };

	const fsm = createFsm<SwitchState, SwitchEvent, typeof context>(
		"OFF",
		{
			ON: {
				stop: (_payload, _meta) => "OFF",
				_exit: (_payload, metaWithSend) => {
					log.push(["ON._exit", omit(metaWithSend, ["send"])]);
				},
			},
			OFF: {
				start: {
					target: "ON",
					// allow two start only 2 times
					canTransition: (_payload, meta) => {
						log.push(["canTransition", meta]);
						return meta.context!.counter < 2;
					},
					effect: (_payload, meta) => {
						meta.context!.counter++;
						log.push(["effect", meta]);
					},
				},
				_entry: (_payload, metaWithSend) => {
					log.push(["OFF._entry", omit(metaWithSend, ["send"])]);
				},
			},
			"*": {
				toggle: {
					target: (_payload, metaWithSend) => {
						const { send, state } = metaWithSend;
						return state.current === "ON" ? send("stop") : send("start");
					},
				},
				_entry: (_payload, metaWithSend) => {
					log.push(["*._entry", omit(metaWithSend, ["send"])]);
				},
			},
		},
		context,
		{ logger: null }
	);

	const unsub = fsm.subscribe((x) => log.push(["subscription", x]));

	assertEquals(fsm.getCurrent(), "OFF");

	assertEquals(fsm.send("toggle", { some: "payload" }), "ON");

	// console.log(log);
	assertEquals(log, [
		// initial OFF
		["subscription", { current: "OFF", previous: null }],
		// OLD
		// start guard (note depth 2, because toggle +1 and start +1)
		[
			"canTransition",
			{
				state: { current: "OFF", previous: null },
				context: { counter: 1 },
				depth: 2,
			},
		],
		[
			"effect",
			{
				state: { current: "OFF", previous: null },
				context: { counter: 1 },
				depth: 2,
			},
		],
		// NEW: finally we are entering the new state
		[
			"*._entry",
			{
				state: { current: "ON", previous: "OFF" },
				context: { counter: 1 },
				depth: 2,
			},
		],
		// final reactivity notification
		["subscription", { current: "ON", previous: "OFF" }],
	]);

	//
	log = []; // reset log
	assertEquals(fsm.send("toggle", { some: "payload" }), "OFF");

	// console.log(log);
	assertEquals(log, [
		// OLD
		// note the ON._exit is logged twice with different depth (because toggle +1, stop +1)
		[
			"ON._exit",
			{
				state: { current: "ON", previous: "OFF" },
				context: { counter: 1 },
				depth: 1,
			},
		],
		[
			"ON._exit",
			{
				state: { current: "ON", previous: "OFF" },
				context: { counter: 1 },
				depth: 2,
			},
		],
		// NEW
		[
			"OFF._entry",
			{
				state: { current: "OFF", previous: "ON" },
				context: { counter: 1 },
				depth: 2,
			},
		],
		// final reactivity notification
		["subscription", { current: "OFF", previous: "ON" }],
	]);

	//
	assertEquals(context, { counter: 1 });

	// now, this must still work
	assertEquals(fsm.send("start"), "ON");

	// this again, because we're going OFF
	assertEquals(fsm.send("toggle"), "OFF");

	// not anymore, because GUARD in action, must not allow to start
	assertEquals(fsm.send("start"), "OFF");
	assertEquals(context, { counter: 2 });

	// more explicit... still OFF
	assertEquals(fsm.send("toggle"), "OFF");
	assertEquals(fsm.send("toggle"), "OFF");
	assertEquals(fsm.send("toggle"), "OFF");

	//
	assertEquals(context, { counter: 2 });

	return unsub();
});
