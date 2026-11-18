import { NodeSerial } from '../src/node-web-serial/node-web-serial.ts';

const serial: NodeSerial = new NodeSerial();
const ports: Awaited<ReturnType<typeof serial.getPorts>> = await serial.getPorts();
if (ports.length === 0) {
  console.log('no serial port found');
  process.exit(1);
}
for (const port of ports) {
  const info: { usbVendorId?: number | undefined; usbProductId?: number | undefined } =
    port.getInfo();
  const vendorId: string = info.usbVendorId?.toString(16).padStart(4, '0') ?? '----';
  const productId: string = info.usbProductId?.toString(16).padStart(4, '0') ?? '----';
  console.log(`${port.path}  USB ${vendorId}:${productId}`);
}
