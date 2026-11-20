import { describe, expect, it } from 'vitest';

import { MockZnpDevice } from '../../../../fabrique/test/mock-znp-device.ts';
import { ZnpDevice } from '../../../znp/device/znp-device.ts';
import { ZnpSubsystem } from '../../../znp/frame/znp-frame.ts';
import { ZnpZigbeeCommandFrameBridge } from './znp-zigbee-command-frame-bridge.ts';

describe('ZnpZigbeeCommandFrameBridge', () => {
  it('sends a ZCL command frame through an AF data request', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    const abilities: ZnpZigbeeCommandFrameBridge = new ZnpZigbeeCommandFrameBridge(device);
    // The AF data confirmation is pushed when the data request is seen.
    mock.port.written.length = 0;
    await device.ensureStarted();
    const originalRespond: (bytes: Uint8Array) => Uint8Array[] | undefined = mock.port.respond;
    mock.port.respond = (bytes: Uint8Array): Uint8Array[] | undefined => {
      const responses: Uint8Array[] | undefined = originalRespond(bytes);
      // AF data request: respond with a matching data confirmation.
      if (bytes[2] === 0x24 && bytes[3] === 0x01) {
        mock.pushAreq({
          type: 2,
          subsystem: ZnpSubsystem.AF,
          commandId: 0x80,
          payload: Uint8Array.from([0x00, 0x01, 0x00]),
        });
      }
      return responses;
    };
    await abilities.send.call(new AbortController().signal, {
      device: 0x2916,
      endpoint: 1,
      cluster: 0x0006,
      clusterSpecific: true,
      direction: 'client-to-server',
      command: 0x02,
      payload: new Uint8Array(0),
    });
    const dataRequest: Uint8Array | undefined = mock.port.written.find(
      (bytes: Uint8Array): boolean => bytes[2] === 0x24 && bytes[3] === 0x01,
    );
    expect(dataRequest).toBeDefined();
    // [dstAddr(2), dstEndpoint(1), srcEndpoint(1), clusterId(2), transId(1), options(1), radius(1), len(1), data]
    expect(dataRequest?.slice(4, 17)).toEqual(
      Uint8Array.from([
        0x16, 0x29, 0x01, 0x01, 0x06, 0x00, 0x00, 0x00, 0x1e, 0x03, 0x11, 0x00, 0x02,
      ]),
    );
  });

  it('observes ZCL command frames received by the coordinator', async () => {
    const mock: MockZnpDevice = new MockZnpDevice();
    const device: ZnpDevice = new ZnpDevice(mock.port);
    const abilities: ZnpZigbeeCommandFrameBridge = new ZnpZigbeeCommandFrameBridge(device);
    const controller: AbortController = new AbortController();
    const resource: Awaited<ReturnType<typeof abilities.observe.call>> =
      await abilities.observe.call(controller.signal);
    const frames: unknown[] = [];
    resource.listen((frame: unknown): void => {
      frames.push(frame);
    });
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
    // AF_INCOMING_MSG: On/Off cluster report from device 0x2916, endpoint 1:
    // attribute 0x0000 (OnOff), boolean 0x00.
    mock.pushAreq({
      type: 2,
      subsystem: ZnpSubsystem.AF,
      commandId: 0x81,
      payload: Uint8Array.from([
        0x00,
        0x00, // group id
        0x06,
        0x00, // cluster id
        0x16,
        0x29, // source address
        0x01, // source endpoint
        0x01, // destination endpoint
        0x00, // was broadcast
        0xa0, // link quality
        0x00, // security use
        0x00,
        0x00,
        0x00,
        0x00, // timestamp
        0x01, // transaction sequence number (AF level)
        0x07, // data length
        0x19,
        0x21,
        0x0a,
        0x00,
        0x00,
        0x10,
        0x00, // ZCL: frame control, sequence, command (report), payload
      ]),
    });
    // Let the read loop deliver the frame through the observation chain.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
    expect(frames).toEqual([
      [
        {
          device: 0x2916,
          endpoint: 1,
          cluster: 0x0006,
          clusterSpecific: true,
          direction: 'server-to-client',
          command: 0x0a,
          payload: Uint8Array.from([0x00, 0x00, 0x10, 0x00]),
        },
      ],
    ]);
    await resource.close();
  });
});
