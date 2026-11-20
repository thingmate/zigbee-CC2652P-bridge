import { describe, expect, it } from 'vitest';

import type { NodeSerialPort } from '@thingmate/node-web-serial';
import type { SerialPortLike } from './serial-port-like.ts';

describe('SerialPortLike', () => {
  it('is structurally satisfied by the @thingmate/node-web-serial NodeSerialPort', () => {
    type GNodeSerialPortSatisfiesSerialPortLike = NodeSerialPort extends SerialPortLike
      ? true
      : false;
    const satisfied: GNodeSerialPortSatisfiesSerialPortLike = true;
    expect(satisfied).toBe(true);
  });
});
