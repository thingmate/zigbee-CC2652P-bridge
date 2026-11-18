# Hardware probes

Runnable scripts exercising the library's public API against a real CC2652P
dongle (SONOFF ZBDongle-P among others). Every probe goes through
`Cc2652pZigbeeCoordinator` — plus `NodeSerial` to select the port — never
through the internal layers: they double as usage examples of the library.

## Prerequisites

- A dongle attached and accessible from this environment. On Windows + WSL,
  follow [`../windows-wsl-usb-setup.md`](../windows-wsl-usb-setup.md): share
  and attach the port with `usbipd` (`usbipd attach --wsl --auto-attach
--busid <busid>`), and be in the `dialout` group
  (`sudo usermod -aG dialout $USER`, then restart WSL) — otherwise opening the
  port fails with a permission error.
- The coordinator should run the
  [Koenkk Z-Stack coordinator firmware](https://github.com/Koenkk/Z-Stack-firmware/releases)
  `20250321` or newer: the ITead factory firmware (build `20210708`) stops
  answering MT requests after the first exchange following each power-on.
- Node.js ≥ 24 (the scripts run with native TypeScript stripping, no build
  step and no extra dependency).

## Running

From the repository root:

```shell
node probes/<probe-name>.ts
```

The port is selected through the Web Serial API filters (USB vendor
`10c4`, the Silicon Labs CP2102N bridge): attach a single matching dongle, or
`requestPort` refuses to guess between several matches.

| Probe             | What it does                                                                                                                              | Network impact                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `list-ports.ts`   | lists every serial port with its USB identity                                                                                             | none                                                                                                                  |
| `ping.ts`         | opens the port, starts the coordinator if needed, reports the device state (`9` = running as coordinator)                                 | none                                                                                                                  |
| `smoke.ts`        | full pass: device state, configuration read-back, network opened for 60 seconds, 15-second frame observation window, network closed       | none                                                                                                                  |
| `monitor.ts`      | observes incoming ZCL frames continuously — run it while pairing devices; stops cleanly on Ctrl+C                                         | none                                                                                                                  |
| `config-write.ts` | reads the configuration and writes it back; with `--channel`, `--pan-id`, `--ext-pan-id` or `--key` arguments, re-commissions the network | **re-forms the network with arguments** (every paired device must be paired again); non-destructive without arguments |

## Notes

- The first probe that touches the coordinator opens the port (115200 bauds),
  skips a possible serial bootloader, and starts or resumes the network: a
  network commissioned by a previous session is resumed, a fresh one is formed
  with the configuration previously written through `config-write.ts`, or with
  randomly generated parameters.
- Frames are printed as
  `device/endpoint cluster 0x… command 0x… payload <hex> [direction]`.
