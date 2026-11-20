import type { SerialPort } from '@thingmate/node-web-serial';
import { ZigbeeCoordinator } from '@thingmate/zigbee';
import { AsyncFunction } from '@xstd/async-function';
import { ZnpDevice } from '../../znp/device/znp-device.ts';
import { type ZnpFrame, ZnpSubsystem } from '../../znp/frame/znp-frame.ts';
import { uintToLittleEndian } from '../../znp/network/znp-network.ts';
import { ZnpZigbeeCoordinatorConfigBridge } from '../abilities/config/znp-zigbee-coordinator-config-bridge.ts';
import { ZnpZigbeeCommandFrameBridge } from '../abilities/frame/znp-zigbee-command-frame-bridge.ts';

/**
 * A {@link ZigbeeCoordinator} driven by a Z-Stack 3.x ZNP coordinator
 * (SONOFF ZBDongle-P among others) over a Web Serial API port.
 *
 * Each Zigbee ability is bridged to the ZNP protocol:
 * - the network configuration is read from the coordinator and applied to it,
 * - the network is opened or closed to new devices through a broadcast ZDO
 *   permit-joining request,
 * - ZCL command frames are sent through AF data requests and observed from
 *   AF incoming message indications.
 *
 * The first ability call opens the port (115200 bauds), skips a possible
 * bootloader, starts (or resumes) the Zigbee network, and registers the
 * Zigbee endpoint used for sending and observing frames.
 */
export class ZnpZigbeeCoordinator extends ZigbeeCoordinator {
  readonly #device: ZnpDevice;

  /**
   * Creates a Zigbee coordinator driven by the provided ZNP device.
   * @param device - The ZNP device connected to the coordinator.
   */
  constructor(device: ZnpDevice) {
    super({
      config: new ZnpZigbeeCoordinatorConfigBridge(device),
      permitJoin: new AsyncFunction<readonly [duration: number], void>(
        async (_signal: AbortSignal, duration: number): Promise<void> => {
          await device.ensureStarted();
          const seconds: number = Math.min(Math.max(0, Math.floor(duration)), 254);
          // ZDO_PERMIT_JOINING_REQ: [addressMode = 3 (broadcast), destination =
          // 0xfffc (all routers), duration, TC significance = 1]
          const response: Awaited<ReturnType<typeof device.request>> = await device.request(
            ZnpSubsystem.ZDO,
            0x08,
            Uint8Array.from([0x03, ...uintToLittleEndian(0xfffc, 2), seconds, 0x01]),
          );
          if (response.payload[0] !== 0x00) {
            throw new Error(
              `permit joining request failed: status 0x${response.payload[0]?.toString(16)}`,
            );
          }
        },
      ),
      command: new ZnpZigbeeCommandFrameBridge(device),
    });
    this.#device = device;
  }

  /**
   * Creates a coordinator bridged to the provided serial port.
   * @param port - The Web Serial API port connected to the coordinator.
   */
  static fromPort(port: SerialPort): ZnpZigbeeCoordinator {
    return new ZnpZigbeeCoordinator(new ZnpDevice(port));
  }

  /**
   * Reports the device state of the underlying coordinator, starting it if
   * needed.
   * @returns The ZDO device state (e.g. `9` when running as coordinator).
   */
  async readDeviceState(): Promise<number> {
    await this.#device.ensureStarted();
    const response: ZnpFrame = await this.#device.request(ZnpSubsystem.UTIL, 0x00);
    return response.payload[12] as number;
  }

  /**
   * Closes the serial connection. The next ability call reconnects.
   */
  async close(): Promise<void> {
    await this.#device.close();
  }
}
