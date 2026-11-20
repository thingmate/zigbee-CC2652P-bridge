import { ZnpZigbeeCoordinator } from '../src/zigbee/znp-zigbee-coordinator/znp-zigbee-coordinator.ts';
import { requestCoordinatorPort } from './open-port/open-port.ts';

const STATE_MEANING: Readonly<Record<number, string>> = {
  0: 'hold (network not started)',
  9: 'running as coordinator',
};

try {
  const port = await requestCoordinatorPort();
  const coordinator: ZnpZigbeeCoordinator = ZnpZigbeeCoordinator.fromPort(port);
  const state: number = await coordinator.readDeviceState();
  console.log(`device state: ${state} (${STATE_MEANING[state] ?? 'unknown'})`);
  await coordinator.close();
} catch (error: unknown) {
  console.error(`ping failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
