import { SerialPort } from 'serialport';
import type {
  SerialPortLike,
  SerialPortLikeInfo,
  SerialPortLikeOptions,
  SerialPortLikeSignals,
  SerialPortLikeSignalsState,
} from '../serial-port-like/serial-port-like.ts';

/**
 * A Web Serial API `SerialPort` implementation for Node.js, backed by the
 * `serialport` package. It implements the {@link SerialPortLike} subset, so it
 * can be handed to the same code that runs in a browser with a native
 * `SerialPort`.
 */
export class NodeSerialPort implements SerialPortLike {
  readonly #path: string;
  readonly #info: SerialPortLikeInfo;
  #port: SerialPort | undefined;
  #readableController: ReadableStreamDefaultController<Uint8Array> | undefined;
  #readable: ReadableStream<Uint8Array> | null = null;
  #writable: WritableStream<Uint8Array> | null = null;
  #signals: SerialPortLikeSignalsState = {
    clearToSend: false,
    dataCarrierDetect: false,
    dataTerminalReady: false,
    dataSetReady: false,
    ringIndicator: false,
    requestToSend: false,
  };

  constructor({ path, info }: { path: string; info?: SerialPortLikeInfo }) {
    this.#path = path;
    this.#info = info ?? {};
  }

  /** The operating system path of the port (e.g. `/dev/ttyUSB0` or `COM3`). */
  get path(): string {
    return this.#path;
  }

  async open(options: SerialPortLikeOptions): Promise<void> {
    if (this.#port !== undefined) {
      throw new Error('port is already open');
    }
    const port: SerialPort = new SerialPort({
      path: this.#path,
      baudRate: options.baudRate,
      dataBits: (options.dataBits ?? 8) as 7 | 8,
      stopBits: (options.stopBits ?? 1) as 1 | 1.5 | 2,
      parity: options.parity ?? 'none',
      rtscts: (options.flowControl ?? 'none') === 'hardware',
      autoOpen: false,
    });
    await new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void): void => {
      port.open((error: Error | null | undefined): void => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    this.#port = port;
    port.on('data', (chunk: Buffer): void => {
      this.#readableController?.enqueue(new Uint8Array(chunk));
    });
    port.on('close', (): void => {
      this.#readableController?.close();
    });
    port.on('error', (error: Error): void => {
      this.#readableController?.error(error);
    });
    this.#readable = new ReadableStream<Uint8Array>({
      start: (controller: ReadableStreamDefaultController<Uint8Array>): void => {
        this.#readableController = controller;
      },
    });
    this.#writable = new WritableStream<Uint8Array>({
      write: async (bytes: Uint8Array): Promise<void> => {
        return new Promise<void>(
          (resolve: () => void, reject: (reason?: unknown) => void): void => {
            this.#port?.write(bytes, (error: Error | null | undefined): void => {
              if (error !== null && error !== undefined) {
                reject(error);
              } else {
                resolve();
              }
            });
          },
        );
      },
    });
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this.#readable;
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.#writable;
  }

  async setSignals(signals?: SerialPortLikeSignals): Promise<void> {
    if (signals?.dataTerminalReady !== undefined) {
      this.#signals = { ...this.#signals, dataTerminalReady: signals.dataTerminalReady };
    }
    if (signals?.requestToSend !== undefined) {
      this.#signals = { ...this.#signals, requestToSend: signals.requestToSend };
    }
    const port: SerialPort | undefined = this.#port;
    if (port === undefined) {
      return;
    }
    // `set` applies every flag on each call: send the complete desired state.
    await new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void): void => {
      port.set(
        { dtr: this.#signals.dataTerminalReady, rts: this.#signals.requestToSend },
        (error: Error | null | undefined): void => {
          if (error !== null && error !== undefined) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
    });
  }

  async getSignals(): Promise<SerialPortLikeSignalsState> {
    const port: SerialPort | undefined = this.#port;
    if (port === undefined) {
      return this.#signals;
    }
    const bits: { cts: boolean; dsr: boolean; dcd: boolean } = await new Promise<{
      cts: boolean;
      dsr: boolean;
      dcd: boolean;
    }>(
      (
        resolve: (bits: { cts: boolean; dsr: boolean; dcd: boolean }) => void,
        reject: (reason?: unknown) => void,
      ): void => {
        port.get(
          (error: Error | null, options?: { cts: boolean; dsr: boolean; dcd: boolean }): void => {
            if (error !== null || options === undefined) {
              reject(error ?? new Error('failed to read modem bits'));
            } else {
              resolve(options);
            }
          },
        );
      },
    );
    return {
      ...this.#signals,
      clearToSend: bits.cts,
      dataSetReady: bits.dsr,
      dataCarrierDetect: bits.dcd,
    };
  }

  getInfo(): SerialPortLikeInfo {
    return this.#info;
  }

  async close(): Promise<void> {
    const port: SerialPort | undefined = this.#port;
    if (port === undefined) {
      return;
    }
    this.#port = undefined;
    this.#readable = null;
    this.#writable = null;
    await new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void): void => {
      port.close((error: Error | null | undefined): void => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * Node.js equivalent of the Web Serial API `navigator.serial` hub: enumerates
 * and selects serial ports by USB identity, returning {@link NodeSerialPort}
 * instances usable as `SerialPortLike`.
 */
export class NodeSerial {
  /**
   * Lists the serial ports currently available, as `SerialPortLike` factories.
   * @param options - Optional USB filters, mirroring the Web Serial API
   * `SerialPortRequestOptions` filters.
   */
  async getPorts(options: NodeSerialPortRequestOptions = {}): Promise<NodeSerialPort[]> {
    const ports: Awaited<ReturnType<typeof SerialPort.list>> = await SerialPort.list();
    const matching: Awaited<ReturnType<typeof SerialPort.list>> = ports.filter(
      (port: Awaited<ReturnType<typeof SerialPort.list>>[number]): boolean => {
        const vendorId: number | undefined = parseHex(port.vendorId);
        const productId: number | undefined = parseHex(port.productId);
        return (
          (options.usbVendorId === undefined || vendorId === options.usbVendorId) &&
          (options.usbProductId === undefined || productId === options.usbProductId)
        );
      },
    );
    return matching.map(
      (port: Awaited<ReturnType<typeof SerialPort.list>>[number]): NodeSerialPort =>
        new NodeSerialPort({
          path: port.path,
          info: { usbVendorId: parseHex(port.vendorId), usbProductId: parseHex(port.productId) },
        }),
    );
  }

  /**
   * Selects a single serial port, mirroring the Web Serial API
   * `navigator.serial.requestPort`. Without a user gesture to disambiguate,
   * exactly one port must match the provided filters.
   * @param options - Optional USB filters.
   * @returns The selected port.
   * @throws When no port or more than one port matches.
   */
  async requestPort(options: NodeSerialPortRequestOptions = {}): Promise<NodeSerialPort> {
    const ports: NodeSerialPort[] = await this.getPorts(options);
    if (ports.length === 0) {
      throw new Error('no serial port matches the requested filters');
    }
    if (ports.length > 1) {
      throw new Error(
        `${ports.length} serial ports match the requested filters: a single port is required`,
      );
    }
    return ports[0] as NodeSerialPort;
  }
}

/**
 * USB filters of a Node serial port request, mirroring the Web Serial API
 * `SerialPortFilter`.
 */
export interface NodeSerialPortRequestOptions {
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
}

function parseHex(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed: number = Number.parseInt(value, 16);
  return Number.isNaN(parsed) ? undefined : parsed;
}
