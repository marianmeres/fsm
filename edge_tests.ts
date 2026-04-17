import { assertEquals } from "@std/assert";
import { FSM } from "./src/fsm.ts";
import { createClog } from "@marianmeres/clog";

createClog.global.debug = false;

// Test: Error in action - what happens to state?
Deno.test("ERROR IN ACTION: State is already mutated when action throws", () => {
    const log: string[] = [];
    
    const fsm = new FSM<"A" | "B", "go">({
        initial: "A",
        states: {
            A: {
                onExit: () => log.push("exit-A"),
                on: { go: "B" }
            },
            B: {
                onEnter: () => log.push("enter-B"),
                on: {}
            }
        }
    });

    try {
        // Override the transition to throw in action
        const config = fsm.config;
        config.states.A.on.go = {
            target: "B",
            action: () => {
                log.push("action-executing");
                throw new Error("Action failed");
            }
        };
        
        fsm.transition("go");
    } catch (e) {
        log.push(`caught: ${(e as Error).message}`);
    }
    
    console.log("State after error:", fsm.state);
    console.log("Log:", log);
});

// Test: onExit throws
Deno.test("ERROR IN onExit", () => {
    const log: string[] = [];
    
    const fsm = new FSM<"A" | "B", "go">({
        initial: "A",
        states: {
            A: {
                onExit: () => {
                    log.push("onExit-starting");
                    throw new Error("onExit failed");
                },
                on: { go: "B" }
            },
            B: {
                onEnter: () => log.push("enter-B"),
                on: {}
            }
        }
    });

    try {
        fsm.transition("go");
    } catch (e) {
        log.push(`caught: ${(e as Error).message}`);
    }
    
    console.log("State after onExit error:", fsm.state);
    console.log("Log:", log);
});

// Test: onEnter throws
Deno.test("ERROR IN onEnter", () => {
    const log: string[] = [];
    
    const fsm = new FSM<"A" | "B", "go">({
        initial: "A",
        states: {
            A: {
                onExit: () => log.push("exit-A"),
                on: { go: "B" }
            },
            B: {
                onEnter: () => {
                    log.push("enter-B-starting");
                    throw new Error("onEnter failed");
                },
                on: {}
            }
        }
    });

    try {
        fsm.transition("go");
    } catch (e) {
        log.push(`caught: ${(e as Error).message}`);
    }
    
    console.log("State after onEnter error:", fsm.state);
    console.log("Log:", log);
    console.log("CRITICAL: Subscribers see state B even though onEnter threw");
});

// Test: reset doesn't run hooks
Deno.test("RESET: Does reset run onExit/onEnter?", () => {
    const log: string[] = [];
    
    const fsm = new FSM<"A" | "B", "go" | "back">({
        initial: "A",
        states: {
            A: {
                onExit: () => log.push("exit-A"),
                on: { go: "B" }
            },
            B: {
                onEnter: () => log.push("enter-B"),
                onExit: () => log.push("exit-B"),
                on: { back: "A" }
            }
        }
    });

    fsm.transition("go");
    log.length = 0;
    
    fsm.reset();
    
    console.log("Hooks called during reset:", log);
    console.log("Note: No lifecycle hooks run during reset");
});

// Test: reset with nested objects
Deno.test("RESET: Shallow copy issue with nested objects", () => {
    const log: string[] = [];
    
    const plainObjFsm = new FSM<"A", "go">({
        initial: "A",
        context: { shared: { array: [1, 2, 3] } } as any,
        states: {
            A: {
                on: { go: "A" }
            }
        }
    });

    plainObjFsm.context.shared.array.push(4);
    plainObjFsm.reset();
    log.push(`Shallow copy: nested array still has 4 items: ${plainObjFsm.context.shared.array.length === 4}`);
    
    const factoryFsm = new FSM<"A", "go">({
        initial: "A",
        context: () => ({ shared: { array: [1, 2, 3] } }) as any,
        states: {
            A: {
                on: { go: "A" }
            }
        }
    });

    factoryFsm.context.shared.array.push(4);
    factoryFsm.reset();
    log.push(`Factory: nested array is fresh: ${factoryFsm.context.shared.array.length === 3}`);
    
    log.forEach(l => console.log(l));
});
