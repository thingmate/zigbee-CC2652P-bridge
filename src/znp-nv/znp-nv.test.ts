import { describe, expect, it } from 'vitest';

import { MockZnpDevice } from '../../fabrique/test/mock-znp-device.ts';
import { ZnpConnection } from '../znp-connection/znp-connection.ts';
import { ZnpNvMemory } from './znp-nv.ts';

describe('ZnpNvMemory', () => {
  it('reads an existing item in a single chunk', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    device.setNvItem(0x0021, Uint8Array.from([0x01, 0x02, 0x03]));
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    const nv: ZnpNvMemory = new ZnpNvMemory(connection);
    expect(await nv.readItem(0x0021)).toEqual(Uint8Array.from([0x01, 0x02, 0x03]));
  });

  it('returns null for a missing item', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    const nv: ZnpNvMemory = new ZnpNvMemory(connection);
    expect(await nv.readItem(0x9999)).toBeNull();
  });

  it('initializes and writes a new item, then reads it back', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    const nv: ZnpNvMemory = new ZnpNvMemory(connection);
    await nv.writeItem(0x0053, Uint8Array.from([0x34, 0x12]));
    expect(device.getNvItem(0x0053)).toEqual(Uint8Array.from([0x34, 0x12]));
    expect(await nv.readItem(0x0053)).toEqual(Uint8Array.from([0x34, 0x12]));
  });

  it('writes an existing item without reinitializing it', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    device.setNvItem(0x0053, Uint8Array.from([0x01, 0x01, 0x01, 0x01]));
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    const nv: ZnpNvMemory = new ZnpNvMemory(connection);
    await nv.writeItem(0x0053, Uint8Array.from([0x02, 0x02]));
    expect(device.getNvItem(0x0053)).toEqual(Uint8Array.from([0x02, 0x02, 0x01, 0x01]));
  });

  it('skips the write when updateItem finds the same value', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    device.setNvItem(0x0053, Uint8Array.from([0x01, 0x02]));
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    const nv: ZnpNvMemory = new ZnpNvMemory(connection);
    await nv.updateItem(0x0053, Uint8Array.from([0x01, 0x02]));
    // Only the length read happened: no write nor initialize exchange.
    const writeRequests: number = device.port.written.filter(
      (bytes: Uint8Array): boolean => bytes[2] === 0x21 && (bytes[3] === 0x1d || bytes[3] === 0x07),
    ).length;
    expect(writeRequests).toBe(0);
  });

  it('deletes an item', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    device.setNvItem(0x0021, Uint8Array.from([0x01]));
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    const nv: ZnpNvMemory = new ZnpNvMemory(connection);
    await nv.deleteItem(0x0021);
    expect(device.getNvItem(0x0021)).toBeUndefined();
    expect(await nv.readItem(0x0021)).toBeNull();
  });

  it('deleting a missing item is a no-op', async () => {
    const device: MockZnpDevice = new MockZnpDevice();
    const connection: ZnpConnection = await ZnpConnection.open(device.port);
    const nv: ZnpNvMemory = new ZnpNvMemory(connection);
    await nv.deleteItem(0x9999);
  });
});
