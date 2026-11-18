/**
 * Subset of the Web Serial API `SerialPort` interface
 * (https://wicg.github.io/serial/) used by this library.
 *
 * The real browser `SerialPort` structurally satisfies this interface. Node.js
 * users get an equivalent implementation through the `node-web-serial` module,
 * and tests inject mocks.
 */
export interface SerialPortLike {
  /**
   * Opens the port with the provided options.
   * @param options - Open options mirroring the Web Serial API `SerialOptions`.
   */
  open(options: SerialPortLikeOptions): Promise<void>;
  /**
   * Incoming byte stream, or `null` while the port is closed, as specified by
   * the Web Serial API.
   */
  readonly readable: ReadableStream<Uint8Array> | null;
  /**
   * Outgoing byte stream, or `null` while the port is closed, as specified by
   * the Web Serial API.
   */
  readonly writable: WritableStream<Uint8Array> | null;
  /**
   * Updates the modem control signals (DTR and RTS).
   * @param signals - The signals to set; omitted fields keep their state.
   */
  setSignals(signals?: SerialPortLikeSignals): Promise<void>;
  /**
   * Reads the current state of the modem control signals.
   */
  getSignals(): Promise<SerialPortLikeSignalsState>;
  /**
   * Reports the USB identifiers of the underlying device, if any.
   */
  getInfo(): SerialPortLikeInfo;
  /**
   * Closes the port.
   */
  close(): Promise<void>;
}

/**
 * Open options of a {@link SerialPortLike}, mirroring the Web Serial API
 * `SerialOptions`.
 */
export interface SerialPortLikeOptions {
  /** Baud rate, in bits per second. */
  readonly baudRate: number;
  /** Number of data bits: `7` or `8`. Defaults to `8`. */
  readonly dataBits?: number;
  /** Number of stop bits: `1` or `2`. Defaults to `1`. */
  readonly stopBits?: number;
  /** Parity mode. Defaults to `'none'`. */
  readonly parity?: 'even' | 'none' | 'odd';
  /** Flow control mode. Defaults to `'none'`. */
  readonly flowControl?: 'hardware' | 'none';
}

/**
 * Modem control signals of a {@link SerialPortLike}, mirroring the Web Serial
 * API `SerialSignals`.
 */
export interface SerialPortLikeSignals {
  /** Data Terminal Ready (DTR) state. */
  readonly dataTerminalReady?: boolean;
  /** Request To Send (RTS) state. */
  readonly requestToSend?: boolean;
}

/**
 * Modem control signals state of a {@link SerialPortLike}, mirroring the Web
 * Serial API `SerialSignalsState` (returned by `getSignals`).
 */
export interface SerialPortLikeSignalsState {
  readonly clearToSend: boolean;
  readonly dataCarrierDetect: boolean;
  readonly dataTerminalReady: boolean;
  readonly dataSetReady: boolean;
  readonly ringIndicator: boolean;
  readonly requestToSend: boolean;
}

/**
 * USB identifiers of the device behind a {@link SerialPortLike}, mirroring the
 * Web Serial API `SerialPortInfo`.
 */
export interface SerialPortLikeInfo {
  readonly usbVendorId?: number | undefined;
  readonly usbProductId?: number | undefined;
}
