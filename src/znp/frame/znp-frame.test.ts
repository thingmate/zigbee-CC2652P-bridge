import { describe, expect, it } from 'vitest';

import {
  encodeZnpFrame,
  ZnpFrameDecoder,
  ZnpFrameType,
  ZnpSubsystem,
  type ZnpFrame,
} from './znp-frame.ts';

describe('encodeZnpFrame', () => {
  it('encodes an empty-payload frame', () => {
    // SYS_VERSION SREQ as sent to the real coordinator.
    expect(
      encodeZnpFrame({
        type: ZnpFrameType.SREQ,
        subsystem: ZnpSubsystem.SYS,
        commandId: 0x02,
        payload: new Uint8Array(0),
      }),
    ).toEqual(Uint8Array.from([0xfe, 0x00, 0x21, 0x02, 0x23]));
  });

  it('encodes a frame with a payload', () => {
    // ZDO_PERMIT_JOINING_REQ broadcast, 60 seconds: [addrMode=0x03, dstAddr=0xfffc, duration=60, tcSignificance=1]
    expect(
      encodeZnpFrame({
        type: ZnpFrameType.SREQ,
        subsystem: ZnpSubsystem.ZDO,
        commandId: 0x08,
        payload: Uint8Array.from([0x03, 0xfc, 0xff, 60, 0x01]),
      }),
    ).toEqual(Uint8Array.from([0xfe, 0x05, 0x25, 0x08, 0x03, 0xfc, 0xff, 60, 0x01, 0x15]));
  });
});

describe('ZnpFrameDecoder', () => {
  it('decodes a frame delivered in a single chunk', () => {
    const decoder: ZnpFrameDecoder = new ZnpFrameDecoder();
    const frames: readonly ZnpFrame[] = decoder.push(
      Uint8Array.from([0xfe, 0x00, 0x21, 0x02, 0x23]),
    );
    expect(frames.length).toBe(1);
    expect(frames[0]).toEqual({
      type: ZnpFrameType.SREQ,
      subsystem: ZnpSubsystem.SYS,
      commandId: 0x02,
      payload: new Uint8Array(0),
    });
  });

  it('decodes a frame delivered in several chunks', () => {
    const decoder: ZnpFrameDecoder = new ZnpFrameDecoder();
    expect(decoder.push(Uint8Array.from([0xfe, 0x0a]))).toEqual([]);
    expect(decoder.push(Uint8Array.from([0x61, 0x02]))).toEqual([]);
    const frames: readonly ZnpFrame[] = decoder.push(
      Uint8Array.from([0x02, 0x01, 0x02, 0x07, 0x01, 0xd1, 0xfe, 0x34, 0x01, 0x00, 0x74]),
    );
    expect(frames.length).toBe(1);
    expect(frames[0]?.payload).toEqual(
      Uint8Array.from([0x02, 0x01, 0x02, 0x07, 0x01, 0xd1, 0xfe, 0x34, 0x01, 0x00]),
    );
  });

  it('skips garbage preceding a frame', () => {
    const decoder: ZnpFrameDecoder = new ZnpFrameDecoder();
    const frames: readonly ZnpFrame[] = decoder.push(
      Uint8Array.from([0x00, 0xff, 0xfe, 0x00, 0x21, 0x02, 0x23]),
    );
    expect(frames.length).toBe(1);
  });

  it('drops frames with an invalid checksum and resynchronizes', () => {
    const decoder: ZnpFrameDecoder = new ZnpFrameDecoder();
    const frames: readonly ZnpFrame[] = decoder.push(
      Uint8Array.from([0xfe, 0x00, 0x21, 0x02, 0x00, /* invalid */ 0xfe, 0x00, 0x21, 0x02, 0x23]),
    );
    expect(frames.length).toBe(1);
  });

  it('decodes consecutive frames in a single chunk', () => {
    const decoder: ZnpFrameDecoder = new ZnpFrameDecoder();
    const frames: readonly ZnpFrame[] = decoder.push(
      Uint8Array.from([0xfe, 0x00, 0x21, 0x02, 0x23, 0xfe, 0x00, 0x21, 0x02, 0x23]),
    );
    expect(frames.length).toBe(2);
  });
});
