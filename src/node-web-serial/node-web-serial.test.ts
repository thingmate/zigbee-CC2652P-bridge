import { describe, expect, it } from 'vitest';

import { NodeSerialPort } from './node-web-serial.ts';

describe('NodeSerialPort', () => {
  it('reports the operating system path of the port', () => {
    const port: NodeSerialPort = new NodeSerialPort({ path: '/dev/ttyUSB0' });
    expect(port.path).toBe('/dev/ttyUSB0');
  });

  it('reports the USB identifiers when provided', () => {
    const port: NodeSerialPort = new NodeSerialPort({ path: '/dev/ttyUSB0', info: { usbVendorId: 0x10c4 } });
    expect(port.getInfo()).toEqual({ usbVendorId: 0x10c4 });
  });
});
