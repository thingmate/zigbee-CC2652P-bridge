import { NodeSerial, type NodeSerialPort } from '@thingmate/node-web-serial';

const serial: NodeSerial = new NodeSerial();
// The hub hands out its own NodeSerialPort instances; the class carries the
// Node `path` extension the Web Serial `SerialPort` interface omits.
const ports: NodeSerialPort[] = (await serial.getPorts()) as NodeSerialPort[];
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
