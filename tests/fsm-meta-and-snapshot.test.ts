import { assertEquals, assertThrows } from "@std/assert";
import { createClog } from "@marianmeres/clog";
import { FSM, type FSMSnapshot } from "../src/fsm.ts";
import { composeFsmConfig } from "../src/compose-fsm-config.ts";

createClog.global.debug = false;

// ---------------------------------------------------------------------------
// Change 1 — per-state `meta`
// ---------------------------------------------------------------------------

Deno.test("meta: getStateMeta / getCurrentMeta retrieve config-defined meta", () => {
	type S = "A" | "B" | "C";
	type E = "go";
	type M = { kind: string; handler?: string };

	const fsm = new FSM<S, E>({
		initial: "A",
		states: {
			A: { meta: { kind: "decision" }, on: { go: "B" } },
			B: {
				meta: { kind: "effectful", handler: "doThing" },
				on: { go: "C" },
			},
			C: { on: {} }, // no meta
		},
	});

	assertEquals(fsm.getStateMeta<M>("A"), { kind: "decision" });
	assertEquals(fsm.getStateMeta<M>("B"), {
		kind: "effectful",
		handler: "doThing",
	});
	assertEquals(fsm.getStateMeta<M>("C"), undefined);

	// unknown state → undefined (no throw)
	assertEquals(fsm.getStateMeta<M>("ZZZ" as S), undefined);

	// current state convenience
	assertEquals(fsm.getCurrentMeta<M>(), { kind: "decision" });
	fsm.transition("go");
	assertEquals(fsm.getCurrentMeta<M>(), {
		kind: "effectful",
		handler: "doThing",
	});
	fsm.transition("go");
	assertEquals(fsm.getCurrentMeta<M>(), undefined);
});

Deno.test("meta: is deep-frozen as part of the config", () => {
	type S = "A";
	const fsm = new FSM<S, "noop">({
		initial: "A",
		states: { A: { meta: { kind: "decision", tags: ["x"] }, on: {} } },
	});

	const m = fsm.getStateMeta<{ kind: string; tags: string[] }>("A")!;
	// Top-level frozen
	assertThrows(() => {
		(m as { kind: string }).kind = "other";
	});
	// Nested frozen
	assertThrows(() => {
		m.tags.push("y");
	});
});

Deno.test("meta: survives composeFsmConfig with last-write-wins", () => {
	type S = "A" | "B";
	type M = { v: number; tag?: string };

	const fragmentA = {
		initial: "A" as S,
		states: {
			A: { meta: { v: 1, tag: "first" }, on: { go: "B" as S } },
			B: { meta: { v: 10 }, on: {} },
		},
	};
	const fragmentB = {
		// fragmentB updates A's meta but does NOT touch B's meta
		states: {
			A: { meta: { v: 2 } },
			// B is omitted entirely
		},
	};

	const cfg = composeFsmConfig<S, "go", unknown>([fragmentA, fragmentB]);
	const fsm = new FSM<S, "go">(cfg);

	// Last writer wins on A
	assertEquals(fsm.getStateMeta<M>("A"), { v: 2 });
	// B's meta is untouched
	assertEquals(fsm.getStateMeta<M>("B"), { v: 10 });
});

Deno.test("meta: a fragment omitting meta does NOT erase prior meta", () => {
	type S = "A";
	const fragmentA = {
		initial: "A" as S,
		states: { A: { meta: { v: 1 }, on: {} } },
	};
	// fragmentB defines A but omits meta entirely
	const fragmentB = { states: { A: { onEnter: () => {} } } };

	const cfg = composeFsmConfig<S, never, unknown>([fragmentA, fragmentB]);
	const fsm = new FSM<S, never>(cfg);

	assertEquals(fsm.getStateMeta<{ v: number }>("A"), { v: 1 });
});

Deno.test("meta: survives composition independently of transitions mode", () => {
	type S = "A" | "B";
	type E = "go";

	const baseFragment = {
		initial: "A" as S,
		states: {
			A: { meta: { v: 1 }, on: { go: "B" as S } },
			B: { on: {} },
		},
	};
	const overrideFragment = {
		states: { A: { meta: { v: 2 }, on: { go: "B" as S } } },
	};

	for (const mode of ["replace", "prepend", "append"] as const) {
		const cfg = composeFsmConfig<S, E, unknown>(
			[baseFragment, overrideFragment],
			{ transitions: mode }
		);
		const fsm = new FSM<S, E>(cfg);
		assertEquals(
			fsm.getStateMeta<{ v: number }>("A"),
			{ v: 2 },
			`meta should be merged independently of transitions mode (${mode})`
		);
	}
});

Deno.test("meta: getSnapshot does NOT include meta", () => {
	type S = "A";
	const fsm = new FSM<S, "noop">({
		initial: "A",
		context: { n: 1 },
		states: { A: { meta: { kind: "decision" }, on: {} } },
	});

	const snap = fsm.getSnapshot();
	assertEquals(Object.keys(snap).sort(), ["context", "previous", "state"]);
	assertEquals((snap as { meta?: unknown }).meta, undefined);
});

// ---------------------------------------------------------------------------
// Change 2 — FSM.fromSnapshot
// ---------------------------------------------------------------------------

type WfState = "IDLE" | "WORKING" | "DONE";
type WfEvent = "start" | "finish";
type WfContext = { count: number };

function buildConfig(opts?: {
	onEnterA?: () => void;
	onEnterB?: () => void;
	onEnterC?: () => void;
	onExitB?: () => void;
}) {
	return {
		initial: "IDLE" as WfState,
		context: { count: 0 } as WfContext,
		states: {
			IDLE: {
				onEnter: opts?.onEnterA,
				on: { start: "WORKING" as WfState },
			},
			WORKING: {
				onEnter: opts?.onEnterB,
				onExit: opts?.onExitB,
				on: {
					finish: {
						target: "DONE" as WfState,
						action: (c: WfContext) => {
							c.count++;
						},
					},
				},
			},
			DONE: { onEnter: opts?.onEnterC, on: {} },
		},
	};
}

Deno.test("fromSnapshot: round-trip equality", () => {
	const cfg = buildConfig();
	const fsm = new FSM<WfState, WfEvent, WfContext>(cfg);
	fsm.transition("start");
	fsm.transition("finish");

	const snap = fsm.getSnapshot();
	const restored = FSM.fromSnapshot<WfState, WfEvent, WfContext>(cfg, snap);

	assertEquals(restored.getSnapshot(), snap);
	assertEquals(restored.state, "DONE");
	assertEquals(restored.previous, "WORKING");
	assertEquals(restored.context, { count: 1 });
});

Deno.test("fromSnapshot: does NOT fire onEnter on the restored state", () => {
	let enterIdle = 0;
	let enterWorking = 0;
	let enterDone = 0;
	const cfg = buildConfig({
		onEnterA: () => enterIdle++,
		onEnterB: () => enterWorking++,
		onEnterC: () => enterDone++,
	});

	// Manually craft a snapshot to restore at WORKING — bypass the original
	// transition path entirely so we can be sure any onEnter count comes from
	// fromSnapshot itself, not from the run that produced the snapshot.
	const snap: FSMSnapshot<WfState, WfContext> = {
		state: "WORKING",
		previous: "IDLE",
		context: { count: 0 },
	};
	const restored = FSM.fromSnapshot<WfState, WfEvent, WfContext>(cfg, snap);

	assertEquals(restored.state, "WORKING");
	// No onEnter should have fired anywhere.
	assertEquals(enterIdle, 0);
	assertEquals(enterWorking, 0);
	assertEquals(enterDone, 0);
});

Deno.test("fromSnapshot: preserves previous (non-null and null)", () => {
	const cfg = buildConfig();

	// non-null previous
	const a = FSM.fromSnapshot<WfState, WfEvent, WfContext>(cfg, {
		state: "DONE",
		previous: "WORKING",
		context: { count: 5 },
	});
	assertEquals(a.previous, "WORKING");

	// null previous (e.g. resumed at the initial state with no prior history)
	const b = FSM.fromSnapshot<WfState, WfEvent, WfContext>(cfg, {
		state: "IDLE",
		previous: null,
		context: { count: 0 },
	});
	assertEquals(b.previous, null);
});

Deno.test("fromSnapshot: throws on unknown state", () => {
	const cfg = buildConfig();
	assertThrows(
		() =>
			FSM.fromSnapshot<WfState, WfEvent, WfContext>(cfg, {
				state: "BOGUS" as WfState,
				previous: null,
				context: { count: 0 },
			}),
		Error,
		`FSM: snapshot state "BOGUS" is not defined in states`
	);
});

Deno.test("fromSnapshot: throws on unknown non-null previous", () => {
	const cfg = buildConfig();
	assertThrows(
		() =>
			FSM.fromSnapshot<WfState, WfEvent, WfContext>(cfg, {
				state: "WORKING",
				previous: "BOGUS" as WfState,
				context: { count: 0 },
			}),
		Error,
		`FSM: snapshot previous "BOGUS" is not defined in states`
	);
});

Deno.test("fromSnapshot: post-restore transition behaves identically to normal flow", () => {
	let onExitWorking = 0;
	let onEnterDone = 0;
	const cfg = buildConfig({
		onExitB: () => onExitWorking++,
		onEnterC: () => onEnterDone++,
	});

	// Restore at WORKING with previous=IDLE and count=5.
	const restored = FSM.fromSnapshot<WfState, WfEvent, WfContext>(cfg, {
		state: "WORKING",
		previous: "IDLE",
		context: { count: 5 },
	});

	// Sanity: no hooks fired on restore.
	assertEquals(onExitWorking, 0);
	assertEquals(onEnterDone, 0);

	// Now drive the next transition — should run onExit(WORKING), action,
	// then onEnter(DONE), and update previous to "WORKING".
	const next = restored.transition("finish");
	assertEquals(next, "DONE");
	assertEquals(restored.state, "DONE");
	assertEquals(restored.previous, "WORKING");
	assertEquals(restored.context, { count: 6 });
	assertEquals(onExitWorking, 1);
	assertEquals(onEnterDone, 1);
});

Deno.test("fromSnapshot: post-restore subscribe fires immediately with restored state", () => {
	const cfg = buildConfig();
	const restored = FSM.fromSnapshot<WfState, WfEvent, WfContext>(cfg, {
		state: "WORKING",
		previous: "IDLE",
		context: { count: 7 },
	});

	const seen: { current: WfState; previous: WfState | null; context: WfContext }[] = [];
	const unsub = restored.subscribe((d) => seen.push(d));

	assertEquals(seen.length, 1);
	assertEquals(seen[0].current, "WORKING");
	assertEquals(seen[0].previous, "IDLE");
	assertEquals(seen[0].context, { count: 7 });

	unsub();
});

Deno.test("fromSnapshot: deep-clones context (external mutation does not leak in)", () => {
	const cfg = buildConfig();
	const externalSnap: FSMSnapshot<WfState, WfContext> = {
		state: "WORKING",
		previous: "IDLE",
		context: { count: 3 },
	};
	const restored = FSM.fromSnapshot<WfState, WfEvent, WfContext>(
		cfg,
		externalSnap
	);

	// Mutating the original snapshot's context must NOT affect the FSM.
	externalSnap.context.count = 999;
	assertEquals(restored.context, { count: 3 });
	// And the FSM's context object is a different reference too.
	if (restored.context === externalSnap.context) {
		throw new Error("context must be a separate reference");
	}
});

Deno.test("fromSnapshot: validates invalid config (parity with constructor)", () => {
	// Bad transition target — constructor would throw; fromSnapshot must too.
	assertThrows(
		() =>
			FSM.fromSnapshot<WfState, WfEvent, WfContext>(
				{
					initial: "IDLE",
					states: {
						IDLE: { on: { start: "GHOST" as WfState } },
						WORKING: { on: {} },
						DONE: { on: {} },
					},
				},
				{ state: "WORKING", previous: null, context: { count: 0 } }
			),
		Error,
		`targets unknown state "GHOST"`
	);
});

Deno.test("fromSnapshot: meta is available on the restored instance", () => {
	type M = { kind: string };
	const cfg = {
		initial: "A" as const,
		states: {
			A: { meta: { kind: "decision" }, on: { go: "B" as const } },
			B: { meta: { kind: "terminal" }, on: {} },
		},
	};
	const restored = FSM.fromSnapshot<"A" | "B", "go", unknown>(cfg, {
		state: "B",
		previous: "A",
		context: {},
	});
	assertEquals(restored.getCurrentMeta<M>(), { kind: "terminal" });
	assertEquals(restored.getStateMeta<M>("A"), { kind: "decision" });
});

