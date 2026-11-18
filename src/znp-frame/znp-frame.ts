/**
 * A frame of the Texas Instruments Monitor-and-Test (MT) protocol spoken by
 * Z-Stack ZNP coordinators (CC2652P among others).
 */
export interface ZnpFrame {
  /** Command type: request, response, or unsolicited indication. */
  readonly type: ZnpFrameType;
  /** Protocol subsystem the command belongs to. */
  readonly subsystem: ZnpSubsystem;
  /** Command identifier within its subsystem. */
  readonly commandId: number;
  /** Command payload. */
  readonly payload: Uint8Array;
}

/**
 * The type of an MT command: the three most significant bits of `cmd0`.
 * - `SREQ` (serial request) expects an `SRSP` response,
 * - `AREQ` (asynchronous request) is either sent without expecting a response,
 *   or received as an unsolicited indication.
 */
export const ZnpFrameType = {
  POLL: 0,
  SREQ: 1,
  AREQ: 2,
  SRSP: 3,
} as const;
export type ZnpFrameType = (typeof ZnpFrameType)[keyof typeof ZnpFrameType];

/**
 * MT protocol subsystems: the five least significant bits of `cmd0`.
 */
export const ZnpSubsystem = {
  SYS: 0x01,
  MAC: 0x02,
  NWK: 0x03,
  AF: 0x04,
  ZDO: 0x05,
  SAPI: 0x06,
  UTIL: 0x07,
  DEBUG: 0x0a,
  APP: 0x0b,
  APP_CNF: 0x0f,
  GREENPOWER: 0x13,
} as const;
export type ZnpSubsystem = (typeof ZnpSubsystem)[keyof typeof ZnpSubsystem];

/** First byte of every MT frame (start of frame). */
export const ZNP_FRAME_SOF = 0xfe as const;

/**
 * Encodes an MT frame.
 * @param frame - The frame to encode.
 * @returns The wire bytes: `SOF`, length, `cmd0`, `cmd1`, payload, checksum.
 */
export function encodeZnpFrame(frame: ZnpFrame): Uint8Array {
  const bytes: number[] = [
    frame.payload.length,
    (frame.type << 5) | frame.subsystem,
    frame.commandId,
  ];
  bytes.push(...frame.payload);
  let checksum: number = 0;
  for (const byte of bytes) {
    checksum ^= byte;
  }
  return Uint8Array.from([ZNP_FRAME_SOF, ...bytes, checksum]);
}

/**
 * Decodes MT frames from an incoming byte stream, skipping any byte until the
 * next start of frame and dropping frames with an invalid checksum.
 */
export class ZnpFrameDecoder {
  #buffer: Uint8Array = new Uint8Array(0);

  /**
   * Feeds bytes into the decoder and returns every complete, checksum-valid
   * frame they complete.
   * @param chunk - The incoming bytes.
   * @returns The decoded frames.
   */
  push(chunk: Uint8Array): readonly ZnpFrame[] {
    this.#buffer = this.#concat(this.#buffer, chunk);
    const frames: ZnpFrame[] = [];
    while (this.#consumeNextFrame(frames)) {
      // consumed
    }
    return frames;
  }

  /**
   * Consumes the next frame from the buffer into `frames`.
   * @returns `true` if a frame was consumed, `false` if more bytes are needed.
   */
  #consumeNextFrame(frames: ZnpFrame[]): boolean {
    const start: number = this.#buffer.indexOf(ZNP_FRAME_SOF);
    if (start === -1) {
      this.#buffer = new Uint8Array(0);
      return false;
    }
    if (start > 0) {
      this.#buffer = this.#buffer.subarray(start);
    }
    const length: number | undefined = this.#buffer[1];
    if (length === undefined) {
      return false;
    }
    const frameLength: number = length + 5;
    if (this.#buffer.length < frameLength) {
      return false;
    }
    const frame: Uint8Array = this.#buffer.subarray(0, frameLength);
    let checksum: number = 0;
    for (let index: number = 1; index < frameLength - 1; index++) {
      checksum ^= frame[index] as number;
    }
    if (checksum === frame[frameLength - 1]) {
      frames.push({
        type: ((frame[2] as number) >> 5) as ZnpFrameType,
        subsystem: ((frame[2] as number) & 0x1f) as ZnpSubsystem,
        commandId: frame[3] as number,
        payload: frame.subarray(4, frameLength - 1),
      });
    }
    this.#buffer = this.#buffer.subarray(frameLength);
    return true;
  }

  #concat(left: Uint8Array, right: Uint8Array): Uint8Array {
    const result: Uint8Array = new Uint8Array(left.length + right.length);
    result.set(left, 0);
    result.set(right, left.length);
    return result;
  }
}
