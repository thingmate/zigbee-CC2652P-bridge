import { describe, expect, it } from 'vitest';

import type { SerialPort as WebSerialPort } from '@thingmate/node-web-serial';
import { MockSerialPort } from '../../fabrique/test/tools.ts';

describe('SerialPort contract', () => {
  it('is satisfied by the test mock', () => {
    type GMockSatisfiesWebSerialPort = MockSerialPort extends WebSerialPort ? true : false;
    const satisfied: GMockSatisfiesWebSerialPort = true;
    expect(satisfied).toBe(true);
  });

  it('is satisfied by the browser SerialPort', () => {
    type GBrowserSerialPortSatisfiesWebSerialPort = SerialPort extends WebSerialPort ? true : false;
    const satisfied: GBrowserSerialPortSatisfiesWebSerialPort = true;
    expect(satisfied).toBe(true);
  });
});
