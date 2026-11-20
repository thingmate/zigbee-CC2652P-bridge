import type { ZCLCommandFrameDirection } from '@thingmate/zigbee';

/**
 * The fields of a decoded ZCL command frame, before being bound to a device,
 * endpoint, and cluster by the transport that received it.
 */
export interface ZclCommandFrameFields {
  /** Whether the command is cluster-specific (`true`) or profile-wide (`false`). */
  readonly clusterSpecific: boolean;
  /** Direction of the command. */
  readonly direction: ZCLCommandFrameDirection;
  /** Transaction sequence number of the frame. */
  readonly sequence: number;
  /** Command identifier. */
  readonly command: number;
  /** Command payload. */
  readonly payload: Uint8Array;
}

/**
 * Decodes a ZCL command frame from its wire format (ZCL specification
 * §2.4.8). A manufacturer-specific frame control is tolerated: its 2-byte
 * manufacturer code is skipped, but it cannot be reported (the command frame
 * structure carries no manufacturer code).
 * @param bytes - The encoded ZCL frame bytes.
 * @returns The decoded fields.
 * @throws When the bytes are too short to contain a complete frame header, or
 * the manufacturer code of a manufacturer-specific frame is missing.
 */
export function decodeZclCommandFrame(bytes: Uint8Array): ZclCommandFrameFields {
  if (bytes.length < 3) {
    throw new Error('ZCL command frame too short: missing frame control, sequence, or command');
  }
  const frameControl: number = bytes[0] as number;
  let offset: number = 1;
  if ((frameControl & 0x04) !== 0) {
    if (bytes.length < 5) {
      throw new Error('ZCL command frame too short: missing manufacturer code');
    }
    offset += 2; // manufacturer code is skipped, not reported
  }
  return {
    clusterSpecific: (frameControl & 0x01) !== 0,
    direction: (frameControl & 0x08) === 0 ? 'client-to-server' : 'server-to-client',
    sequence: bytes[offset] as number,
    command: bytes[offset + 1] as number,
    payload: bytes.subarray(offset + 2),
  };
}
