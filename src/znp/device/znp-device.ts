import type { SerialPort } from '@thingmate/node-web-serial';
import { ZnpConnection } from '../connection/znp-connection.ts';
import { ZnpSubsystem, type ZnpFrame } from '../frame/znp-frame.ts';
import {
  commissionZnpNetwork,
  littleEndianToBigint,
  readZnpDeviceState,
  resumeZnpNetwork,
  uintToLittleEndian,
  ZDO_DEVICE_STATE,
  ZNP_NV_ITEM_ID,
  type ZnpNetworkOptions,
  type ZnpNetworkState,
} from '../network/znp-network.ts';
import { ZnpNvMemory } from '../nv/znp-nv.ts';

/** Z-Stack AF profile identifier for Home Automation. */
const HOME_AUTOMATION_PROFILE_ID = 0x0104 as const;

/** Default radio transmission power, in dBm. */
const DEFAULT_TX_RADIO = 5 as const;

/**
 * The serial connection to a Z-Stack ZNP coordinator, with its lifecycle:
 * opening the port, skipping a possible bootloader, starting the network,
 * registering the Zigbee endpoint, and caching the coordinator's state.
 */
export class ZnpDevice {
  readonly #port: SerialPort;
  readonly #frameListeners: ((frame: ZnpFrame) => void)[] = [];
  readonly #networkStateListeners: ((state: ZnpNetworkState) => void)[] = [];
  #connection: ZnpConnection | undefined;
  #nv: ZnpNvMemory | undefined;
  #startedPromise: Promise<void> | undefined;
  #transId: number = 0;
  #txRadio: number = DEFAULT_TX_RADIO;
  #pendingNetworkOptions: ZnpNetworkOptions | undefined;
  #txRadioPending: boolean = false;

  constructor(port: SerialPort) {
    this.#port = port;
  }

  /**
   * Opens the connection, starts (or resumes) the network, and registers the
   * Zigbee endpoint. Concurrent callers share the same startup; a failure
   * clears the shared startup so the next caller retries.
   */
  ensureStarted(): Promise<void> {
    this.#startedPromise ??= this.#start().catch(async (error: unknown): Promise<never> => {
      // Close whatever was opened and wait for it, so the next caller retries
      // cleanly: a concurrent re-open would race the close and hit an open port.
      const connection: ZnpConnection | undefined = this.#connection;
      this.#connection = undefined;
      this.#nv = undefined;
      this.#startedPromise = undefined;
      if (connection !== undefined) {
        await connection.close().catch((): void => undefined);
      }
      throw error;
    });
    return this.#startedPromise;
  }

  /**
   * Sends a serial request to the coordinator, starting it if needed.
   * @see {@link ZnpConnection.request}.
   */
  async request(
    subsystem: ZnpSubsystem,
    commandId: number,
    payload: Uint8Array = new Uint8Array(0),
    options?: { readonly timeout?: number },
  ): Promise<ZnpFrame> {
    await this.ensureStarted();
    return this.#connection!.request(subsystem, commandId, payload, options);
  }

  /**
   * Waits for a frame matching the provided predicate.
   * @see {@link ZnpConnection.waitFor}.
   */
  waitFor(
    predicate: (frame: ZnpFrame) => boolean,
    options?: { readonly timeout?: number },
  ): Promise<ZnpFrame> {
    return this.#connection!.waitFor(predicate, options);
  }

  /**
   * Registers a listener receiving every decoded frame.
   * @param listener - The listener to register; it must not throw.
   * @returns An unsubscription function.
   */
  onFrame(listener: (frame: ZnpFrame) => void): () => void {
    this.#frameListeners.push(listener);
    return (): void => {
      const index: number = this.#frameListeners.indexOf(listener);
      if (index !== -1) {
        this.#frameListeners.splice(index, 1);
      }
    };
  }

  /**
   * Registers a listener receiving the coordinator's network state on every
   * update (after a startup or a re-commissioning).
   * @param listener - The listener to register; it must not throw.
   * @returns An unsubscription function.
   */
  onNetworkState(listener: (state: ZnpNetworkState) => void): () => void {
    this.#networkStateListeners.push(listener);
    return (): void => {
      const index: number = this.#networkStateListeners.indexOf(listener);
      if (index !== -1) {
        this.#networkStateListeners.splice(index, 1);
      }
    };
  }

  /**
   * Reads the coordinator's current network state.
   * @returns The state reported by the coordinator.
   */
  async readNetworkState(): Promise<ZnpNetworkState> {
    await this.ensureStarted();
    return this.#readNetworkState(this.#connection!);
  }

  /**
   * Ensures the coordinator runs the provided network parameters:
   * - when the connection was never opened, the parameters are stored for the
   *   first startup,
   * - when the coordinator is running a network with different parameters, it
   *   is re-commissioned with the new ones (every paired device must be paired
   *   again),
   * - nothing happens when the parameters already match.
   * @param options - The network parameters to apply.
   */
  async ensureNetworkOptions(options: ZnpNetworkOptions): Promise<void> {
    if (this.#connection === undefined) {
      // The connection was never opened: the parameters are stored for the
      // first startup.
      this.#pendingNetworkOptions = options;
      return;
    }
    const current: ZnpNetworkState = await this.#readNetworkState(this.#connection!);
    if (
      current.channel === options.channel &&
      current.panId === options.panId &&
      current.extPanId === options.extPanId &&
      equalBytes(current.key, options.key)
    ) {
      return;
    }
    await commissionZnpNetwork(this.#connection!, options);
    await this.#emitCurrentNetworkState();
  }

  /** Returns the next AF data request transaction identifier (0..255). */
  nextTransId(): number {
    const transId: number = this.#transId;
    this.#transId = (this.#transId + 1) & 0xff;
    return transId;
  }

  /**
   * Closes the connection and the underlying port. The next use reconnects
   * and restarts the coordinator.
   */
  async close(): Promise<void> {
    const connection: ZnpConnection | undefined = this.#connection;
    this.#connection = undefined;
    this.#nv = undefined;
    this.#startedPromise = undefined;
    if (connection !== undefined) {
      await connection.close();
    }
  }

  async #start(): Promise<void> {
    const connection: ZnpConnection = await ZnpConnection.open(this.#port);
    this.#connection = connection;
    this.#nv = new ZnpNvMemory(connection);
    connection.onFrame((frame: ZnpFrame): void => {
      for (const listener of [...this.#frameListeners]) {
        listener(frame);
      }
    });

    await this.#skipBootloader(connection);
    const deviceState: number = await readZnpDeviceState(connection);
    if (deviceState !== ZDO_DEVICE_STATE.ZB_COORD) {
      const hasConfigured: Uint8Array | null = await this.#nv!.readItem(
        ZNP_NV_ITEM_ID.ZNP_HAS_CONFIGURED,
      );
      if (hasConfigured !== null && hasConfigured[0] === 0x55) {
        await resumeZnpNetwork(connection);
      } else {
        await commissionZnpNetwork(
          connection,
          this.#pendingNetworkOptions ?? generateRandomNetworkOptions(),
        );
        await this.#nv!.updateItem(ZNP_NV_ITEM_ID.ZNP_HAS_CONFIGURED, Uint8Array.from([0x55]));
      }
    }
    // Register the Zigbee endpoint used to send and receive ZCL frames.
    await connection.request(
      ZnpSubsystem.AF,
      0x00,
      // [endpoint, profileId(2), deviceId(2), deviceVersion, latencyReq, inClusters(0), outClusters(0)]
      Uint8Array.from([
        0x01,
        ...uintToLittleEndian(HOME_AUTOMATION_PROFILE_ID, 2),
        0x05,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
      ]),
    );
    if (this.#txRadioPending) {
      this.#txRadioPending = false;
      await this.setTxRadio(this.#txRadio);
    }
    await this.#emitCurrentNetworkState();
  }

  /**
   * Pings the coordinator, working around coordinators left in their serial
   * bootloader: resets the DTR/RTS lines, mirroring the Z-Stack tooling
   * behaviour.
   */
  async #skipBootloader(connection: ZnpConnection): Promise<void> {
    try {
      await connection.request(ZnpSubsystem.SYS, 0x01, new Uint8Array(0), { timeout: 250 });
      return;
    } catch {
      // Fall through to the DTR/RTS workaround.
    }
    await this.#port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await wait(150);
    await this.#port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await wait(150);
    await this.#port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await wait(150);
    await connection.request(ZnpSubsystem.SYS, 0x01, new Uint8Array(0), { timeout: 1000 });
  }

  /**
   * Sets the radio transmission power through the stack tuning command. When
   * the connection was never opened, the power is stored for the first
   * startup.
   * @param txRadio - The transmission power, in dBm.
   */
  async setTxRadio(txRadio: number): Promise<void> {
    this.#txRadio = txRadio;
    const connection: ZnpConnection | undefined = this.#connection;
    if (connection === undefined) {
      this.#txRadioPending = true;
      return;
    }
    // SYS_STACK_TUNE: [operation = 0 (set TX power), value (signed dBm)]
    await connection.request(ZnpSubsystem.SYS, 0x0f, Uint8Array.from([0x00, txRadio & 0xff]));
    this.#txRadioPending = false;
  }

  async #emitCurrentNetworkState(): Promise<void> {
    const state: ZnpNetworkState = await this.#readNetworkState(this.#connection!);
    for (const listener of [...this.#networkStateListeners]) {
      listener(state);
    }
  }

  /**
   * Reads the network state directly from an open connection, without going
   * through {@link request}: it is also used during the startup itself, where
   * awaiting {@link ensureStarted} would deadlock.
   */
  async #readNetworkState(connection: ZnpConnection): Promise<ZnpNetworkState> {
    const extNwkInfo: ZnpFrame = await connection.request(ZnpSubsystem.ZDO, 0x50);
    // [shortAddr(2), devState(1), panId(2), parentAddr(2), extPanId(8), parentExtAddr(8), channel(1)]
    const panId: number =
      (extNwkInfo.payload[3] as number) | ((extNwkInfo.payload[4] as number) << 8);
    const extPanId: bigint = littleEndianToBigint(extNwkInfo.payload.subarray(7, 15));
    const channel: number = extNwkInfo.payload[23] as number;
    const getNvInfo: ZnpFrame = await connection.request(ZnpSubsystem.UTIL, 0x01);
    // [status(1), ieeeAddr(8), scanChannels(4), panId(2), securityLevel(1), key(16)]
    const key: Uint8Array = getNvInfo.payload.subarray(16, 32);
    return { channel, panId, extPanId, key: Uint8Array.from(key), txRadio: this.#txRadio };
  }
}

/**
 * Generates random network options: channel 11, a random PAN identifier,
 * extended PAN identifier, and network key.
 */
function generateRandomNetworkOptions(): ZnpNetworkOptions {
  const key: Uint8Array<ArrayBuffer> = new Uint8Array(16);
  const extPanIdBytes: Uint8Array<ArrayBuffer> = new Uint8Array(8);
  globalThis.crypto.getRandomValues(key);
  globalThis.crypto.getRandomValues(extPanIdBytes);
  const extPanId: bigint = littleEndianToBigint(extPanIdBytes) || 0x0102030405060708n;
  let panId: number = globalThis.crypto.getRandomValues(new Uint16Array(1))[0] as number;
  if (panId === 0x0000 || panId === 0xffff) {
    panId = 0x1234;
  }
  return { channel: 11, panId, extPanId, key };
}

function wait(duration: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, duration);
  });
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
