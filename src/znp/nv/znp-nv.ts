import type { ZnpConnection } from '../connection/znp-connection.ts';
import { ZnpSubsystem } from '../frame/znp-frame.ts';

/**
 * SYS subsystem command identifiers used by the NV memory helpers.
 * @see Texas Instruments Z-Stack ZNP interface specification.
 */
const SYS_COMMAND = {
  OSAL_NV_ITEM_INIT: 0x07,
  OSAL_NV_WRITE: 0x09,
  OSAL_NV_DELETE: 0x12,
  OSAL_NV_LENGTH: 0x13,
  OSAL_NV_READ_EXT: 0x1c,
} as const;

/** MT status for a successful command. */
const STATUS_SUCCESS = 0x00 as const;
/** MT status returned by `osalNvItemInit` when the item already existed. */
const STATUS_NV_ITEM_INITIALIZED = 0x09 as const;

/**
 * Z-Stack non-volatile memory access over a {@link ZnpConnection}.
 *
 * Items are read and written in chunks of at most 250 bytes, mirroring the
 * chunked access pattern required by the ZNP interface.
 */
export class ZnpNvMemory {
  readonly #connection: ZnpConnection;

  constructor(connection: ZnpConnection) {
    this.#connection = connection;
  }

  /**
   * Reads a whole NV item.
   * @param id - The NV item identifier.
   * @returns The item value, or `null` when the item does not exist.
   */
  async readItem(id: number): Promise<Uint8Array | null> {
    const length: number = await this.#readLength(id);
    if (length === 0) {
      return null;
    }
    const value: Uint8Array = new Uint8Array(length);
    let offset: number = 0;
    while (offset < length) {
      const response: Uint8Array = await this.#request(
        SYS_COMMAND.OSAL_NV_READ_EXT,
        Uint8Array.from([id & 0xff, id >> 8, offset & 0xff, offset >> 8]),
      );
      if (response[0] !== STATUS_SUCCESS) {
        throw new Error(
          `failed to read NV item 0x${id.toString(16)} at offset ${offset}: status 0x${response[0]?.toString(16)}`,
        );
      }
      const chunkLength: number = response[1] as number;
      value.set(response.subarray(2, 2 + chunkLength), offset);
      if (chunkLength === 0) {
        throw new Error(
          `failed to read NV item 0x${id.toString(16)}: empty chunk at offset ${offset}`,
        );
      }
      offset += chunkLength;
    }
    return value;
  }

  /**
   * Writes a whole NV item, initializing it first: on Z-Stack 3.x the item's
   * declared length may differ from its actual non-volatile entry, and the
   * write fails until the item is initialized in the current session.
   * @param id - The NV item identifier.
   * @param value - The value to write.
   */
  async writeItem(id: number, value: Uint8Array): Promise<void> {
    const initLength: number = Math.min(value.length, 240);
    const initPayload: Uint8Array = new Uint8Array(5 + initLength);
    initPayload[0] = id & 0xff;
    initPayload[1] = id >> 8;
    initPayload[2] = value.length & 0xff;
    initPayload[3] = value.length >> 8;
    initPayload[4] = initLength;
    initPayload.set(value.subarray(0, initLength), 5);
    const initResponse: Uint8Array = await this.#request(
      SYS_COMMAND.OSAL_NV_ITEM_INIT,
      initPayload,
    );
    if (initResponse[0] !== STATUS_SUCCESS && initResponse[0] !== STATUS_NV_ITEM_INITIALIZED) {
      throw new Error(
        `failed to initialize NV item 0x${id.toString(16)}: status 0x${initResponse[0]?.toString(16)}`,
      );
    }
    let offset: number = 0;
    while (offset < value.length) {
      // Legacy `osalNvWrite` payload: [id(2), offset(1), length(1), value].
      // The extended write (`osalNvWriteExt`) is not used: the current Z-Stack
      // 3.x firmwares reject its non-zero-value writes with `INVALID_PARAM`.
      const chunkLength: number = Math.min(value.length - offset, 240);
      const writePayload: Uint8Array = new Uint8Array(4 + chunkLength);
      writePayload[0] = id & 0xff;
      writePayload[1] = id >> 8;
      writePayload[2] = offset;
      writePayload[3] = chunkLength;
      writePayload.set(value.subarray(offset, offset + chunkLength), 4);
      const writeResponse: Uint8Array = await this.#request(
        SYS_COMMAND.OSAL_NV_WRITE,
        writePayload,
      );
      if (writeResponse[0] !== STATUS_SUCCESS) {
        throw new Error(
          `failed to write NV item 0x${id.toString(16)} at offset ${offset}: status 0x${writeResponse[0]?.toString(16)}`,
        );
      }
      offset += chunkLength;
    }
  }

  /**
   * Writes a whole NV item only when its current value differs.
   * @param id - The NV item identifier.
   * @param value - The desired value.
   */
  async updateItem(id: number, value: Uint8Array): Promise<void> {
    const current: Uint8Array | null = await this.readItem(id);
    if (current === null || !equalBytes(current, value)) {
      await this.writeItem(id, value);
    }
  }

  /**
   * Deletes a whole NV item.
   * @param id - The NV item identifier.
   */
  async deleteItem(id: number): Promise<void> {
    const length: number = await this.#readLength(id);
    if (length === 0) {
      return;
    }
    const response: Uint8Array = await this.#request(
      SYS_COMMAND.OSAL_NV_DELETE,
      Uint8Array.from([id & 0xff, id >> 8, length & 0xff, length >> 8]),
    );
    if (response[0] !== STATUS_SUCCESS && response[0] !== STATUS_NV_ITEM_INITIALIZED) {
      throw new Error(
        `failed to delete NV item 0x${id.toString(16)}: status 0x${response[0]?.toString(16)}`,
      );
    }
  }

  async #readLength(id: number): Promise<number> {
    // The `osalNvLength` response carries no status: it is the item length as
    // a little-endian uint16, `0` when the item does not exist.
    const response: Uint8Array = await this.#request(
      SYS_COMMAND.OSAL_NV_LENGTH,
      Uint8Array.from([id & 0xff, id >> 8]),
    );
    return (response[0] as number) | ((response[1] as number) << 8);
  }

  async #request(commandId: number, payload: Uint8Array): Promise<Uint8Array> {
    const response: Awaited<ReturnType<ZnpConnection['request']>> = await this.#connection.request(
      ZnpSubsystem.SYS,
      commandId,
      payload,
    );
    return response.payload;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index: number = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
