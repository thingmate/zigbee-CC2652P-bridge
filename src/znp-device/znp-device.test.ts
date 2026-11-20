import { describe, expect, it } from 'vitest';

import { MockZnpDevice } from '../../fabrique/test/mock-znp-device.ts';
import { ZnpSubsystem } from '../znp-frame/znp-frame.ts';
import { ZNP_NV_ITEM_ID } from '../znp-network/znp-network.ts';
import { ZnpDevice } from './znp-device.ts';

const NETWORK = {
  channel: 11,
  panId: 0x1234,
  extPanId: 0x0807060504030201n,
  key: Uint8Array.from([
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  ]),
};

describe('ZnpDevice', () => {
  it('commissions a network on first start when none is configured', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await device.ensureStarted();
    expect(mock.getNvItem(ZNP_NV_ITEM_ID.ZNP_HAS_CONFIGURED)).toEqual(Uint8Array.from([0x55]));
    // The Zigbee endpoint has been registered.
    const register: Uint8Array | undefined = mock.port.written.find(
      (bytes: Uint8Array): boolean => bytes[2] === 0x24 && bytes[3] === 0x00,
    );
    expect(register).toBeDefined();
  });

  it('skips commissioning when the coordinator already runs a network', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    mock.deviceState = 0x09; // ZB_COORD
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await device.ensureStarted();
    expect(mock.getNvItem(ZNP_NV_ITEM_ID.ZNP_HAS_CONFIGURED)).toBeUndefined();
    // No commissioning request has been written.
    expect(
      mock.port.written.some(
        (bytes: Uint8Array): boolean => bytes[2] === 0x2f && bytes[3] === 0x05,
      ),
    ).toBe(false);
  });

  it('resumes the network when it was configured by a previous session', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    mock.deviceState = 0x00; // HOLD
    mock.setNvItem(ZNP_NV_ITEM_ID.ZNP_HAS_CONFIGURED, Uint8Array.from([0x55]));
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await device.ensureStarted();
    // A ZDO startup-from-app request has been written.
    expect(
      mock.port.written.some(
        (bytes: Uint8Array): boolean => bytes[2] === 0x25 && bytes[3] === 0x40,
      ),
    ).toBe(true);
  });

  it('reads the configuration reported by the coordinator', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await device.ensureStarted();
    expect(await device.readConfig()).toEqual({ ...NETWORK, txRadio: 5 });
  });

  it('stores a configuration written before the first start', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await device.writeConfig({
      channel: 25,
      panId: 0x4321,
      extPanId: 0x01n,
      key: new Uint8Array(16),
      txRadio: 3,
    });
    expect(mock.port.written.length).toBe(0);
    // The configuration is applied on the first start.
    await device.ensureStarted();
    expect(mock.getNvItem(ZNP_NV_ITEM_ID.PANID)).toEqual(Uint8Array.from([0x21, 0x43]));
    expect(mock.getNvItem(ZNP_NV_ITEM_ID.CHANLIST)).toEqual(
      Uint8Array.from([0x00, 0x00, 0x00, 0x02]),
    );
  });

  it('only tunes the radio when the written network parameters are unchanged', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await device.ensureStarted();
    const before: number = mock.port.written.length;
    await device.writeConfig({ ...NETWORK, txRadio: 3 });
    const written: readonly Uint8Array[] = mock.port.written.slice(before);
    // The configuration was read (2 requests) and a single stack tuning
    // request was written: no commissioning exchange happened.
    expect(
      written.filter((bytes: Uint8Array): boolean => bytes[2] === 0x21 && bytes[3] === 0x0f).length,
    ).toBe(1);
    expect(
      written.some((bytes: Uint8Array): boolean => bytes[2] === 0x2f && bytes[3] === 0x05),
    ).toBe(false);
  });

  it('re-commissions the network when the written parameters differ', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await device.ensureStarted();
    const configurations: unknown[] = [];
    device.onConfig((config): void => {
      configurations.push(config);
    });
    const before: number = mock.port.written.length;
    await device.writeConfig({
      channel: 20,
      panId: 0x5678,
      extPanId: 0xaabbccddn,
      key: new Uint8Array(16),
      txRadio: 7,
    });
    expect(mock.port.written.length).toBeGreaterThan(before);
    expect(mock.getNvItem(ZNP_NV_ITEM_ID.PANID)).toEqual(Uint8Array.from([0x78, 0x56]));
    expect(configurations.length).toBeGreaterThan(0);
  });

  it('emits the configuration after a startup', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    const configurations: unknown[] = [];
    device.onConfig((config): void => {
      configurations.push(config);
    });
    await device.ensureStarted();
    expect(configurations).toEqual([{ ...NETWORK, txRadio: 5 }]);
  });

  it('dispatches frames to registered listeners after a startup', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await device.ensureStarted();
    const payloads: Uint8Array[] = [];
    device.onFrame((frame): void => {
      if (frame.subsystem === ZnpSubsystem.ZDO) {
        payloads.push(frame.payload);
      }
    });
    mock.pushAreq({
      type: 2,
      subsystem: ZnpSubsystem.ZDO,
      commandId: 0xc0,
      payload: Uint8Array.from([0x09]),
    });
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
    expect(payloads).toEqual([Uint8Array.from([0x09])]);
  });

  it('retries the startup after a failure', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    mock.genericStatus = 0x02; // every request fails
    const device: ZnpDevice = new ZnpDevice(mock.port);
    await expect(device.ensureStarted()).rejects.toThrow();
    mock.genericStatus = 0x00;
    await device.ensureStarted();
  });
});
