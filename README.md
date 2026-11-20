[![npm (scoped)](https://img.shields.io/npm/v/@thingmate/znp-zigbee-bridge.svg)](https://www.npmjs.com/package/@thingmate/znp-zigbee-bridge)
![npm](https://img.shields.io/npm/dm/@thingmate/znp-zigbee-bridge.svg)
![NPM](https://img.shields.io/npm/l/@thingmate/znp-zigbee-bridge.svg)
![npm type definitions](https://img.shields.io/npm/types/@thingmate/znp-zigbee-bridge.svg)
![AI generation](https://img.shields.io/badge/AI_generation-high-yellow)

<picture>
  <source height="64" media="(prefers-color-scheme: dark)" srcset="https://github.com/thingmate/website/blob/main/assets/logo/png/logo-large-dark.png?raw=true">
  <source height="64" media="(prefers-color-scheme: light)" srcset="https://github.com/thingmate/website/blob/main/assets/logo/png/logo-large-light.png?raw=true">
  <img height="64" alt="Shows a black logo in light color mode and a white one in dark color mode." src="https://github.com/thingmate/website/blob/main/assets/logo/png/logo-large-light.png?raw=true">
</picture>

## @thingmate/znp-zigbee-bridge

Drive a [Zigbee coordinator](https://www.npmjs.com/package/@thingmate/zigbee) from a Z-Stack 3.x ZNP coordinator (SONOFF ZBDongle-P, CC1352P, CC2531 among others) over a [Web Serial API](https://wicg.github.io/serial/) port.

## 📦 Installation

```shell
yarn add @thingmate/znp-zigbee-bridge
# or
npm install @thingmate/znp-zigbee-bridge --save
```

## 📜 Documentation

See also [`probes/README.md`](./probes/README.md): runnable hardware probes exercising the public API against a real dongle.

This library bridges a `ZigbeeCoordinator` to a Z-Stack ZNP coordinator speaking the ZNP (Monitor-and-Test) protocol over a serial port. The port is provided as a Web Serial API `SerialPort`: any spec-faithful port works, so the same code runs in a browser (port from `navigator.serial`), in Node.js (through the `NodeSerial` hub of [`@thingmate/node-web-serial`](https://www.npmjs.com/package/@thingmate/node-web-serial)), or in tests (any mock).

Each coordinator ability is mapped to ZNP commands:

| Ability                          | ZNP commands                                                   | Behaviour                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `config.read` / `config.observe` | `ZDO_EXT_NWK_INFO` + `UTIL_GET_NV_INFO`                        | reads and observes the network configuration reported by the coordinator                                                         |
| `config.write`                   | `SYS_OSAL_NV_*` + `APP_CNF_BDB_*`                              | applies the configuration: the radio power is set immediately, the network parameters re-commission the network when they differ |
| `permitJoin`                     | `ZDO_PERMIT_JOINING_REQ` (broadcast)                           | opens the network to new devices for the given duration, or closes it immediately for `0`                                        |
| `command.send`                   | `AF_DATA_REQUEST` (+ `AF_DATA_REQUEST_EXT` for 64-bit targets) | sends a `ZCLCommandFrame` and waits for its AF data confirmation                                                                 |
| `command.observe`                | `AF_INCOMING_MSG`                                              | emits the ZCL frames received by the coordinator                                                                                 |

The first ability call opens the port (115200 bauds), skips a possible serial bootloader, and starts the network: a network commissioned by a previous session is resumed, otherwise a new one is formed (with the configuration previously written, or randomly generated). The Zigbee endpoint used to send and observe frames is registered at the same time.

### Usage

```ts
import { NodeSerial } from '@thingmate/node-web-serial';
import { ZnpZigbeeCoordinator } from '@thingmate/znp-zigbee-bridge/src/zigbee/znp-zigbee-coordinator/znp-zigbee-coordinator.ts';

// select the coordinator's serial port (USB filters, as in a browser)
const serial: NodeSerial = new NodeSerial();
const port = await serial.requestPort({ filters: [{ usbVendorId: 0x10c4 }] }); // Silicon Labs CP2102N

// the standard ZigbeeCoordinator abilities, backed by the dongle
const coordinator: ZnpZigbeeCoordinator = ZnpZigbeeCoordinator.fromPort(port);

// read the current network configuration
const config = await coordinator.config.read.call(new AbortController().signal);

// open the network to new devices for 60 seconds
await coordinator.permitJoin.call(new AbortController().signal, 60);

// send a ZCL command frame to a device
await coordinator.command.send.call(new AbortController().signal, {
  device: 0x2916,
  endpoint: 1,
  cluster: 0x0006,
  clusterSpecific: true,
  direction: 'client-to-server',
  command: 0x01, // On
  payload: new Uint8Array(0),
});

// observe the frames received by the coordinator
const frames = await coordinator.command.observe.call(new AbortController().signal);
frames.listen((frame) => console.log(frame));
```

> [!NOTE]
> The coordinator should run the [Koenkk Z-Stack 3.x coordinator firmware](https://github.com/Koenkk/Z-Stack-firmware/releases) (`20250321` or newer). The ITead factory firmware (build `20210708`) stops answering MT requests after the first exchange following each power-on. See [`windows-wsl-usb-setup.md`](./windows-wsl-usb-setup.md) for the Windows + WSL serial setup and the flashing procedure.
