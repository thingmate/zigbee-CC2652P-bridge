import { describe, expect, it } from 'vitest';

import { MockZnpDevice } from '../../fabrique/test/mock-znp-device.ts';
import { ZnpConnection } from '../znp-connection/znp-connection.ts';
import {
  bigintToLittleEndian,
  commissionZnpNetwork,
  littleEndianToBigint,
  readZnpDeviceState,
  resetZnpCoordinator,
  resumeZnpNetwork,
  uintToLittleEndian,
  ZNP_NV_ITEM_ID,
} from './znp-network.ts';

const options = {
  channel: 15,
  panId: 0xabcd,
  extPanId: 0x0807060504030201n,
  key: Uint8Array.from([
    0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x09, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00,
  ]),
};

describe('commissionZnpNetwork', () => {
  it('commissions a network and reaches the ZB_COORD state', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    await commissionZnpNetwork(connection, options);
    // The coordinator marked itself as configured.
    expect(device.getNvItem(ZNP_NV_ITEM_ID.ZNP_HAS_CONFIGURED)).toEqual(Uint8Array.from([0x55]));
  });

  it('writes the commissioning parameters to non-volatile memory', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    await commissionZnpNetwork(connection, options);
    expect(device.getNvItem(ZNP_NV_ITEM_ID.CHANLIST)).toEqual(uintToLittleEndian(1 << 15, 4));
    expect(device.getNvItem(ZNP_NV_ITEM_ID.PANID)).toEqual(uintToLittleEndian(0xabcd, 2));
    expect(device.getNvItem(ZNP_NV_ITEM_ID.EXTENDED_PAN_ID)).toEqual(
      bigintToLittleEndian(options.extPanId, 8),
    );
    expect(device.getNvItem(ZNP_NV_ITEM_ID.APS_USE_EXT_PANID)).toEqual(
      bigintToLittleEndian(options.extPanId, 8),
    );
    expect(device.getNvItem(ZNP_NV_ITEM_ID.PRECFGKEY)).toEqual(options.key);
    expect(device.getNvItem(ZNP_NV_ITEM_ID.PRECFGKEYS_ENABLE)).toEqual(Uint8Array.from([0x00]));
    expect(device.getNvItem(ZNP_NV_ITEM_ID.LOGICAL_TYPE)).toEqual(Uint8Array.from([0x00]));
    expect(device.getNvItem(ZNP_NV_ITEM_ID.ZDO_DIRECT_CB)).toEqual(Uint8Array.from([0x01]));
  });

  it('deletes the NIB and pulses the startup option around the reset', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    await commissionZnpNetwork(connection, options);
    // The NIB has been deleted: the item is back at 0 (the mock initializes
    // items when written, and it never was here).
    expect(device.getNvItem(ZNP_NV_ITEM_ID.NIB)).toBeUndefined();
    // The startup option ended at `0`.
    expect(device.getNvItem(ZNP_NV_ITEM_ID.STARTUP_OPTION)).toEqual(Uint8Array.from([0x00]));
    // A reset request has been written.
    const resetRequest: Uint8Array | undefined = device.port.written.find(
      (bytes: Uint8Array): boolean => bytes[2] === 0x41 && bytes[3] === 0x00,
    );
    expect(resetRequest).toBeDefined();
  });
});

describe('resumeZnpNetwork', () => {
  it('starts the coordinator from the existing configuration', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    await resumeZnpNetwork(connection);
    const startupRequest: Uint8Array | undefined = device.port.written.find(
      (bytes: Uint8Array): boolean => bytes[2] === 0x25 && bytes[3] === 0x40,
    );
    expect(startupRequest).toBeDefined();
  });
});

describe('readZnpDeviceState', () => {
  it('reads the device state reported by the coordinator', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    device.deviceState = 0x09;
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    expect(await readZnpDeviceState(connection)).toBe(0x09);
  });
});

describe('resetZnpCoordinator', () => {
  it('waits for the reboot indication', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    await resetZnpCoordinator(connection);
  });
});

describe('byte conversion helpers', () => {
  it('converts numbers to little-endian bytes and back', () => {
    expect(uintToLittleEndian(0x1234, 2)).toEqual(Uint8Array.from([0x34, 0x12]));
    expect(uintToLittleEndian(0x12345678, 4)).toEqual(Uint8Array.from([0x78, 0x56, 0x34, 0x12]));
  });

  it('converts bigints to little-endian bytes and back', () => {
    const bytes: Uint8Array = bigintToLittleEndian(0x0807060504030201n, 8);
    expect(bytes).toEqual(Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]));
    expect(littleEndianToBigint(bytes)).toBe(0x0807060504030201n);
  });

  it('rejects bigints too large for the requested byte count', () => {
    expect(() => bigintToLittleEndian(0x100n, 1)).toThrow(/does not fit/);
  });
});
