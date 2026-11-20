# Serial port contract on package types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `src/serial-port-like/` and type the library's port contract directly on the `@thingmate/node-web-serial` package's spec-faithful types, pinning the browser `SerialPort` compatibility.

**Architecture:** Pure type-level migration with no runtime change: the core classes (`znp-connection`, `cc2652p-znp-device`, `cc2652p-zigbee-coordinator`) swap `SerialPortLike*` types for the package's `SerialPort`, `SerialOptions`, `SerialOutputSignals`, `SerialInputSignals`, `SerialPortInfo` (type-only imports); the test mock grows the full spec surface; the pin test moves from "Node package satisfies our subset" to "browser `SerialPort` and our mock satisfy the package interface".

**Tech Stack:** TypeScript (strict, `NodeNext`, `allowImportingTsExtensions`, `erasableSyntaxOnly`), vitest, `@thingmate/node-web-serial@^1.0.0` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-11-20-serial-port-contract-package-types-design.md`

## Global Constraints

- Type-only migration: no runtime behavior change; all imports of the package's types use `import type` (erased; `verbatimModuleSyntax`).
- Code style (AGENTS.md): one public export per file, named exports only, no barrels, no `private` keyword (`#fields`), no abbreviations, `G`-prefixed type aliases, `readonly` everywhere possible; folders named after their file.
- The package's spec interface has no `path`: the probe keeps `NodeSerialPort` (the class, Node extension) for path access via a single lie-free downcast.
- Validation commands: `yarn fb:check` (types + format), `yarn fb:test`. Scratch `.superpowers` briefs that fail formatting get formatted in place (standing ruling in the ledger).

## Review Focus

- **Published-type reachability** — the core's public constructors now expose package types; a consumer must be able to name them. Expected: `@thingmate/node-web-serial` in `dependencies` (already true) makes them resolvable for consumers. Pinned by: Task 1's typecheck (any unresolvable type fails there).
- **Mock full-surface drift** — `MockSerialPort` now implements the full spec interface; future spec additions (upstream) will surface as mock compile errors, which is the wanted failure mode. Pinned by: the mock pin test in Task 1.
- **Browser pin under TS 6 editors** — the DOM `SerialPort` global only exists in TypeScript 7 `lib.dom`; under TS 6 the pin file cannot typecheck. Expected: the project's gate is the TS 7 native typechecker; the pin documents this. Not fixable in-repo without re-introducing a mirror — accepted by the spec.
- **`path` loss on the spec type** — `probes/list-ports.ts` needs `path`; expected to come from the `NodeSerialPort` class via downcast, not from widening the spec interface. Pinned by: Task 1's typecheck.

---

### Task 1: Type the contract on the package's `SerialPort` and delete the mirror

**Files:**

- Create: `src/serial-port-contract/serial-port-contract.test.ts`
- Modify: `fabrique/test/tools.ts` (`MockSerialPort` class, lines 55-145)
- Delete: `src/serial-port-like/serial-port-like.ts` and `src/serial-port-like/serial-port-like.test.ts` (the whole folder)
- Modify: `src/znp-connection/znp-connection.ts`, `src/cc2652p-znp-device/cc2652p-znp-device.ts`, `src/cc2652p-zigbee-coordinator/cc2652p-zigbee-coordinator.ts` (type imports and annotations; doc comments that name `SerialPortLike`)
- Modify: `probes/list-ports.ts` (line 4 area)
- Modify: `README.md` (line 22)
- Add: the two docs of this plan/spec (commit them with the task)

**Interfaces:**

- Consumes: `@thingmate/node-web-serial` exports `SerialPort` (interface: `onconnect`/`ondisconnect` properties, `connected`, `readable`, `writable`, `getInfo(): SerialPortInfo`, `open(options: SerialOptions)`, `setSignals(signals?: SerialOutputSignals)`, `getSignals(): Promise<SerialInputSignals>`, `close()`, `forget()`, narrowed `addEventListener`/`removeEventListener` for `'connect' | 'disconnect'`), `SerialOptions`, `SerialOutputSignals`, `SerialInputSignals`, `SerialPortInfo`, and the `NodeSerialPort` class (with `path`).
- Produces: core constructors typed on the package's `SerialPort`; `MockSerialPort implements SerialPort`; the pin test file.

- [ ] **Step 1: Write the failing mock pin**

Create `src/serial-port-contract/serial-port-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { SerialPort as WebSerialPort } from '@thingmate/node-web-serial';
import { MockSerialPort } from '../../fabrique/test/tools.ts';

describe('SerialPort contract', () => {
  it('is satisfied by the test mock', () => {
    type GMockSatisfiesWebSerialPort = MockSerialPort extends WebSerialPort ? true : false;
    const satisfied: GMockSatisfiesWebSerialPort = true;
    expect(satisfied).toBe(true);
  });

  it('is satisfied by the browser SerialPort', () => {
    type GBrowserSerialPortSatisfiesWebSerialPort = SerialPort extends WebSerialPort ? true : false;
    const satisfied: GBrowserSerialPortSatisfiesWebSerialPort = true;
    expect(satisfied).toBe(true);
  });
});
```

The second pin is a canary: it pins existing reality (DOM `SerialPort` vs the package mirror) and passes from birth — only the first must fail.

- [ ] **Step 2: Run the typecheck to verify it fails**

Run: `yarn fb:check:types`
Expected: FAIL with TS2322 on the first pin (mock lacks `connected`, `forget()`, the `on*` properties, the narrowed `addEventListener`, and does not extend `EventTarget`).

- [ ] **Step 3: Upgrade the mock to the full spec interface**

In `fabrique/test/tools.ts`: `MockSerialPort extends EventTarget implements SerialPort`; swap every `SerialPortLike*` reference for the package type (`SerialOptions`, `SerialOutputSignals`, `SerialInputSignals`, `SerialPortInfo`); add `readonly onconnect = null` and `readonly ondisconnect = null`; `get connected(): boolean { return this.#opened; }`; `async forget(): Promise<void> {}` (documented: nothing to revoke in a mock); `setSignals(_signals?: SerialOutputSignals)` stays a documented no-op.

- [ ] **Step 4: Migrate the core and delete the mirror**

1. In `src/znp-connection/znp-connection.ts`, `src/cc2652p-znp-device/cc2652p-znp-device.ts`, `src/cc2652p-zigbee-coordinator/cc2652p-zigbee-coordinator.ts`: `import type { SerialPort, SerialOptions, SerialInputSignals, SerialOutputSignals, SerialPortInfo } from '@thingmate/node-web-serial';` and replace every `SerialPortLike*` annotation; update doc comments that name `SerialPortLike`.
2. Delete the folder `src/serial-port-like/`.
3. `probes/list-ports.ts`: `const ports = (await serial.getPorts()) as NodeSerialPort[];` with `import { NodeSerial, type NodeSerialPort } from '@thingmate/node-web-serial';` — the hub returns its own `NodeSerialPort` instances; the class carries the Node `path` extension the spec interface omits. Keep the `getInfo()` handling unchanged (`SerialPortInfo` still has the USB members).
4. `README.md` line 22: "The port is provided as a `SerialPortLike`" → "The port is provided as a Web Serial API `SerialPort`" (keep the rest of the sentence).

- [ ] **Step 5: Run the full quality gates**

Run: `yarn fb:check && yarn fb:test`
Expected: both pins pass under the typechecker, types and format pass, the whole suite passes (58/58 — no runtime change).

- [ ] **Step 6: Commit**

```bash
git add fabrique/test/tools.ts src/serial-port-contract src/znp-connection/znp-connection.ts src/cc2652p-znp-device/cc2652p-znp-device.ts src/cc2652p-zigbee-coordinator/cc2652p-zigbee-coordinator.ts probes/list-ports.ts README.md docs/superpowers/specs/2026-11-20-serial-port-contract-package-types-design.md docs/superpowers/plans/2026-11-20-serial-port-contract-package-types.md
git rm -r src/serial-port-like
git commit -m "refactor(serial-port-like): type the port contract on @thingmate/node-web-serial"
```
