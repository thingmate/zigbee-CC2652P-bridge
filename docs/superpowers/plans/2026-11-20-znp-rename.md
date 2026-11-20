# ZNP rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the CC2652P scope to ZNP — folders, files, classes, imports, tests, probes, package name (`@thingmate/znp-zigbee-bridge`) and repository (`thingmate/znp-zigbee-bridge`) — with no behavior change.

**Architecture:** Pure mechanical rename in one atomic commit: the repository boundary is the seam for other manufacturers, so nothing structural changes; every commit must stay self-consistent (README import paths match the renamed sources), which pins the whole rename to a single task.

**Tech Stack:** TypeScript (strict, `NodeNext`), vitest, yarn 4.18.1, `git mv` for history preservation.

**Spec:** `docs/superpowers/specs/2026-11-20-znp-rename-design.md`

## Global Constraints

- No behavior change: the diff may only rename/move/reword — no logic edits. The gates are `yarn fb:check` (types + format) and `yarn fb:test` (61/61 before and after).
- Naming map (exact): `Cc2652pZigbeeCoordinator` → `ZnpZigbeeCoordinator` (covers the two bridge classes as suffixes), `Cc2652pZnpDevice` → `ZnpDevice`, `Cc2652pNetworkOptions` → `ZnpNetworkOptions`, path segments `cc2652p-` → `znp-`, package specifier `zigbee-CC2652P-bridge` → `znp-zigbee-bridge`, repository `thingmate/zigbee-CC2652P-bridge` → `thingmate/znp-zigbee-bridge`.
- Folders move with `git mv` (history preservation), files renamed inside.
- Kept deliberately (the grep gate must expect them): the `cc2652p` keyword in `package.json` (discovery metadata), hardware CC2652P mentions in `src/znp-frame/znp-frame.ts:3` ("CC2652P among others") and hardware docs (`windows-wsl-usb-setup.md`), `zbdongle-p` keyword, historical records under `docs/superpowers/`.
- Code style (AGENTS.md) unchanged; dash-cased names follow the existing convention.

## Review Focus

- **Broken import paths after the move** — a renamed folder whose importer kept the old path fails the typecheck loudly; expected: `fb:check:types` exit 0. Pinned by: Task 1's typecheck step.
- **Stale self-references** — class names, folder paths, or the old package specifier surviving in a doc comment, probe, or README silently misdocument the code. Expected: the stale-reference grep finds only the deliberately-kept mentions. Pinned by: Task 1's grep step with its exact expected remainder.
- **Publish identity consistency** — `name` and `repository.url` must agree with the README badges/title/install lines, or the published package advertises the wrong identity. Pinned by: Task 1's grep step (no `zigbee-CC2652P-bridge` anywhere) plus the typecheck of the README example's import path shape.

---

### Task 1: Rename the CC2652P scope to ZNP

**Files:**

- Rename: `src/cc2652p-znp-device/` → `src/znp-device/` (files `cc2652p-znp-device.ts` → `znp-device.ts`, `cc2652p-znp-device.test.ts` → `znp-device.test.ts`)
- Rename: `src/cc2652p-zigbee-coordinator/` → `src/znp-zigbee-coordinator/` (files → `znp-zigbee-coordinator.ts`, `znp-zigbee-coordinator.test.ts`)
- Rename: `src/cc2652p-network/` → `src/znp-network/` (files → `znp-network.ts`, `znp-network.test.ts`)
- Rename: `src/abilities/config/cc2652p-zigbee-coordinator-config-bridge.ts` (+ test) → `znp-zigbee-coordinator-config-bridge.*`
- Rename: `src/abilities/frame/cc2652p-zigbee-command-frame-bridge.ts` (+ test) → `znp-zigbee-command-frame-bridge.*`
- Modify: every importer of the moved modules (`src/znp-connection/znp-connection.ts` untouched; importers are the two bridge files, their tests, the three renamed folders' own files, and the five probes)
- Modify: `package.json` (`name`, `repository.url`, `description`)
- Modify: `README.md` (badges, title, install commands, scope sentence, usage block)
- Modify: `probes/README.md` (class names)
- Add: this plan and its spec (committed with the task)

**Interfaces:**

- Consumes: nothing new (pure rename).
- Produces: `ZnpDevice`, `ZnpZigbeeCoordinator`, `ZnpNetworkOptions`, `ZnpZigbeeCoordinatorConfigBridge`, `ZnpZigbeeCommandFrameBridge` under `@thingmate/znp-zigbee-bridge` with paths `znp-device/znp-device.ts`, `znp-zigbee-coordinator/znp-zigbee-coordinator.ts`, `znp-network/znp-network.ts`.

- [ ] **Step 1: Move the folders and rename the files**

```bash
git mv src/cc2652p-znp-device src/znp-device
git mv src/znp-device/cc2652p-znp-device.ts src/znp-device/znp-device.ts
git mv src/znp-device/cc2652p-znp-device.test.ts src/znp-device/znp-device.test.ts
git mv src/cc2652p-zigbee-coordinator src/znp-zigbee-coordinator
git mv src/znp-zigbee-coordinator/cc2652p-zigbee-coordinator.ts src/znp-zigbee-coordinator/znp-zigbee-coordinator.ts
git mv src/znp-zigbee-coordinator/cc2652p-zigbee-coordinator.test.ts src/znp-zigbee-coordinator/znp-zigbee-coordinator.test.ts
git mv src/cc2652p-network src/znp-network
git mv src/znp-network/cc2652p-network.ts src/znp-network/znp-network.ts
git mv src/znp-network/cc2652p-network.test.ts src/znp-network/znp-network.test.ts
git mv src/abilities/config/cc2652p-zigbee-coordinator-config-bridge.ts src/abilities/config/znp-zigbee-coordinator-config-bridge.ts
git mv src/abilities/config/cc2652p-zigbee-coordinator-config-bridge.test.ts src/abilities/config/znp-zigbee-coordinator-config-bridge.test.ts
git mv src/abilities/frame/cc2652p-zigbee-command-frame-bridge.ts src/abilities/frame/znp-zigbee-command-frame-bridge.ts
git mv src/abilities/frame/cc2652p-zigbee-command-frame-bridge.test.ts src/abilities/frame/znp-zigbee-command-frame-bridge.test.ts
```

- [ ] **Step 2: Rewrite the identifiers and paths in the moved and importing files**

Apply these replacements (order matters: package specifier first, then class names, then path segments) across `src/`, `probes/`, `README.md`, `probes/README.md`, `package.json`:

```bash
grep -rl "zigbee-CC2652P-bridge\|Cc2652p\|cc2652p-" src probes README.md probes/README.md package.json |
  xargs sed -i 's/zigbee-CC2652P-bridge/znp-zigbee-bridge/g; s/Cc2652pZigbeeCoordinator/ZnpZigbeeCoordinator/g; s/Cc2652pZnpDevice/ZnpDevice/g; s/Cc2652pNetworkOptions/ZnpNetworkOptions/g; s/cc2652p-/znp-/g'
```

Class renames are prefix-safe: `Cc2652pZigbeeCoordinator` → `ZnpZigbeeCoordinator` also rewrites the two `…ConfigBridge`/`…CommandFrameBridge` class names correctly.

- [ ] **Step 3: Finish `package.json` wording**

`description`: "Drive a Zigbee coordinator from a Z-Stack 3.x ZNP coordinator (SONOFF ZBDongle-P, CC1352P, CC2531 among others) over the Web Serial API". Keep `keywords` as-is (`cc2652p`, `zbdongle-p` stay).

- [ ] **Step 4: Finish the README scope sentence**

Line 8 phrasing: "Drive a [Zigbee coordinator](https://www.npmjs.com/package/@thingmate/zigbee) from a Z-Stack 3.x ZNP coordinator (SONOFF ZBDongle-P, CC1352P, CC2531 among others) over a [Web Serial API](https://wicg.github.io/serial/) port." Keep the hardware note about the ITead factory firmware (hardware-level).

- [ ] **Step 5: Run the gates and the stale-reference grep**

Run: `yarn fb:check && yarn fb:test`
Expected: exit 0, 61/61 tests.

Run: `grep -ri "cc2652p" src probes package.json README.md probes/README.md`
Expected: exactly three kinds of hits — the `cc2652p` keyword in `package.json`, the hardware mention in `src/znp-frame/znp-frame.ts:3`, and none else. No `Cc2652p`, no `zigbee-CC2652P-bridge`, no `cc2652p-` path segment.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor!: rename the CC2652P scope to ZNP" -m "The library is a Z-Stack 3.x ZNP bridge; the package becomes @thingmate/znp-zigbee-bridge (repository thingmate/znp-zigbee-bridge). Other manufacturers will get their own bridge repositories sharing @thingmate/zigbee."
```

- [ ] **Step 7: Hand the repository rename to the user**

The GitHub repository rename (thingmate/zigbee-CC2652P-bridge → thingmate/znp-zigbee-bridge) is a GitHub UI action by the owner; after it, update the local remote URL (`git remote set-url origin git+https://github.com/thingmate/znp-zigbee-bridge.git`) — offer to run it once they renamed on GitHub.
