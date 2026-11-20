# ZNP seam and layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ZNP stack zigbee-free (`ZnpDevice` no longer imports `@thingmate/zigbee`), inject the device into `ZnpZigbeeCoordinator`, and regroup the sources under `src/znp/` (stack) and `src/zigbee/` (bridge).

**Architecture:** Three atomic tasks, each green: (1) pure tree regrouping, (2) the device surface change with the bridges following (compile-fail driven), (3) constructor injection with the coordinator, probes and README following. The wire-level test architecture (real `ZnpDevice` over the `MockZnpDevice` simulator) is preserved everywhere.

**Tech Stack:** TypeScript (strict, `NodeNext`), vitest, yarn 4.18.1, `git mv` for history preservation.

**Spec:** `docs/superpowers/specs/2026-11-20-znp-seam-layering-design.md`

## Global Constraints

- Naming (exact): new type `ZnpNetworkState { readonly channel: number; readonly panId: number; readonly extPanId: bigint; readonly key: Uint8Array; readonly txRadio: number }` exported by `znp-network`; new device methods `readNetworkState()`, `ensureNetworkOptions(options: ZnpNetworkOptions)`, `setTxRadio(txRadio: number)`, `onNetworkState(listener: (state: ZnpNetworkState) => void)`; removed: `readConfig`, `writeConfig`, `onConfig`, `nextSequence`; unchanged: `nextTransId`, `ensureStarted`, `request`, `waitFor`, `onFrame`, `close`.
- `ZnpZigbeeCoordinator`: `constructor(device: ZnpDevice)` + `static fromPort(port: SerialPort): ZnpZigbeeCoordinator`.
- No `@thingmate/zigbee` import may remain under `src/znp/**` (structural twin types are the boundary: `ZnpNetworkState` ≅ `ZigbeeCoordinatorConfig`).
- Layout per the spec's tree; inner folders keep short names (`znp/frame/znp-frame.ts`) — approved deviation from the folder-named-after-file rule; one file per folder holds.
- Wire-level test architecture preserved: bridge/coordinator tests construct the real `ZnpDevice` over `MockZnpDevice`'s port; `MockZnpDevice` and `fabrique/` untouched.
- Code style (AGENTS.md): `#fields`, no abbreviations, `G`-prefixed type aliases, `readonly` where possible, named exports.
- Validation per task: `yarn fb:check` (types + format) and `yarn fb:test` (61/61 throughout — no behavior change). Scratch `.superpowers` briefs that fail formatting get formatted in place (standing ruling).

## Review Focus

- **ZCL sequence ownership** — moving `nextSequence()` to the command-frame bridge must preserve the 0..255 wraparound and per-bridge independence; a wrong counter is invisible until frames collide. Expected: bridge-owned counter starting at 0, wrapping with `& 0xff`. Pinned by: Task 2's frame-bridge test (existing sequence assertions keep passing).
- **Write-path ordering** — today `writeConfig` reads the current state first, then applies txRadio, then compares/commissions. Expected: the bridge calls `setTxRadio` before `ensureNetworkOptions`, and `ensureNetworkOptions` reads the state, compares, and only re-commissions on difference (a no-op when equal — the test asserting no re-commission on equal config must keep passing). Pinned by: Task 2's existing config-bridge write tests.
- **Pre-start staging split** — `ensureNetworkOptions` stages `#pendingNetworkOptions` and `setTxRadio` stages `#txRadio`/`#txRadioPending` when `#connection === undefined`; a bridge calling them in the wrong order or double-staging would silently drop the first-write-before-start behavior. Expected: same semantics as the current pre-start branch of `writeConfig`. Pinned by: Task 2's existing first-write test (if present) or the device test's staging case.
- **Import depths after the moves** — relative paths change per file; the typecheck (TS2307) catches every missed one. Expected: `fb:check:types` exit 0 at each task's end. Pinned by: every task's typecheck step.

---

### Task 1: Regroup the sources by layer

**Files:**

- Move: `src/znp-frame/` → `src/znp/frame/`, `src/znp-connection/` → `src/znp/connection/`, `src/znp-nv/` → `src/znp/nv/`, `src/znp-network/` → `src/znp/network/`, `src/znp-device/` → `src/znp/device/`, `src/serial-port-contract/` → `src/znp/serial-port-contract/` (each with its test file)
- Move: `src/znp-zigbee-coordinator/` → `src/zigbee/znp-zigbee-coordinator/`, `src/abilities/config/` → `src/zigbee/abilities/config/`, `src/abilities/frame/` → `src/zigbee/abilities/frame/`, `src/encode-zcl-command-frame/` → `src/zigbee/encode-zcl-command-frame/`, `src/decode-zcl-command-frame/` → `src/zigbee/decode-zcl-command-frame/`, `src/observable-from-listener-source/` → `src/zigbee/observable-from-listener-source/` (each with its test file; the now-empty `src/abilities/` folder disappears)
- Modify: every relative import touched by the depth changes (typecheck-driven)

**Interfaces:**

- Consumes: nothing new.
- Produces: the spec's tree; `serial-port-contract.test.ts` importing `../../../fabrique/test/tools.ts`.

- [ ] **Step 1: Move the folders**

```bash
git mv src/znp-frame src/znp/frame
git mv src/znp-connection src/znp/connection
git mv src/znp-nv src/znp/nv
git mv src/znp-network src/znp/network
git mv src/znp-device src/znp/device
git mv src/serial-port-contract src/znp/serial-port-contract
mkdir -p src/zigbee/abilities
git mv src/znp-zigbee-coordinator src/zigbee/znp-zigbee-coordinator
git mv src/abilities/config src/zigbee/abilities/config
git mv src/abilities/frame src/zigbee/abilities/frame
git mv src/encode-zcl-command-frame src/zigbee/encode-zcl-command-frame
git mv src/decode-zcl-command-frame src/zigbee/decode-zcl-command-frame
git mv src/observable-from-listener-source src/zigbee/observable-from-listener-source
```

- [ ] **Step 2: Fix the imports until the typecheck is green**

Run `yarn fb:check:types`, fix every TS2307 by adjusting relative depths (no specifier changes — only `../` counts and the `serial-port-contract` fabrique import). Repeat until exit 0.

- [ ] **Step 3: Run the gates**

Run: `yarn fb:check && yarn fb:test`
Expected: exit 0, 61/61 tests.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: group the sources by layer (znp stack, zigbee bridge)"
```

---

### Task 2: Make the ZNP device zigbee-free

**Files:**

- Modify: `src/znp/network/znp-network.ts` (add `ZnpNetworkState`)
- Modify: `src/znp/device/znp-device.ts` (surface per the spec table; remove the `@thingmate/zigbee` import)
- Modify: `src/znp/device/znp-device.test.ts` (new method names; sequence counter expectations removed)
- Modify: `src/zigbee/abilities/config/znp-zigbee-coordinator-config-bridge.ts` (+ test: method names only)
- Modify: `src/zigbee/abilities/frame/znp-zigbee-command-frame-bridge.ts` (+ test: bridge-owned sequence counter)
- Add: this plan and its spec are committed with Task 1 or this task (executor's choice, single docs commit)

**Interfaces:**

- Consumes: Task 1's paths.
- Produces: `ZnpNetworkState`; device methods `readNetworkState()`, `ensureNetworkOptions(options: ZnpNetworkOptions)`, `setTxRadio(txRadio: number)`, `onNetworkState(listener)`; a device class with zero `@thingmate/zigbee` imports; a command-frame bridge owning its ZCL sequence counter (`#sequence`, `#nextSequence()` with `& 0xff` wraparound).

- [ ] **Step 1: Write the failing device test (RED)**

Update `src/znp/device/znp-device.test.ts` to the new surface: replace every `readConfig`/`writeConfig`/`onConfig` call with `readNetworkState`/`ensureNetworkOptions` + `setTxRadio`/`onNetworkState`, and delete any `nextSequence` usage. Keep every assertion value unchanged.

Run: `yarn fb:check:types`
Expected: FAIL (TS2551 — the device does not expose the new methods yet).

- [ ] **Step 2: Implement the new device surface (GREEN for the device)**

In `src/znp/device/znp-device.ts`:

- `#readConfig(connection)` → `#readNetworkState(connection): Promise<ZnpNetworkState>` (same decoding, same shape, `txRadio: this.#txRadio`).
- `readConfig()` → `readNetworkState()`.
- `writeConfig(config)` splits: `setTxRadio(txRadio: number)` (public; when `#connection === undefined` stage `#txRadio`/`#txRadioPending = true`, else apply through the existing `#setTxRadio` logic) and `ensureNetworkOptions(options: ZnpNetworkOptions)` (when `#connection === undefined` stage `#pendingNetworkOptions`, else read the state, compare `channel`/`panId`/`extPanId`/`key`, re-commission through `commissionZnpNetwork` only on difference, then emit).
- `onConfig`/`#configListeners`/`#emitCurrentConfig` → `onNetworkState`/`#networkStateListeners`/`#emitCurrentNetworkState` with `ZnpNetworkState`.
- Remove `nextSequence()` and `#sequence`; remove the `@thingmate/zigbee` import; import `ZnpNetworkState` (and keep `ZnpNetworkOptions`) from `../network/znp-network.ts`.

Run: `yarn fb:check:types`
Expected: device test compiles; FAILURES remain in the two bridges (old method names) — TS2551.

- [ ] **Step 3: Follow with the bridges (GREEN everywhere)**

- Config bridge: read → `await device.ensureStarted(); return device.readNetworkState();` (returned as `ZigbeeCoordinatorConfig` — structural assignment); write → `await device.setTxRadio(config.txRadio); await device.ensureNetworkOptions({ channel: config.channel, panId: config.panId, extPanId: config.extPanId, key: config.key });` (no `ensureStarted` — staging semantics preserved); observe → `device.onNetworkState((state): void => emit(state))`. Its test changes nothing but imports.
- Command-frame bridge: replace `device.nextSequence()` with a private `#sequence` counter (`#nextSequence(): number` with `& 0xff` wraparound); `device.nextTransId()` unchanged. Its test changes nothing but imports.

Run: `yarn fb:check && yarn fb:test`
Expected: exit 0, 61/61 tests.

Run: `grep -rn "@thingmate/zigbee" src/znp/`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(znp): make the ZNP device zigbee-free"
```

---

### Task 3: Inject the device into the coordinator

**Files:**

- Modify: `src/zigbee/znp-zigbee-coordinator/znp-zigbee-coordinator.ts` (constructor + static factory)
- Modify: `src/zigbee/znp-zigbee-coordinator/znp-zigbee-coordinator.test.ts` (construction)
- Modify: the probes constructing the coordinator (`probes/ping.ts`, `probes/smoke.ts`, `probes/monitor.ts`, `probes/config-write.ts`)
- Modify: `README.md` (usage block construction line)

**Interfaces:**

- Consumes: Task 2's `ZnpDevice`.
- Produces: `ZnpZigbeeCoordinator` constructible with a `ZnpDevice`; `static fromPort(port: SerialPort): ZnpZigbeeCoordinator`.

- [ ] **Step 1: Write the failing construction (RED)**

Update `src/zigbee/znp-zigbee-coordinator/znp-zigbee-coordinator.test.ts`: replace every `new ZnpZigbeeCoordinator(mock.port)` with `new ZnpZigbeeCoordinator(new ZnpDevice(mock.port))` (import `ZnpDevice` from `../../znp/device/znp-device.ts`).

Run: `yarn fb:check:types`
Expected: FAIL (TS2345 — the constructor still takes a `SerialPort`).

- [ ] **Step 2: Implement the injection (GREEN)**

`constructor(device: ZnpDevice)` (the doc comment's `@param` reworded); add:

```ts
/** Creates a coordinator bridged to the provided serial port. */
static fromPort(port: SerialPort): ZnpZigbeeCoordinator {
  return new ZnpZigbeeCoordinator(new ZnpDevice(port));
}
```

- [ ] **Step 3: Follow with the construction sites**

`probes/{ping,smoke,monitor,config-write}.ts`: `new ZnpZigbeeCoordinator(port)` → `ZnpZigbeeCoordinator.fromPort(port)`. `README.md` usage block: `const coordinator: ZnpZigbeeCoordinator = new ZnpZigbeeCoordinator(port);` → `const coordinator: ZnpZigbeeCoordinator = ZnpZigbeeCoordinator.fromPort(port);`.

Run: `yarn fb:check && yarn fb:test`
Expected: exit 0, 61/61 tests.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(zigbee): inject the ZnpDevice into ZnpZigbeeCoordinator"
```
