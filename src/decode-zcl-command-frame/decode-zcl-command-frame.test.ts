import { describe, expect, it } from 'vitest';

import { decodeZclCommandFrame } from './decode-zcl-command-frame.ts';

describe('decodeZclCommandFrame', () => {
  it('decodes a cluster-specific server-to-client command with a payload', () => {
    // Report Attributes (0x0a) from the On/Off cluster: attribute 0x0000, boolean 0x01.
    expect(
      decodeZclCommandFrame(Uint8Array.from([0x19, 0x21, 0x0a, 0x00, 0x00, 0x10, 0x01])),
    ).toEqual({
      clusterSpecific: true,
      direction: 'server-to-client',
      sequence: 0x21,
      command: 0x0a,
      payload: Uint8Array.from([0x00, 0x00, 0x10, 0x01]),
    });
  });

  it('decodes a profile-wide client-to-server command without a payload', () => {
    expect(decodeZclCommandFrame(Uint8Array.from([0x10, 0x5a, 0x00]))).toEqual({
      clusterSpecific: false,
      direction: 'client-to-server',
      sequence: 0x5a,
      command: 0x00,
      payload: new Uint8Array(0),
    });
  });

  it('skips a manufacturer code but keeps decoding', () => {
    expect(decodeZclCommandFrame(Uint8Array.from([0x15, 0xc1, 0xc2, 0x5a, 0x02]))).toEqual({
      clusterSpecific: true,
      direction: 'client-to-server',
      sequence: 0x5a,
      command: 0x02,
      payload: new Uint8Array(0),
    });
  });

  it('throws when the frame header is truncated', () => {
    expect(() => decodeZclCommandFrame(Uint8Array.from([0x10, 0x5a]))).toThrow();
  });

  it('throws when the manufacturer code is truncated', () => {
    expect(() => decodeZclCommandFrame(Uint8Array.from([0x14, 0xc1]))).toThrow();
  });
});
