# Design: ZNP seam and two-layer layout

Date: 2026-11-20
Status: approved

## Intent and why

The repository carries two layers with different vocabularies: the ZNP stack
(protocol) and the Zigbee bridge (abilities). Today the boundary leaks —
`ZnpDevice` imports `ZigbeeCoordinatorConfig` from `@thingmate/zigbee`, so the
dependency points the wrong way on the config surface, and
`ZnpZigbeeCoordinator` builds its device internally, blocking injection. The
owner chose (approach A): fix the seam inside this repository and keep the
physical package extraction (`@thingmate/znp`) for the day a second consumer
exists — the folder layout below makes that extraction a mechanical move.

## Goals

- A zigbee-free `ZnpDevice`: the ZNP stack imports nothing from
  `@thingmate/zigbee`.
- Dependency direction: bridge → znp → node-web-serial.
- `ZnpZigbeeCoordinator` takes a `ZnpDevice` (constructor injection); a static
  `fromPort` keeps the ergonomic construction.
- A two-folder source layout expressing the layer split.

## Non-goals

- No physical package extraction (no new repository, no `@thingmate/znp` yet).
- No change to the wire-level test architecture: bridge and coordinator tests
  keep building the real `ZnpDevice` over the `MockZnpDevice` wire simulator.
- No change to the ability contracts of `@thingmate/zigbee`.

## The seam, member by member

| Today (`ZnpDevice`)                                                                                                        | After                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readConfig(): Promise<ZigbeeCoordinatorConfig>`                                                                           | `readNetworkState(): Promise<ZnpNetworkState>` — new ZNP type `{ channel, panId, extPanId, key, txRadio }`, exported by `znp-network` beside `ZnpNetworkOptions`                                                                              |
| `writeConfig(config: ZigbeeCoordinatorConfig)` (stages pre-start; compares and re-commissions post-start; applies txRadio) | `ensureNetworkOptions(options: ZnpNetworkOptions)` (stages pre-start; compares and re-commissions post-start — the comparison is protocol-level and stays) + `setTxRadio(txRadio: number)` made public (stages pre-start, applies post-start) |
| `onConfig(listener: (config: ZigbeeCoordinatorConfig) => void)`                                                            | `onNetworkState(listener: (state: ZnpNetworkState) => void)`                                                                                                                                                                                  |
| `nextSequence()` (ZCL transaction sequence — zigbee vocabulary)                                                            | removed from the device; the command-frame bridge owns the counter                                                                                                                                                                            |
| `nextTransId()` (AF transaction id — ZNP vocabulary)                                                                       | unchanged                                                                                                                                                                                                                                     |

- `ZnpNetworkState` and `ZigbeeCoordinatorConfig` are structurally identical
  with different owners — the normal price of a boundary (zigpy does the same).
- The bridges stay ZNP-speaking (`request(ZnpSubsystem, …)`, permit-join bytes):
  this repository is the ZNP bridge by definition.
- Bridge config mapping after the split: read returns the state (structural
  assignment); write calls `setTxRadio(config.txRadio)` then
  `ensureNetworkOptions({ channel, panId, extPanId, key })`; observe forwards
  `onNetworkState`.

## Layout

```
src/
  znp/                                        ← the ZNP stack (future @thingmate/znp)
    frame/znp-frame.ts                        (+test)
    connection/znp-connection.ts              (+test)
    nv/znp-nv.ts                              (+test)
    network/znp-network.ts                    (+test)
    device/znp-device.ts                      (+test)
    serial-port-contract/serial-port-contract.test.ts
  zigbee/                                     ← the bridge (speaks @thingmate/zigbee)
    znp-zigbee-coordinator/…                  (+test)
    abilities/config/znp-zigbee-coordinator-config-bridge.ts    (+test)
    abilities/frame/znp-zigbee-command-frame-bridge.ts          (+test)
    encode-zcl-command-frame/…                (+test)
    decode-zcl-command-frame/…                (+test)
    observable-from-listener-source/…
fabrique/test/                                (unchanged: MockSerialPort, MockZnpDevice, TestTools)
```

- Inner folders use short names (`znp/frame/znp-frame.ts`, not
  `znp/znp-frame/znp-frame.ts`) — an approved deviation from "folder named
  after its file" to avoid stuttery paths; the one-file-per-folder rule holds.
- `serial-port-contract` joins `znp/` (it pins the stack's transport contract).
- `fabrique/` unchanged; wire-level mocks stay the test architecture.

## Changes

1. Tree regrouping (pure moves + import rewrites).
2. `ZnpDevice` surface change per the table above; bridges and their tests
   follow.
3. Constructor injection on `ZnpZigbeeCoordinator` + `static fromPort`; probes
   and README construction sites follow.

## Left to the builder

- Exact wording of the reworked doc comments.
- Running `yarn fb:check` and `yarn fb:test` per task; the typecheck is the
  rename-failure detector at every step.
