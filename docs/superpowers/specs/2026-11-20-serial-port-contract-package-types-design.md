# Design: type the port contract on the `@thingmate/node-web-serial` types

Date: 2026-11-20
Status: approved (conversation, follow-up to the package swap design)

## Intent and why

After the swap to `@thingmate/node-web-serial`, `src/serial-port-like/` became
a hand-maintained mirror of types the dependency already exports (`SerialPort`,
`SerialOptions`, `SerialOutputSignals`, `SerialInputSignals`,
`SerialPortInfo`). The six-to-four field alignment just performed is the
recurring maintenance tax of such a mirror. The package is the project owner's
own spec-faithful Web Serial implementation; the ecosystem should carry one
vocabulary for "a serial port".

## Goals

- Delete `src/serial-port-like/`; the library core imports the package's types
  (type-only imports, erased at runtime; the package is already a dependency).
- The test mock implements the full spec `SerialPort` interface.
- Pin the browser story: the DOM `SerialPort` (TypeScript 7 `lib.dom`; the
  project already treats TS 7 as the source of DOM serial types —
  `@types/w3c-web-serial` is a stub) satisfies the package's `SerialPort`.

## Non-goals

- No runtime behavior change anywhere in the library.
- No change to the `@thingmate/node-web-serial` package itself.

## Approaches considered

1. **Keep the `SerialPortLike` subset (rejected).** The mirror lives on; every
   spec evolution costs an edit here; the browser side stays unpinned.
2. **Adopt the package's types (chosen).** One vocabulary; spec evolution
   maintained upstream; the `break` signal becomes available through
   `SerialOutputSignals` for free; the browser claim becomes a type-level pin.

## Known costs (accepted)

- `MockSerialPort` grows the full interface surface: `extends EventTarget`,
  `connected`, `forget()`, `onconnect`/`ondisconnect` (~15 lines, once).
- The spec `SerialPort` interface carries no `path` (Node extension on the
  `NodeSerialPort` class): `probes/list-ports.ts` casts the hub's return to
  `NodeSerialPort[]` — a lie-free downcast, the runtime objects are the hub's
  own `NodeSerialPort` instances.
- The browser pin typechecks only under TypeScript 7 (`fb:check:types`); the
  runtime side is erased and always true. Under TS 6 editors the DOM global is
  invisible — consistent with the project's existing TS 7 decision.

## TDD shape

- RED: a conditional-type assertion `MockSerialPort extends SerialPort` fails
  while the mock lacks the full spec surface (`const satisfied: false = true`
  → TS2322).
- GREEN: upgrade the mock, migrate the core imports, delete the module, adapt
  the probe.
- The browser pin passes from birth (it pins existing reality, like a canary —
  not a behavior driver); the plan says so honestly instead of pretending a
  red step.

## Changes

1. Create `src/serial-port-contract/serial-port-contract.test.ts` with both
   pins (mock: red; browser: canary).
2. Upgrade `MockSerialPort` in `fabrique/test/tools.ts`.
3. Delete `src/serial-port-like/`; swap the core imports
   (`znp-connection`, `cc2652p-znp-device`, `cc2652p-zigbee-coordinator`).
4. `probes/list-ports.ts`: cast the hub's ports to `NodeSerialPort[]`.
5. `README.md`: "provided as a `SerialPortLike`" → provided as a Web Serial API
   `SerialPort`.

## Left to the builder

- Exact wording of doc comments touched by the import swap.
- Running `yarn fb:check` and `yarn fb:test` as validation.
