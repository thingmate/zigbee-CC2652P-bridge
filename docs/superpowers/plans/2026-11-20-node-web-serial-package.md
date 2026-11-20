# Node Web Serial package swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local `src/node-web-serial/` adapter (built on `serialport`) with the published `@thingmate/node-web-serial` package, aligning `SerialPortLikeSignalsState` on the Web Serial spec so the package's `NodeSerialPort` satisfies `SerialPortLike`.

**Architecture:** The library core depends only on the `SerialPortLike` interface; the Node adapter is peripheral (used by the probes and the README example). The interface alignment and the adapter swap are inseparable: from the moment the probes hand the package's `NodeSerialPort` to `Cc2652pZigbeeCoordinator`, the six-field signals state no longer compiles (`getSignals()` per the spec returns the four input signals only, and nothing in the library reads DTR/RTS from it). They land as one atomic task.

**Tech Stack:** TypeScript (strict, `NodeNext`, `allowImportingTsExtensions`, `erasableSyntaxOnly`), vitest, yarn 4.18.1, `@thingmate/node-web-serial@^1.0.0` (which brings `serialport` transitively).

**Spec:** `docs/superpowers/specs/2026-11-20-node-web-serial-package-design.md`

## Global Constraints

- Dependency swap, exact values: remove `"serialport": "^13.0.0"` from `dependencies`; add `"@thingmate/node-web-serial": "^1.0.0"` (alphabetical order: between `@thingmate/abilities` and `@thingmate/zigbee`).
- `.yarnrc.yml` must not change: `npmMinimalAgeGate: 1d` stays, and `npmPreapprovedPackages` already covers `@thingmate/**` — the new dependency installs without weakening the gate. Do not touch `npmMinimalAgeGate` if install fails; check the pre-approval first.
- `serialport` disappears from `package.json` but must remain in `yarn.lock` as a transitive dependency of `@thingmate/node-web-serial`.
- Code style (AGENTS.md): dash-cased files, one public export per file, named exports only, no barrels, no `private` keyword (`#fields`), no abbreviations, `G`-prefixed type aliases, `readonly` everywhere possible.
- tsconfig strictness applies: `noUnusedLocals`/`noUnusedParameters` (unused private fields and parameters are errors — an intentionally unused parameter takes a leading underscore), `verbatimModuleSyntax` (type-only imports use `import type`), `erasableSyntaxOnly`.
- Historical records under `docs/superpowers/` are never edited; only new files are added there.
- Validation commands: `yarn fb:check:types`, `yarn fb:format:check` (or both via `yarn fb:check`), `yarn fb:test`. If format check fails on touched files, run `yarn fb:format` and re-check.

## Review Focus

- **Real dongle behavior** — the package's spec-faithful port (pull-based BYOB reads, DOMException errors, drain on close) differs from the old adapter under real hardware; no automated test covers a real device. Expected: `node probes/list-ports.ts` lists the attached dongle with USB `10c4:ea60`. Pinned by: manual probe run after Task 1 (hardware not available to the implementer — hand this check to the user, as Task 2's last step does).
- **Browser `SerialPort` compatibility** — the spec claim "the Web Serial API `SerialPort` structurally satisfies `SerialPortLike`" becomes true only with the 4-field state; only TypeScript 7's `lib.dom` declares `SerialPort` (`@types/w3c-web-serial` is a stub), so the repo pins the Node package only. Pinned by: the conditional-type test in Task 1. Expected for the DOM side: it satisfies `SerialPortLike` under `fb:check:types` — verify once manually, do not "fix" by re-adding fields.
- **Quarantine (YN0016)** — `@thingmate/node-web-serial@1.0.0` was published 2026-11-19; a bare checkout without the project's `.yarnrc.yml` pre-approval rejects it for 24 h. Expected: install succeeds in this repository because `npmPreapprovedPackages` lists `@thingmate/**`. Pinned by: Task 1's `yarn install` step.
- **Transitive `serialport`** — removing `serialport` from the lockfile entirely (e.g. a bad dedupe/prune) breaks `@thingmate/node-web-serial`. Expected: `yarn why serialport` reports it as a dependency of `@thingmate/node-web-serial`. Pinned by: Task 1's verification step.
- **Mock drift** — `MockSerialPort.setSignals` becomes a no-op and `getSignals()` reports input signals only; a future test expecting DTR/RTS echo would be testing a mock limitation, not a spec regression. Pinned by: the existing suite still passing in Task 1 (no test touches signals — verified by search before this plan).

---

### Task 1: Swap the adapter for the package and align the port contract

**Files:**

- Create: `src/serial-port-like/serial-port-like.test.ts`
- Modify: `package.json` (dependencies block, lines 64-72)
- Delete: `src/node-web-serial/node-web-serial.ts` and `src/node-web-serial/node-web-serial.test.ts` (the whole folder)
- Modify: `src/serial-port-like/serial-port-like.ts` (interface `SerialPortLikeSignalsState`, lines 76-83; file doc comment, line 6)
- Modify: `fabrique/test/tools.ts` (`MockSerialPort`: `#signals` initializer, lines 65-72; `setSignals`, lines 122-129)
- Modify: `probes/list-ports.ts` (line 1)
- Modify: `probes/open-port/open-port.ts` (line 1 and line 13)

**Interfaces:**

- Consumes: `@thingmate/node-web-serial@^1.0.0` exports `NodeSerial` (hub; `getPorts(): Promise<SerialPort[]>` without arguments, `requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>` with the spec form `requestPort({ filters: [{ usbVendorId }] })`) and `NodeSerialPort` (constructor `({ path, info?, binding? })`; `path`, `connected`, `getInfo()`, `open(SerialOptions)`, `readable`/`writable`, `setSignals`/`getSignals`, `close()`, `forget()`).
- Produces: `SerialPortLikeSignalsState` with exactly four `readonly boolean` members — `clearToSend`, `dataCarrierDetect`, `dataSetReady`, `ringIndicator` (matching the package's `SerialInputSignals`); `SerialPortLike` and `SerialPortLikeSignals` (the `setSignals` input, which keeps `dataTerminalReady`/`requestToSend`) unchanged; the type-level pin `NodeSerialPort extends SerialPortLike`; probes importing from the package.

- [ ] **Step 1: Write the failing type-level test**

Create `src/serial-port-like/serial-port-like.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { NodeSerialPort } from '@thingmate/node-web-serial';
import type { SerialPortLike } from './serial-port-like.ts';

describe('SerialPortLike', () => {
  it('is structurally satisfied by the @thingmate/node-web-serial NodeSerialPort', () => {
    type GNodeSerialPortSatisfiesSerialPortLike = NodeSerialPort extends SerialPortLike
      ? true
      : false;
    const satisfied: GNodeSerialPortSatisfiesSerialPortLike = true;
    expect(satisfied).toBe(true);
  });
});
```

- [ ] **Step 2: Run the typecheck to verify it fails**

Run: `yarn fb:check:types`
Expected: FAIL with TS2307 ("Cannot find module '@thingmate/node-web-serial'") — the runtime test alone cannot fail because the type-only import is erased.

- [ ] **Step 3: Swap the dependency and migrate the callers**

1. `package.json`: remove the `"serialport": "^13.0.0"` entry; add `"@thingmate/node-web-serial": "^1.0.0"` between `"@thingmate/abilities"` and `"@thingmate/zigbee"`.
2. Run `yarn install` (lockfile refresh; the install succeeds thanks to the existing `@thingmate/**` pre-approval).
3. Delete the folder `src/node-web-serial/`.
4. `probes/list-ports.ts` line 1 → `import { NodeSerial } from '@thingmate/node-web-serial';` (body unchanged: `getPorts()` is already called without arguments).
5. `probes/open-port/open-port.ts` line 1 → `import { NodeSerial, NodeSerialPort } from '@thingmate/node-web-serial';` and line 13 → `const port: NodeSerialPort = await serial.requestPort({ filters: [{ usbVendorId: SILICON_LABS_VENDOR_ID }] });`

- [ ] **Step 4: Align the port contract on the spec**

1. In `src/serial-port-like/serial-port-like.ts`, remove the `dataTerminalReady` and `requestToSend` members from `SerialPortLikeSignalsState` (keep `clearToSend`, `dataCarrierDetect`, `dataSetReady`, `ringIndicator`).
2. Update the file doc comment: "Node.js users get an equivalent implementation through the `node-web-serial` module" → "Node.js users get an equivalent implementation through the `@thingmate/node-web-serial` package".
3. In `fabrique/test/tools.ts`, trim `#signals` to the four fields (all `false`); `setSignals` loses its DTR/RTS merge (its only reader was the removed state): the parameter becomes `_signals?: SerialPortLikeSignals` with an empty body, and its doc comment says the mock accepts signal changes and ignores them.

- [ ] **Step 5: Run the full quality gates**

Run: `yarn fb:check && yarn fb:test`
Expected: the new test passes, types and format pass, the whole suite passes.

Run: `yarn why serialport`
Expected: reports `@thingmate/node-web-serial` as the (only) dependent — `serialport` is transitive, not gone.

- [ ] **Step 6: Commit**

```bash
git add package.json yarn.lock src/serial-port-like probes/list-ports.ts probes/open-port/open-port.ts fabrique/test/tools.ts
git rm -r src/node-web-serial
git commit -m "refactor(node-web-serial): replace the local adapter with @thingmate/node-web-serial"
```

---

### Task 2: Update the documentation

**Files:**

- Modify: `README.md` (paragraph at line 22; usage block, lines 38-44)
- Add: `docs/superpowers/specs/2026-11-20-node-web-serial-package-design.md` and `docs/superpowers/plans/2026-11-20-node-web-serial-package.md` (written before execution; commit them here)

**Interfaces:**

- Consumes: the final import paths and call form from Task 1.
- Produces: documentation matching the shipped code.

- [ ] **Step 1: Update `README.md`**

Line 22: "in Node.js (through the provided `NodeSerial` hub)" → "in Node.js (through the `NodeSerial` hub of [`@thingmate/node-web-serial`](https://www.npmjs.com/package/@thingmate/node-web-serial))".

Usage block: `import { NodeSerial } from '@thingmate/node-web-serial';` and `const port = await serial.requestPort({ filters: [{ usbVendorId: 0x10c4 }] }); // Silicon Labs CP2102N` (keep the surrounding comment and the rest of the example unchanged).

`probes/README.md` needs no change: it names `NodeSerial` without a path and pins no message text (verified before this plan).

- [ ] **Step 2: Verify formatting over the touched markdown**

Run: `yarn fb:format:check`
Expected: passes (prettier covers `**/*.md`; run `yarn fb:format` first if it fails).

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-11-20-node-web-serial-package-design.md docs/superpowers/plans/2026-11-20-node-web-serial-package.md
git commit -m "docs: point Node.js usage at @thingmate/node-web-serial"
```

- [ ] **Step 4: Hand the hardware check to the user**

With the dongle attached, ask the user to run: `node probes/list-ports.ts` (expected: the dongle listed, USB `10c4:ea60`), then optionally `node probes/ping.ts`. This is the Review Focus item no automated test can cover.
