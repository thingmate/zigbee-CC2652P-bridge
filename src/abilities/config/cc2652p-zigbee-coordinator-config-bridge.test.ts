import { describe, expect, it } from 'vitest';

import { MockZnpDevice } from '../../../fabrique/test/mock-znp-device.ts';
import { Cc2652pZigbeeCoordinatorConfigBridge } from './cc2652p-zigbee-coordinator-config-bridge.ts';

describe('Cc2652pZigbeeCoordinatorConfigBridge', () => {
  it('reads the configuration reported by the coordinator', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const abilities: Cc2652pZigbeeCoordinatorConfigBridge =
      new Cc2652pZigbeeCoordinatorConfigBridge(
        // The bridge only needs the device's abilities; a real device is
        // constructed with the mock's port.
        new (await import('../../cc2652p-znp-device/cc2652p-znp-device.ts')).Cc2652pZnpDevice(
          mock.port,
        ),
      );
    const config: Awaited<ReturnType<typeof abilities.read.call>> = await abilities.read.call(
      new AbortController().signal,
    );
    expect(config).toEqual({
      channel: 11,
      panId: 0x1234,
      extPanId: 0x0807060504030201n,
      key: Uint8Array.from([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f,
      ]),
      txRadio: 5,
    });
  });

  it('emits the configuration through the observation', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const { Cc2652pZnpDevice } = await import('../../cc2652p-znp-device/cc2652p-znp-device.ts');
    const abilities: Cc2652pZigbeeCoordinatorConfigBridge =
      new Cc2652pZigbeeCoordinatorConfigBridge(new Cc2652pZnpDevice(mock.port));
    const controller: AbortController = new AbortController();
    const resource: Awaited<ReturnType<typeof abilities.observe.call>> =
      await abilities.observe.call(controller.signal);
    const configurations: unknown[] = [];
    resource.listen((config: unknown): void => {
      configurations.push(config);
    });
    // Let the listener attach, then trigger a configuration update through a
    // re-commissioning write.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
    await abilities.write.call(controller.signal, {
      channel: 11,
      panId: 0x1234,
      extPanId: 0x0807060504030201n,
      key: new Uint8Array(16).fill(1),
      txRadio: 5,
    });
    expect(configurations.length).toBeGreaterThan(0);
    await resource.close();
  });
});
