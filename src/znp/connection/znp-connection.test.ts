import { describe, expect, it } from 'vitest';

import { MockSerialPort, TestTools } from '../../../fabrique/test/tools.ts';
import {
  encodeZnpFrame,
  ZnpFrameType,
  ZnpSubsystem,
  type ZnpFrame,
  type ZnpSubsystem as ZnpSubsystemType,
} from '../frame/znp-frame.ts';
import { ZnpConnection } from './znp-connection.ts';

const mockDeviceResponse = (bytes: Uint8Array): Uint8Array[] | undefined => {
  // Any SREQ is answered with a SRSP of the same subsystem and command.
  if (bytes[0] === 0xfe && (bytes[2] as number) >> 5 === ZnpFrameType.SREQ) {
    const subsystem: ZnpSubsystemType = ((bytes[2] as number) & 0x1f) as ZnpSubsystemType;
    const commandId: number = bytes[3] as number;
    return [
      encodeZnpFrame({
        type: ZnpFrameType.SRSP,
        subsystem,
        commandId,
        payload: Uint8Array.from([0x00]),
      }),
    ];
  }
  return undefined;
};

describe('ZnpConnection', () => {
  it('opens the port at 115200 8N1 without flow control by default', async () => {
    const port: MockSerialPort = new MockSerialPort();
    await ZnpConnection.open(port);
    expect(port.options).toEqual({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });
  });

  it('resolves a request with the matching serial response', async () => {
    const port: MockSerialPort = new MockSerialPort();
    port.respond = mockDeviceResponse;
    const connection: ZnpConnection = await ZnpConnection.open(port);
    const response: Awaited<ReturnType<ZnpConnection['request']>> = await connection.request(
      ZnpSubsystem.SYS,
      0x02,
    );
    expect(response.type).toBe(ZnpFrameType.SRSP);
    expect(response.subsystem).toBe(ZnpSubsystem.SYS);
    expect(response.commandId).toBe(0x02);
    expect(response.payload).toEqual(Uint8Array.from([0x00]));
    // The request has been written to the port.
    expect(port.written[0]).toEqual(Uint8Array.from([0xfe, 0x00, 0x21, 0x02, 0x23]));
  });

  it('serializes concurrent requests', async () => {
    const port: MockSerialPort = new MockSerialPort();
    port.respond = mockDeviceResponse;
    const connection: ZnpConnection = await ZnpConnection.open(port);
    const [first, second] = await Promise.all([
      connection.request(ZnpSubsystem.SYS, 0x01),
      connection.request(ZnpSubsystem.SYS, 0x02),
    ]);
    expect(first.commandId).toBe(0x01);
    expect(second.commandId).toBe(0x02);
    // Requests were written one after the other, without interleave.
    expect(port.written.length).toBe(2);
    expect(port.written[0]?.[3]).toBe(0x01);
    expect(port.written[1]?.[3]).toBe(0x02);
  });

  it('times out when no matching response arrives', async () => {
    const port: MockSerialPort = new MockSerialPort();
    // The device never responds.
    const connection: ZnpConnection = await ZnpConnection.open(port);
    await expect(
      connection.request(ZnpSubsystem.SYS, 0x02, new Uint8Array(0), { timeout: 30 }),
    ).rejects.toThrow(/timed out/);
  });

  it('routes asynchronous indications to listeners', async () => {
    const port: MockSerialPort = new MockSerialPort();
    const connection: ZnpConnection = await ZnpConnection.open(port);
    const received: Uint8Array[] = [];
    connection.onFrame((frame): void => {
      if (frame.subsystem === ZnpSubsystem.ZDO) {
        received.push(frame.payload);
      }
    });
    // The device pushes an unsolicited ZDO state change indication.
    port.push(Uint8Array.from([0xfe, 0x01, 0x45, 0xc0, 0x09, 0x8d]));
    await TestTools.sleep(10);
    expect(received).toEqual([Uint8Array.from([0x09])]);
  });

  it('resolves a pending wait when a matching indication arrives', async () => {
    const port: MockSerialPort = new MockSerialPort();
    const connection: ZnpConnection = await ZnpConnection.open(port);
    const pending: Promise<ZnpFrame> = connection.waitFor(
      (frame): boolean => frame.subsystem === ZnpSubsystem.ZDO,
    );
    port.push(Uint8Array.from([0xfe, 0x01, 0x45, 0xc0, 0x09, 0x8d]));
    const frame: ZnpFrame = await pending;
    expect(frame.commandId).toBe(0xc0);
  });

  it('refuses to close a port whose streams are locked, keeping it open', async () => {
    const port: MockSerialPort = new MockSerialPort();
    await port.open({ baudRate: 115200 });
    const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = port.readable?.getReader();
    const writer: WritableStreamDefaultWriter<Uint8Array> | undefined = port.writable?.getWriter();
    await expect(port.close()).rejects.toThrow();
    expect(port.opened).toBe(true);
    reader?.releaseLock();
    writer?.releaseLock();
    await port.close();
    expect(port.opened).toBe(false);
  });

  it('releases the port on close so it can be reopened', async () => {
    const port: MockSerialPort = new MockSerialPort();
    const connection: ZnpConnection = await ZnpConnection.open(port);
    await connection.close();
    expect(port.opened).toBe(false);
    await ZnpConnection.open(port);
    expect(port.opened).toBe(true);
  });

  it('rejects pending waits on close', async () => {
    const port: MockSerialPort = new MockSerialPort();
    const connection: ZnpConnection = await ZnpConnection.open(port);
    const pending: Promise<unknown> = connection.waitFor((): boolean => true);
    await connection.close();
    await expect(pending).rejects.toThrow(/closed/);
    await expect(connection.request(ZnpSubsystem.SYS, 0x02)).rejects.toThrow(/closed/);
  });
});
