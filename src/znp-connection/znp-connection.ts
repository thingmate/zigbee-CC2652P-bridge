import type { SerialPort } from '@thingmate/node-web-serial';
import {
  encodeZnpFrame,
  ZnpFrameDecoder,
  ZnpFrameType,
  type ZnpFrame,
  type ZnpSubsystem,
} from '../znp-frame/znp-frame.ts';

/**
 * A live connection to a Z-Stack ZNP coordinator over a Web Serial API port:
 * decodes incoming MT frames, serializes request/response exchanges, and
 * dispatches every received frame to waiters and listeners.
 */
export class ZnpConnection {
  readonly #port: SerialPort;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #waiters: ZnpFrameWaiter[] = [];
  readonly #listeners: ((frame: ZnpFrame) => void)[] = [];
  readonly #decoder: ZnpFrameDecoder = new ZnpFrameDecoder();
  #queueTail: Promise<void> = Promise.resolve();
  #closed: boolean = false;
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  #reading: Promise<void> | undefined;

  /**
   * Opens a ZNP connection over the provided port.
   * @param port - The Web Serial API port connected to the coordinator.
   * @param options - Connection options.
   * @param options.baudRate - Baud rate of the ZNP UART. Defaults to `115200`.
   * @returns The opened connection.
   */
  static async open(
    port: SerialPort,
    { baudRate = 115200 }: ZnpConnectionOptions = {},
  ): Promise<ZnpConnection> {
    await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    const connection: ZnpConnection = new ZnpConnection(port);
    connection.#reading = connection.#startReading();
    return connection;
  }

  constructor(port: SerialPort) {
    this.#port = port;
    const writable: WritableStream<Uint8Array> | null = port.writable;
    if (writable === null) {
      throw new Error('port is not open: no writable stream');
    }
    this.#writer = writable.getWriter();
  }

  /**
   * Writes a frame to the coordinator without waiting for anything (used for
   * AREQ-typed commands like a system reset, or protocol-level writes).
   * @param frame - The frame to write.
   */
  async write(frame: ZnpFrame): Promise<void> {
    if (this.#closed) {
      throw new Error('connection is closed');
    }
    await this.#writer.write(encodeZnpFrame(frame));
  }

  /**
   * Sends a serial request (SREQ) and waits for its serial response (SRSP).
   * Requests are serialized: only one exchange is in flight at a time.
   * @param subsystem - Request subsystem.
   * @param commandId - Request command identifier.
   * @param payload - Request payload.
   * @param options - Request options.
   * @param options.timeout - Response timeout in milliseconds. Defaults to `6000`.
   * @returns The matching serial response.
   * @throws When the response does not arrive within the timeout, or the
   * connection is closed.
   */
  async request(
    subsystem: ZnpSubsystem,
    commandId: number,
    payload: Uint8Array = new Uint8Array(0),
    { timeout = 6000 }: ZnpRequestOptions = {},
  ): Promise<ZnpFrame> {
    if (this.#closed) {
      throw new Error('connection is closed');
    }
    const exchange: Promise<ZnpFrame> = this.#queueTail.then((): Promise<ZnpFrame> =>
      this.#exchange(subsystem, commandId, payload, timeout),
    );
    this.#queueTail = exchange.then(
      (): void => undefined,
      (): void => undefined,
    );
    return exchange;
  }

  /**
   * Registers a listener receiving every decoded frame (responses and
   * indications). Listeners must not throw.
   * @param listener - The listener to register.
   * @returns An unsubscription function.
   */
  onFrame(listener: (frame: ZnpFrame) => void): () => void {
    this.#listeners.push(listener);
    return (): void => {
      const index: number = this.#listeners.indexOf(listener);
      if (index !== -1) {
        this.#listeners.splice(index, 1);
      }
    };
  }

  /**
   * Waits for a frame matching the provided predicate.
   * @param predicate - The predicate a frame must satisfy.
   * @param options - Wait options.
   * @param options.timeout - Time to wait in milliseconds. Defaults to `6000`.
   * @returns The first matching frame.
   * @throws When no matching frame arrives within the timeout, or the
   * connection is closed.
   */
  waitFor(
    predicate: (frame: ZnpFrame) => boolean,
    { timeout = 6000 }: ZnpRequestOptions = {},
  ): Promise<ZnpFrame> {
    if (this.#closed) {
      return Promise.reject(new Error('connection is closed'));
    }
    return new Promise<ZnpFrame>(
      (resolve: (frame: ZnpFrame) => void, reject: (reason?: unknown) => void): void => {
        const waiter: ZnpFrameWaiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout((): void => {
            const index: number = this.#waiters.indexOf(waiter);
            if (index !== -1) {
              this.#waiters.splice(index, 1);
            }
            reject(new Error('ZNP frame wait timed out'));
          }, timeout),
        };
        this.#waiters.push(waiter);
      },
    );
  }

  /**
   * Closes the connection and the underlying port. The writer lock is
   * released after draining, and the read loop is cancelled and awaited, so
   * the port's streams are unlocked when the port closes — a locked port
   * refuses to close and would stay open for its whole life.
   */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('connection is closed'));
    }
    await this.#writer.close().catch((): void => undefined);
    this.#writer.releaseLock();
    this.#reader?.cancel().catch((): void => undefined);
    await this.#reading?.catch((): void => undefined);
    await this.#port.close();
  }

  async #exchange(
    subsystem: ZnpSubsystem,
    commandId: number,
    payload: Uint8Array,
    timeout: number,
  ): Promise<ZnpFrame> {
    const response: Promise<ZnpFrame> = this.waitFor(
      (frame: ZnpFrame): boolean =>
        frame.type === ZnpFrameType.SRSP &&
        frame.subsystem === subsystem &&
        frame.commandId === commandId,
      { timeout },
    );
    await this.write({ type: ZnpFrameType.SREQ, subsystem, commandId, payload });
    return response;
  }

  async #startReading(): Promise<void> {
    const readable: ReadableStream<Uint8Array> | null = this.#port.readable;
    if (readable === null) {
      throw new Error('port is not open: no readable stream');
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = readable.getReader();
    this.#reader = reader;
    try {
      while (!this.#closed) {
        const result: ReadableStreamReadResult<Uint8Array> = await reader.read();
        if (result.done) {
          break;
        }
        this.#onBytes(result.value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  #onBytes(bytes: Uint8Array): void {
    const frames: readonly ZnpFrame[] = this.#decoder.push(bytes);
    for (const frame of frames) {
      const waiters: ZnpFrameWaiter[] = this.#waiters.splice(0);
      let requeued: ZnpFrameWaiter[] = [];
      for (const waiter of waiters) {
        if (waiter.predicate(frame)) {
          clearTimeout(waiter.timer);
          waiter.resolve(frame);
        } else {
          requeued.push(waiter);
        }
      }
      this.#waiters.push(...requeued);
      requeued = [];
      for (const listener of [...this.#listeners]) {
        listener(frame);
      }
    }
  }
}

/**
 * Options of a ZNP request or frame wait.
 */
export interface ZnpRequestOptions {
  /** Time to wait, in milliseconds. */
  readonly timeout?: number;
}

/**
 * Options of a ZNP connection.
 */
export interface ZnpConnectionOptions {
  /** Baud rate of the ZNP UART. Defaults to `115200`. */
  readonly baudRate?: number;
}

interface ZnpFrameWaiter {
  readonly predicate: (frame: ZnpFrame) => boolean;
  readonly resolve: (frame: ZnpFrame) => void;
  readonly reject: (reason?: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}
