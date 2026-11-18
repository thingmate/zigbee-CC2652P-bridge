import { NodeSerial, NodeSerialPort } from '../../src/node-web-serial/node-web-serial.ts';

/** USB vendor identifier of the Silicon Labs CP2102N bridge of the ZBDongle-P. */
const SILICON_LABS_VENDOR_ID = 0x10c4 as const;

/**
 * Selects the coordinator's serial port through the Web Serial API port
 * selection, printing the selected port.
 * @returns The selected, not yet opened, port.
 */
export async function requestCoordinatorPort(): Promise<NodeSerialPort> {
  const serial: NodeSerial = new NodeSerial();
  const port: NodeSerialPort = await serial.requestPort({ usbVendorId: SILICON_LABS_VENDOR_ID });
  const info: { usbVendorId?: number | undefined; usbProductId?: number | undefined } =
    port.getInfo();
  const vendorId: string = info.usbVendorId?.toString(16).padStart(4, '0') ?? '----';
  const productId: string = info.usbProductId?.toString(16).padStart(4, '0') ?? '----';
  console.log(`using port ${port.path} (USB ${vendorId}:${productId})`);
  return port;
}
