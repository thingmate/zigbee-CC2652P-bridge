import { describe, expect, it } from 'vitest';

import { MockZnpDevice } from '../../../fabrique/test/mock-znp-device.ts';
import { ZnpDevice } from '../../znp/device/znp-device.ts';
import { ZnpZigbeeCoordinator } from './znp-zigbee-coordinator.ts';

describe('ZnpZigbeeCoordinator', () => {
  it('opens the network through a broadcast ZDO permit-joining request', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const coordinator: ZnpZigbeeCoordinator = new ZnpZigbeeCoordinator(new ZnpDevice(mock.port));
    await coordinator.permitJoin.call(new AbortController().signal, 60);
    const permitJoin: Uint8Array | undefined = mock.port.written.find(
      (bytes: Uint8Array): boolean => bytes[2] === 0x25 && bytes[3] === 0x08,
    );
    // [addressMode = 3, destination = 0xfffc, duration = 60, tcSignificance = 1]
    expect(permitJoin?.slice(4, 9)).toEqual(Uint8Array.from([0x03, 0xfc, 0xff, 60, 0x01]));
    await coordinator.close();
  });

  it('closes the network immediately for a zero duration', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const coordinator: ZnpZigbeeCoordinator = new ZnpZigbeeCoordinator(new ZnpDevice(mock.port));
    await coordinator.permitJoin.call(new AbortController().signal, 0);
    const permitJoin: Uint8Array | undefined = mock.port.written.find(
      (bytes: Uint8Array): boolean => bytes[2] === 0x25 && bytes[3] === 0x08,
    );
    expect(permitJoin?.slice(4, 9)).toEqual(Uint8Array.from([0x03, 0xfc, 0xff, 0, 0x01]));
    await coordinator.close();
  });

  it('caps the permit-joining duration at 254 seconds', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const coordinator: ZnpZigbeeCoordinator = new ZnpZigbeeCoordinator(new ZnpDevice(mock.port));
    await coordinator.permitJoin.call(new AbortController().signal, 3600);
    const permitJoin: Uint8Array | undefined = mock.port.written.find(
      (bytes: Uint8Array): boolean => bytes[2] === 0x25 && bytes[3] === 0x08,
    );
    expect(permitJoin?.slice(4, 9)).toEqual(Uint8Array.from([0x03, 0xfc, 0xff, 254, 0x01]));
    await coordinator.close();
  });

  it('reads the coordinator device state', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    mock.deviceState = 0x09;
    const coordinator: ZnpZigbeeCoordinator = new ZnpZigbeeCoordinator(new ZnpDevice(mock.port));
    expect(await coordinator.readDeviceState()).toBe(0x09);
    await coordinator.close();
  });
});
