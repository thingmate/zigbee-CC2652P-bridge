import type { ZCLCommandFrame } from '@thingmate/zigbee';

/**
 * Encodes a {@link ZCLCommandFrame} into its wire format (ZCL specification
 * §2.4.8): frame control, transaction sequence number, command identifier, and
 * payload. The manufacturer-specific bit is never set: the frame structure
 * carries no manufacturer code.
 * @param frame - The ZCL command frame to encode.
 * @param sequence - The transaction sequence number to embed (0..255).
 * @returns The encoded ZCL frame bytes.
 */
export function encodeZclCommandFrame(frame: ZCLCommandFrame, sequence: number): Uint8Array {
  const frameControl: number =
    (frame.clusterSpecific ? 0x01 : 0x00) |
    (frame.direction === 'server-to-client' ? 0x08 : 0x00) |
    0x10; /* disable default response */
  const result: Uint8Array = new Uint8Array(3 + frame.payload.length);
  result[0] = frameControl;
  result[1] = sequence;
  result[2] = frame.command;
  result.set(frame.payload, 3);
  return result;
}
