import type { ZnpConnection } from '../znp-connection/znp-connection.ts';
import { ZnpFrameType, ZnpSubsystem } from '../znp-frame/znp-frame.ts';
import { ZnpNvMemory } from '../znp-nv/znp-nv.ts';

/**
 * Network options used to commission a CC2652P coordinator.
 */
export interface Cc2652pNetworkOptions {
  /** IEEE 802.15.4 channel (11..26). */
  readonly channel: number;
  /** 16-bit PAN identifier. */
  readonly panId: number;
  /** 64-bit extended PAN identifier. */
  readonly extPanId: bigint;
  /** 128-bit network key. */
  readonly key: Uint8Array;
}

/**
 * Z-Stack non-volatile item identifiers used for commissioning, from the
 * Z-Stack ZNP interface specification.
 */
export const ZNP_NV_ITEM_ID = {
  STARTUP_OPTION: 0x0003,
  NIB: 0x0021,
  EXTENDED_PAN_ID: 0x002d,
  APS_USE_EXT_PANID: 0x0047,
  PRECFGKEY: 0x0062,
  PRECFGKEYS_ENABLE: 0x0063,
  ZNP_HAS_CONFIGURED: 0x0060,
  PANID: 0x0083,
  CHANLIST: 0x0084,
  LOGICAL_TYPE: 0x0087,
  ZDO_DIRECT_CB: 0x008f,
} as const;

/** Z-Stack ZDO device states. */
export const ZDO_DEVICE_STATE = {
  HOLD: 0x00,
  COORD_STARTING: 0x08,
  ZB_COORD: 0x09,
} as const;

/**
 * Reads the device state of the coordinator.
 * @param connection - The ZNP connection.
 * @returns The current ZDO device state (e.g. {@link ZDO_DEVICE_STATE.ZB_COORD}).
 */
export async function readZnpDeviceState(connection: ZnpConnection): Promise<number> {
  const response: Awaited<ReturnType<ZnpConnection['request']>> = await connection.request(
    ZnpSubsystem.UTIL,
    0x00,
  );
  return response.payload[12] as number;
}

/**
 * Resets the coordinator (soft reset) and waits for its reboot indication.
 * @param connection - The ZNP connection.
 */
export async function resetZnpCoordinator(connection: ZnpConnection): Promise<void> {
  const rebooted: Promise<unknown> = connection.waitFor(
    (frame): boolean =>
      frame.type === ZnpFrameType.AREQ &&
      frame.subsystem === ZnpSubsystem.SYS &&
      frame.commandId === 0x80,
    { timeout: 30000 },
  );
  await connection.write({
    type: ZnpFrameType.AREQ,
    subsystem: ZnpSubsystem.SYS,
    commandId: 0x00,
    payload: Uint8Array.from([0x00]),
  });
  await rebooted;
}

/**
 * Commissions a new Zigbee network on the coordinator with the provided
 * options: clears the previous network state, writes the network parameters to
 * non-volatile memory, and starts the BDB network formation. Resolves once the
 * coordinator reaches the `ZB_COORD` state.
 *
 * This wipes the existing network: every previously paired device must be
 * paired again.
 * @param connection - The ZNP connection.
 * @param options - The network parameters to commission.
 */
export async function commissionZnpNetwork(
  connection: ZnpConnection,
  options: Cc2652pNetworkOptions,
): Promise<void> {
  const nv: ZnpNvMemory = new ZnpNvMemory(connection);

  // Clear the previous network state: deleting the NIB and setting the
  // startup option to `3` makes the stack reset its configuration on reboot.
  await nv.deleteItem(ZNP_NV_ITEM_ID.NIB);
  await nv.writeItem(ZNP_NV_ITEM_ID.STARTUP_OPTION, Uint8Array.from([0x03]));
  await resetZnpCoordinator(connection);
  await nv.writeItem(ZNP_NV_ITEM_ID.STARTUP_OPTION, Uint8Array.from([0x00]));

  // Write the commissioning parameters.
  const extPanIdBytes: Uint8Array = bigintToLittleEndian(options.extPanId, 8);
  await nv.updateItem(ZNP_NV_ITEM_ID.LOGICAL_TYPE, Uint8Array.from([0x00])); // coordinator
  await nv.updateItem(ZNP_NV_ITEM_ID.ZDO_DIRECT_CB, Uint8Array.from([0x01]));
  await nv.updateItem(ZNP_NV_ITEM_ID.CHANLIST, uintToLittleEndian(1 << options.channel, 4));
  await nv.updateItem(ZNP_NV_ITEM_ID.PANID, uintToLittleEndian(options.panId, 2));
  await nv.updateItem(ZNP_NV_ITEM_ID.EXTENDED_PAN_ID, extPanIdBytes);
  await nv.updateItem(ZNP_NV_ITEM_ID.APS_USE_EXT_PANID, extPanIdBytes);
  await nv.updateItem(ZNP_NV_ITEM_ID.PRECFGKEYS_ENABLE, Uint8Array.from([0x00]));
  await nv.updateItem(ZNP_NV_ITEM_ID.PRECFGKEY, options.key);

  // Configure the BDB channel and start the network formation. The state
  // change waiter is registered first: the indication may arrive in the same
  // read batch as the commissioning response.
  await requestStatus(
    connection,
    ZnpSubsystem.APP_CNF,
    0x08,
    Uint8Array.from([0x01, ...uintToLittleEndian(1 << options.channel, 4)]),
  );
  await requestStatus(
    connection,
    ZnpSubsystem.APP_CNF,
    0x08,
    Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x00]),
  );
  const started: Promise<void> = waitZdoState(connection, ZDO_DEVICE_STATE.ZB_COORD, 100000);
  await requestStatus(connection, ZnpSubsystem.APP_CNF, 0x05, Uint8Array.from([0x04]));

  // Wait for the coordinator to reach the `ZB_COORD` state.
  await started;

  // Mark the adapter as configured, so the next boot resumes the network.
  await nv.updateItem(ZNP_NV_ITEM_ID.ZNP_HAS_CONFIGURED, Uint8Array.from([0x55]));
}

/**
 * Resumes the network commissioned by a previous session: asks the ZDO to
 * start the coordinator from its non-volatile configuration. Resolves once the
 * coordinator reaches the `ZB_COORD` state.
 * @param connection - The ZNP connection.
 */
export async function resumeZnpNetwork(connection: ZnpConnection): Promise<void> {
  // The state change waiter is registered first: the indication may arrive in
  // the same read batch as the startup response.
  const started: Promise<void> = waitZdoState(connection, ZDO_DEVICE_STATE.ZB_COORD, 60000);
  await connection.request(ZnpSubsystem.ZDO, 0x40, Uint8Array.from([0x64, 0x00]));
  await started;
}

/**
 * Waits for a ZDO state change indication.
 * @param connection - The ZNP connection.
 * @param state - The device state to wait for.
 * @param timeout - Maximum time to wait, in milliseconds.
 */
async function waitZdoState(
  connection: ZnpConnection,
  state: number,
  timeout: number,
): Promise<void> {
  await connection.waitFor(
    (frame): boolean =>
      frame.type === ZnpFrameType.AREQ &&
      frame.subsystem === ZnpSubsystem.ZDO &&
      frame.commandId === 0xc0 &&
      frame.payload[0] === state,
    { timeout },
  );
}

/**
 * Sends a serial request whose response payload is a single status byte, and
 * checks that it is successful.
 */
async function requestStatus(
  connection: ZnpConnection,
  subsystem: ZnpSubsystem,
  commandId: number,
  payload: Uint8Array,
): Promise<void> {
  const response: Awaited<ReturnType<ZnpConnection['request']>> = await connection.request(
    subsystem,
    commandId,
    payload,
    {
      timeout: 40000,
    },
  );
  if (response.payload[0] !== 0x00) {
    throw new Error(
      `ZNP request failed: subsystem 0x${subsystem.toString(16)} command 0x${commandId.toString(16)} status 0x${response.payload[0]?.toString(16)}`,
    );
  }
}

/**
 * Writes an unsigned integer as little-endian bytes.
 * @param value - The value to write.
 * @param byteCount - The number of bytes to write.
 * @returns The little-endian bytes.
 */
export function uintToLittleEndian(value: number, byteCount: number): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(byteCount);
  for (let index: number = 0; index < byteCount; index++) {
    bytes[index] = (value >> (index * 8)) & 0xff;
  }
  return bytes;
}

/**
 * Writes an unsigned bigint as little-endian bytes.
 * @param value - The value to write.
 * @param byteCount - The number of bytes to write.
 * @returns The little-endian bytes.
 */
export function bigintToLittleEndian(value: bigint, byteCount: number): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(byteCount);
  let remaining: bigint = value;
  for (let index: number = 0; index < byteCount; index++) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) {
    throw new Error(`value ${value} does not fit in ${byteCount} bytes`);
  }
  return bytes;
}

/**
 * Reads little-endian bytes as an unsigned bigint.
 * @param bytes - The little-endian bytes.
 * @returns The value.
 */
export function littleEndianToBigint(bytes: Uint8Array): bigint {
  let value: bigint = 0n;
  for (let index: number = bytes.length - 1; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[index] as number);
  }
  return value;
}
