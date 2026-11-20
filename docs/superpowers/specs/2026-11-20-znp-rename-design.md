# Design: rename the CC2652P scope to ZNP

Date: 2026-11-20
Status: approved

## Intent and why

The library is a Z-Stack ZNP bridge, not a CC2652P-specific one: the code below
the abilities already speaks only Z-Stack 3.x ZNP (MT framing, NV items, ZDO
states, network commissioning) and works for any ZNP device — CC2531, CC2652R,
CC1352P, the SONOFF ZBDongle-P among others. The `Cc2652p` prefix over-constrains
the naming. Cross-manufacturer support (Silicon Labs EZSP, ConBee, …) will come
as separate bridge repositories sharing `@thingmate/zigbee`, not as a seam inside
this one: the repository boundary is the seam.

## Goals

- Rename the code scope from `cc2652p`/`Cc2652p` to `znp`/`Znp` (folders, files,
  classes, types, imports, tests).
- Rename the package to `@thingmate/znp-zigbee-bridge` and the repository to
  `thingmate/znp-zigbee-bridge` (package.json `name` and `repository.url`,
  README badges, title, install commands, import example).
- State the scope plainly: Z-Stack 3.x ZNP coordinators.

## Non-goals

- No behavior change; no structural refactor (the ability bridges keep speaking
  ZNP — this repository is the ZNP bridge by definition).
- No edit to historical records under `docs/superpowers/`.
- No GitHub-side actions (the repository rename on GitHub and the local
  directory rename are the owner's; the `repository.url` field is updated here).

## Naming map

| Current                                          | New                                      |
| ------------------------------------------------ | ---------------------------------------- |
| `@thingmate/zigbee-CC2652P-bridge`               | `@thingmate/znp-zigbee-bridge`           |
| `github.com/thingmate/zigbee-CC2652P-bridge`     | `github.com/thingmate/znp-zigbee-bridge` |
| `src/cc2652p-znp-device/` (+ file, test)         | `src/znp-device/`                        |
| `src/cc2652p-zigbee-coordinator/` (+ file, test) | `src/znp-zigbee-coordinator/`            |
| `src/cc2652p-network/` (+ file)                  | `src/znp-network/`                       |
| `Cc2652pZnpDevice`                               | `ZnpDevice`                              |
| `Cc2652pZigbeeCoordinator`                       | `ZnpZigbeeCoordinator`                   |
| `Cc2652pNetworkOptions`                          | `ZnpNetworkOptions`                      |
| `Cc2652pZigbeeCoordinatorConfigBridge`           | `ZnpZigbeeCoordinatorConfigBridge`       |
| `Cc2652pZigbeeCommandFrameBridge`                | `ZnpZigbeeCommandFrameBridge`            |

- `ZnpConnection`, `ZnpFrame`, `ZnpNvMemory` already carry the right name.
- The `cc2652p`/`zbdongle-p` keywords stay in `package.json` (discovery
  metadata for ZBDongle-P owners), as do hardware-level CC2652P mentions in
  hardware documentation (the ZBDongle-P dongle is CC2652P hardware).
- Description and README scope sentence become "Z-Stack 3.x ZNP coordinator"
  phrasing.

## Changes

1. `git mv` the three folders, rename their files, rename the five class/type
   names and every import (sources, tests, probes).
2. `package.json`: `name`, `repository.url`, description.
3. `README.md`, `probes/README.md`: package name, import path, class names,
   scope sentence.

## Left to the builder

- Exact wording of the README scope sentence and package description.
- Running `yarn fb:check` and `yarn fb:test`, and a stale-reference grep
  (`cc2652p`/`Cc2652p` outside `docs/superpowers/` and hardware docs) as the
  completion gate.
