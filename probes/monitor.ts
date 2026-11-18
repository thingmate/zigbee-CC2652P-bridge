import type { ZCLCommandFrame } from '@thingmate/zigbee';
import { Cc2652pZigbeeCoordinator } from '../src/cc2652p-zigbee-coordinator/cc2652p-zigbee-coordinator.ts';
import { requestCoordinatorPort } from './open-port/open-port.ts';

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

const resource = await coordinator.command.observe.call(new AbortController().signal);
resource.listen((frame): void => {
  console.log(`frame: ${formatFrame(frame[0] as ZCLCommandFrame)}`);
});
console.log('observing incoming frames - press Ctrl+C to stop');

let closing: boolean = false;
process.on('SIGINT', (): void => {
  if (closing) {
    return;
  }
  closing = true;
  console.log('stopping...');
  void resource
    .close()
    .then((): Promise<void> => coordinator.close())
    .then((): void => {
      process.exit(0);
    });
});
