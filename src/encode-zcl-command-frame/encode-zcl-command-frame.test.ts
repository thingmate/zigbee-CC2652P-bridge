import { describe, expect, it } from 'vitest';

import { encodeZclCommandFrame } from './encode-zcl-command-frame.ts';

describe('encodeZclCommandFrame', () => {
  it('encodes a cluster-specific client-to-server command', () => {
    // On/Off cluster (0x0006) `Toggle` (0x02) to endpoint 1.
    expect(
      encodeZclCommandFrame(
        {
          device: 0x2916,
          endpoint: 1,
          cluster: 0x0006,
          clusterSpecific: true,
          direction: 'client-to-server',
          command: 0x02,
          payload: new Uint8Array(0),
        },
        0x5a,
      ),
    ).toEqual(Uint8Array.from([0x11, 0x5a, 0x02]));
  });

  it('encodes a profile-wide client-to-server command with a payload', () => {
    // Read Attributes (0x00) on the On/Off cluster, attribute 0x0000.
    expect(
      encodeZclCommandFrame(
        {
          device: 0x0001,
          endpoint: 1,
          cluster: 0x0006,
          clusterSpecific: false,
          direction: 'client-to-server',
          command: 0x00,
          payload: Uint8Array.from([0x00, 0x00]),
        },
        0x01,
      ),
    ).toEqual(Uint8Array.from([0x10, 0x01, 0x00, 0x00, 0x00]));
  });

  it('encodes a server-to-client command', () => {
    expect(
      encodeZclCommandFrame(
        {
          device: 0x0001,
          endpoint: 1,
          cluster: 0x0006,
          clusterSpecific: false,
          direction: 'server-to-client',
          command: 0x01,
          payload: Uint8Array.from([0x00]),
        },
        0x7f,
      ),
    ).toEqual(Uint8Array.from([0x18, 0x7f, 0x01, 0x00]));
  });

  it('wraps the transaction sequence number to a single byte', () => {
    expect(
      encodeZclCommandFrame(
        {
          device: 0,
          endpoint: 1,
          cluster: 0,
          clusterSpecific: false,
          direction: 'client-to-server',
          command: 0,
          payload: new Uint8Array(0),
        },
        0x1ff,
      ),
    ).toEqual(Uint8Array.from([0x10, 0xff, 0x00]));
  });
});
