# Probes folder design

Date: 2026-11-18

## Intent and why

Provide runnable TypeScript scripts (`probes/`) exercising the library's
public API against a real CC2652P dongle. They double as usage examples and
manual acceptance tests: everything they do goes through
`Cc2652pZigbeeCoordinator` (plus `NodeSerial` to select the port), never
through the internal layers.

## Goals

- Diagnose a real dongle with the library alone: is it alive, what network
  does it run, can it open/close the network, can frames be observed.
- Serve as copy-pasteable usage examples of the public API.

## Non-goals

- No probes driving the internal layers (`ZnpConnection`, `cc2652p-network`,
  `znp-nv`): the point is to validate what the library exposes.
- No automated execution: `vitest` only covers `src/`; probes need hardware.

## Approaches

1. **Standalone scripts importing the public API** (picked): each script is
   runnable with `node probes/<name>.ts` (Node 24 strips TypeScript
   natively, no new dependency), sharing one small helper
   (`probes/open-port/open-port.ts`) that selects the port through
   `NodeSerial.requestPort` with the Silicon Labs USB filter.
2. Scripts using the internal layers for deep diagnostics (rejected: the
   probes must validate the public surface, per the library's purpose).
3. A single interactive CLI menu (rejected: heavier, and each probe is more
   useful copy-pasteable and independently runnable).

## Parts

```
probes/
├── README.md               prerequisites (usbipd, dialout group, Koenkk
│                           firmware 20250321) and per-probe usage
├── open-port/open-port.ts  shared helper: NodeSerial.requestPort with the
│                           Silicon Labs USB filter (0x10c4)
├── list-ports.ts           NodeSerial.getPorts() listing
├── ping.ts                 coordinator.readDeviceState()
├── smoke.ts                readDeviceState + config.read + permitJoin(60, 0)
│                           + short frame-observation window
├── monitor.ts              continuous ZCL frame observation, Ctrl+C to stop
└── config-write.ts         config.read → config.write; without arguments it
                            is non-destructive (radio tuning only), passing
                            --channel/--pan-id/--ext-pan-id/--key triggers a
                            re-commissioning (destructive, clearly labelled)
```

Console output in English; imports point to `../src/…` while the repo is the
development workspace.

## Left to the builder

Exact wording of the README, the graceful Ctrl+C wiring, and the argument
parsing style of `config-write.ts`.
