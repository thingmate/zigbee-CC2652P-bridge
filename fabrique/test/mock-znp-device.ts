import {
  encodeZnpFrame,
  ZnpFrameDecoder,
  ZnpFrameType,
  ZnpSubsystem,
  type ZnpFrame,
} from '../../src/znp-frame/znp-frame.ts';
import { MockSerialPort } from './tools.ts';

/**
 * In-memory ZNP device mock: implements the SYS non-volatile-memory commands
 * over a {@link MockSerialPort}, and answers every other serial request with a
 * generic success response. Unsolicited indications are pushed with `pushAreq`.
 */
export class MockZnpDevice {
  readonly port: MockSerialPort = new MockSerialPort();
  readonly #nv: Map<number, Uint8Array> = new Map();
  readonly #decoder: ZnpFrameDecoder = new ZnpFrameDecoder();

  /** Status returned by the generic success response. */
  genericStatus: number = 0x00;

  /**
   * When `true` (the default), the device simulates a Z-Stack coordinator:
   * a SYS reset request produces a `resetInd`, and a network commissioning
   * request produces a `stateChangeInd` to the `ZB_COORD` state.
   */
  simulateCoordinator: boolean = true;

  /** Device state reported by `getDeviceInfo` and `stateChangeInd`. */
  deviceState: number = 0x00;

  /** Network parameters reported by `extNwkInfo` and `getNvInfo`. */
  network: {
    readonly channel: number;
    readonly panId: number;
    readonly extPanId: Uint8Array;
    readonly key: Uint8Array;
  } = {
    channel: 11,
    panId: 0x1234,
    extPanId: Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
    key: Uint8Array.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
      0x0f,
    ]),
  };

  constructor() {
    this.port.respond = (bytes: Uint8Array): Uint8Array[] | undefined => {
      const responses: Uint8Array[] = this.#decoder
        .push(bytes)
        .map((frame: ZnpFrame): Uint8Array => this.#handleRequest(frame));
      return responses;
    };
  }

  /** Directly writes a value into the simulated NV store. */
  setNvItem(id: number, value: Uint8Array): void {
    this.#nv.set(id, Uint8Array.from(value));
  }

  getNvItem(id: number): Uint8Array | undefined {
    return this.#nv.get(id);
  }

  /** Pushes an unsolicited indication to the host. */
  pushAreq(frame: ZnpFrame): void {
    this.port.push(encodeZnpFrame(frame));
  }

  #handleRequest(frame: ZnpFrame): Uint8Array {
    if (frame.type === ZnpFrameType.SREQ && frame.subsystem === ZnpSubsystem.SYS) {
      return encodeZnpFrame({
        type: ZnpFrameType.SRSP,
        subsystem: frame.subsystem,
        commandId: frame.commandId,
        payload: this.#handleSysRequest(frame.commandId, frame.payload),
      });
    }
    if (
      frame.type === ZnpFrameType.AREQ &&
      frame.subsystem === ZnpSubsystem.SYS &&
      frame.commandId === 0x00
    ) {
      // System reset request: simulate the reboot indication.
      if (this.simulateCoordinator) {
        queueMicrotask((): void => {
          this.pushAreq({
            type: ZnpFrameType.AREQ,
            subsystem: ZnpSubsystem.SYS,
            commandId: 0x80,
            payload: Uint8Array.from([0x00, 0x02, 0x01, 0x02, 0x07, 0x01]),
          });
        });
      }
      return Uint8Array.from([]);
    }
    if (
      frame.type === ZnpFrameType.SREQ &&
      frame.subsystem === ZnpSubsystem.APP_CNF &&
      frame.commandId === 0x05
    ) {
      // Network commissioning: simulate the coordinator starting.
      if (this.simulateCoordinator && (frame.payload[0] as number) === 0x04) {
        queueMicrotask((): void => {
          this.pushAreq({
            type: ZnpFrameType.AREQ,
            subsystem: ZnpSubsystem.ZDO,
            commandId: 0xc0,
            payload: Uint8Array.from([9]),
          });
        });
      }
      return encodeZnpFrame({
        type: ZnpFrameType.SRSP,
        subsystem: frame.subsystem,
        commandId: frame.commandId,
        payload: Uint8Array.from([0x00]),
      });
    }
    if (
      frame.type === ZnpFrameType.SREQ &&
      frame.subsystem === ZnpSubsystem.ZDO &&
      frame.commandId === 0x40
    ) {
      // ZDO startup from app: simulate the coordinator starting.
      if (this.simulateCoordinator) {
        queueMicrotask((): void => {
          this.pushAreq({
            type: ZnpFrameType.AREQ,
            subsystem: ZnpSubsystem.ZDO,
            commandId: 0xc0,
            payload: Uint8Array.from([9]),
          });
        });
      }
      return encodeZnpFrame({
        type: ZnpFrameType.SRSP,
        subsystem: frame.subsystem,
        commandId: frame.commandId,
        payload: Uint8Array.from([0x00]),
      });
    }
    if (
      frame.type === ZnpFrameType.SREQ &&
      frame.subsystem === ZnpSubsystem.UTIL &&
      frame.commandId === 0x00
    ) {
      // getDeviceInfo
      return encodeZnpFrame({
        type: ZnpFrameType.SRSP,
        subsystem: frame.subsystem,
        commandId: frame.commandId,
        payload: Uint8Array.from([
          0x00, // status
          0x57,
          0x56,
          0x29,
          0x39,
          0x00,
          0x4b,
          0x12,
          0x00, // IEEE address (little-endian)
          0xfe,
          0xff, // short address
          0x07, // device type
          this.deviceState, // device state
          0x00, // associated devices count
        ]),
      });
    }
    if (
      frame.type === ZnpFrameType.SREQ &&
      frame.subsystem === ZnpSubsystem.ZDO &&
      frame.commandId === 0x50
    ) {
      // extNwkInfo
      return encodeZnpFrame({
        type: ZnpFrameType.SRSP,
        subsystem: frame.subsystem,
        commandId: frame.commandId,
        payload: Uint8Array.from([
          0x00,
          0x00, // short address
          this.deviceState, // device state
          ...u16LittleEndian(this.network.panId),
          0x00,
          0x00, // parent address
          ...this.network.extPanId, // extended PAN identifier (little-endian)
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00, // parent extended PAN identifier
          this.network.channel, // channel
        ]),
      });
    }
    if (
      frame.type === ZnpFrameType.SREQ &&
      frame.subsystem === ZnpSubsystem.UTIL &&
      frame.commandId === 0x01
    ) {
      // getNvInfo
      return encodeZnpFrame({
        type: ZnpFrameType.SRSP,
        subsystem: frame.subsystem,
        commandId: frame.commandId,
        payload: Uint8Array.from([
          0x00, // status
          0x57,
          0x56,
          0x29,
          0x39,
          0x00,
          0x4b,
          0x12,
          0x00, // IEEE address (little-endian)
          ...u32LittleEndian(0x07fff800), // scan channels
          ...u16LittleEndian(this.network.panId), // PAN identifier
          0x05, // security level
          ...this.network.key, // pre-configured network key
        ]),
      });
    }
    if (frame.type === ZnpFrameType.SREQ) {
      return encodeZnpFrame({
        type: ZnpFrameType.SRSP,
        subsystem: frame.subsystem,
        commandId: frame.commandId,
        payload: Uint8Array.from([this.genericStatus]),
      });
    }
    return encodeZnpFrame({
      type: frame.type,
      subsystem: frame.subsystem,
      commandId: frame.commandId,
      payload: Uint8Array.from([this.genericStatus]),
    });
  }

  #handleSysRequest(commandId: number, payload: Uint8Array): Uint8Array {
    const id: number = payload[0]! | (payload[1]! << 8);
    switch (commandId) {
      case 0x13: {
        // osalNvLength
        const item: Uint8Array | undefined = this.#nv.get(id);
        return Uint8Array.from([item?.length ?? 0, 0x00]);
      }
      case 0x1c: {
        // osalNvReadExt
        const item: Uint8Array | undefined = this.#nv.get(id);
        if (item === undefined) {
          return Uint8Array.from([0x02, 0x00]); // INVALID_PARAM
        }
        const offset: number = payload[2]! | (payload[3]! << 8);
        const chunk: Uint8Array = item.subarray(offset, offset + 250);
        return Uint8Array.from([0x00, chunk.length, ...chunk]);
      }
      case 0x1d:
      case 0x09: {
        // osalNvWriteExt (extended) / osalNvWrite (legacy)
        const item: Uint8Array | undefined = this.#nv.get(id);
        if (item === undefined) {
          return Uint8Array.from([0x02]);
        }
        const offset: number =
          commandId === 0x09 ? (payload[2] as number) : payload[2]! | (payload[3]! << 8);
        const lengthIndex: number = commandId === 0x09 ? 3 : 4;
        const valueIndex: number = commandId === 0x09 ? 4 : 5;
        const length: number = payload[lengthIndex] as number;
        item.set(payload.subarray(valueIndex, valueIndex + length), offset);
        return Uint8Array.from([0x00]);
      }
      case 0x07: {
        // osalNvItemInit
        const itemLength: number = payload[2]! | (payload[3]! << 8);
        const initLength: number = payload[4] as number;
        const existing: Uint8Array | undefined = this.#nv.get(id);
        if (existing !== undefined) {
          return Uint8Array.from([0x09]); // NV_ITEM_INITIALIZED
        }
        this.#nv.set(id, Uint8Array.from(payload.subarray(5, 5 + initLength)));
        const padded: Uint8Array = new Uint8Array(itemLength);
        padded.set(this.#nv.get(id) as Uint8Array, 0);
        this.#nv.set(id, padded);
        return Uint8Array.from([0x00]);
      }
      case 0x12: {
        // osalNvDelete
        this.#nv.delete(id);
        return Uint8Array.from([0x00]);
      }
      default: {
        return Uint8Array.from([this.genericStatus]);
      }
    }
  }
}

function u16LittleEndian(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32LittleEndian(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}
