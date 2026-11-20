import { CommandAbilities } from '@thingmate/abilities';
import type { ZCLCommandFrame } from '@thingmate/zigbee';
import { AsyncFunction } from '@xstd/async-function';
import type { ZnpDevice } from '../../../znp/device/znp-device.ts';
import { type ZnpFrame, ZnpFrameType, ZnpSubsystem } from '../../../znp/frame/znp-frame.ts';
import { bigintToLittleEndian, uintToLittleEndian } from '../../../znp/network/znp-network.ts';
import { decodeZclCommandFrame } from '../../decode-zcl-command-frame/decode-zcl-command-frame.ts';
import { encodeZclCommandFrame } from '../../encode-zcl-command-frame/encode-zcl-command-frame.ts';
import { observableFromListenerSource } from '../../observable-from-listener-source/observable-from-listener-source.ts';

/** Default AF data request radius (hops). */
const DATA_REQUEST_RADIUS = 30 as const;

/**
 * Command abilities of a Z-Stack ZNP coordinator, bridging
 * {@link ZCLCommandFrame}s to the ZNP connection:
 * - `send` encodes the frame and sends it through an AF data request,
 *   waiting for the AF data confirmation,
 * - `observe` emits the ZCL frames received by the coordinator, extracted
 *   from AF incoming message indications.
 */
export class ZnpZigbeeCommandFrameBridge extends CommandAbilities<
  readonly [command: ZCLCommandFrame]
> {
  #sequence: number = 0;

  /**
   * Creates command abilities bridged to the provided ZNP device.
   * @param device - The ZNP device connection.
   */
  constructor(device: ZnpDevice) {
    super({
      send: new AsyncFunction<readonly [ZCLCommandFrame], void>(
        async (_signal: AbortSignal, command: ZCLCommandFrame): Promise<void> => {
          await device.ensureStarted();
          const encoded: Uint8Array = encodeZclCommandFrame(command, this.#nextSequence());
          const transId: number = device.nextTransId();
          // The data confirmation waiter is registered first: the
          // confirmation may arrive in the same read batch as the data
          // request's response.
          const confirmPromise: Promise<ZnpFrame> = device.waitFor(
            (frame: ZnpFrame): boolean =>
              frame.type === ZnpFrameType.AREQ &&
              frame.subsystem === ZnpSubsystem.AF &&
              frame.commandId === 0x80 &&
              frame.payload[2] === transId,
            { timeout: 10000 },
          );
          confirmPromise.catch((): void => undefined); // no unhandled rejection when the request fails
          const response: ZnpFrame =
            typeof command.device === 'bigint'
              ? await device.request(
                  ZnpSubsystem.AF,
                  0x02, // AF_DATA_REQUEST_EXT: extended (64-bit) destination
                  Uint8Array.from([
                    0x03, // address mode: 64-bit
                    ...bigintToLittleEndian(command.device, 8),
                    command.endpoint,
                    0xff,
                    0xff, // destination PAN identifier
                    0x01, // source endpoint
                    ...uintToLittleEndian(command.cluster, 2),
                    transId,
                    0x00, // options
                    DATA_REQUEST_RADIUS,
                    ...uintToLittleEndian(encoded.length, 2),
                    ...encoded,
                  ]),
                )
              : await device.request(
                  ZnpSubsystem.AF,
                  0x01, // AF_DATA_REQUEST
                  Uint8Array.from([
                    ...uintToLittleEndian(command.device as number, 2),
                    command.endpoint,
                    0x01, // source endpoint
                    ...uintToLittleEndian(command.cluster, 2),
                    transId,
                    0x00, // options
                    DATA_REQUEST_RADIUS,
                    encoded.length,
                    ...encoded,
                  ]),
                );
          if (response.payload[0] !== 0x00) {
            throw new Error(
              `AF data request failed: status 0x${response.payload[0]?.toString(16)}`,
            );
          }
          const confirm: ZnpFrame = await confirmPromise;
          if (confirm.payload[0] !== 0x00) {
            throw new Error(`AF data confirm failed: status 0x${confirm.payload[0]?.toString(16)}`);
          }
        },
      ),
      observe: observableFromListenerSource<readonly [ZCLCommandFrame]>(
        async (): Promise<(emit: (frame: readonly [ZCLCommandFrame]) => void) => () => void> => {
          await device.ensureStarted();
          return (emit: (frame: readonly [ZCLCommandFrame]) => void): (() => void) => {
            return device.onFrame((frame: ZnpFrame): void => {
              if (
                frame.type !== ZnpFrameType.AREQ ||
                frame.subsystem !== ZnpSubsystem.AF ||
                frame.commandId !== 0x81
              ) {
                return;
              }
              // AF_INCOMING_MSG: [groupId(2), clusterId(2), srcAddr(2), srcEndpoint(1),
              //                  dstEndpoint(1), wasBroadcast(1), linkQuality(1), securityUse(1),
              //                  timestamp(4), transSeqNumber(1), len(1), data(len)]
              try {
                const cluster: number =
                  (frame.payload[2] as number) | ((frame.payload[3] as number) << 8);
                const sourceDevice: number =
                  (frame.payload[4] as number) | ((frame.payload[5] as number) << 8);
                const sourceEndpoint: number = frame.payload[6] as number;
                const dataLength: number = frame.payload[16] as number;
                const fields: ReturnType<typeof decodeZclCommandFrame> = decodeZclCommandFrame(
                  frame.payload.subarray(17, 17 + dataLength),
                );
                emit([
                  {
                    device: sourceDevice,
                    endpoint: sourceEndpoint,
                    cluster,
                    clusterSpecific: fields.clusterSpecific,
                    direction: fields.direction,
                    command: fields.command,
                    payload: fields.payload,
                  },
                ]);
              } catch {
                // Incoming frames are untrusted input: anything failing to
                // parse is filtered out rather than interrupting the
                // observation chain.
              }
            });
          };
        },
      ),
    });
  }

  /** Returns the next ZCL transaction sequence number (0..255). */
  #nextSequence(): number {
    const sequence: number = this.#sequence;
    this.#sequence = (this.#sequence + 1) & 0xff;
    return sequence;
  }
}
