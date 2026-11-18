import type { ZCLCommandFrame } from '@thingmate/zigbee';
import { Cc2652pZigbeeCoordinator } from '../src/cc2652p-zigbee-coordinator/cc2652p-zigbee-coordinator.ts';
import { requestCoordinatorPort } from './open-port/open-port.ts';

/** Duration of the frame observation window, in milliseconds. */
const OBSERVATION_WINDOW_MS = 15000 as const;

function formatFrame(frame: ZCLCommandFrame): string {
  const device: string =
    typeof frame.device === 'bigint'
      ? `0x${frame.device.toString(16)}`
      : `0x${frame.device.toString(16).padStart(4, '0')}`;
  const payload: string = Array.from(frame.payload)
    .map((byte: number): string => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${device}/${frame.endpoint} cluster 0x${frame.cluster.toString(16).padStart(4, '0')} command 0x${frame.command
    .toString(16)
    .padStart(2, '0')} payload ${payload || '(empty)'} [${frame.direction}]`;
}

const port = await requestCoordinatorPort();
const coordinator: Cc2652pZigbeeCoordinator = new Cc2652pZigbeeCoordinator(port);

const state: number = await coordinator.readDeviceState();
console.log(`device state: ${state}`);

const config = await coordinator.config.read.call(new AbortController().signal);
console.log(
  `config: channel ${config.channel}  panId 0x${config.panId.toString(16).padStart(4, '0')}  extPanId 0x${config.extPanId
    .toString(16)
    .padStart(16, '0')}  key ${Array.from(config.key)
    .map((byte: number): string => byte.toString(16).padStart(2, '0'))
    .join('')}  txRadio ${config.txRadio} dBm`,
);

console.log('opening the network for 60 seconds...');
await coordinator.permitJoin.call(new AbortController().signal, 60);

const controller: AbortController = new AbortController();
const resource = await coordinator.command.observe.call(controller.signal);
resource.listen((frame): void => {
  console.log(`frame: ${formatFrame(frame[0] as ZCLCommandFrame)}`);
});
console.log(
  `observing incoming frames for ${OBSERVATION_WINDOW_MS / 1000} seconds (pair a device now if you want)...`,
);
await new Promise<void>((resolve: () => void): void => {
  setTimeout(resolve, OBSERVATION_WINDOW_MS);
});

console.log('closing the network...');
await coordinator.permitJoin.call(new AbortController().signal, 0);
await resource.close();
await coordinator.close();
console.log('smoke test done');
