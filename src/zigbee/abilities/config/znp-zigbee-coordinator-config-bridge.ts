import { PropertyAbilities } from '@thingmate/abilities';
import type { ZigbeeCoordinatorConfig, ZigbeeCoordinatorConfigAbilities } from '@thingmate/zigbee';
import { AsyncFunction } from '@xstd/async-function';
import type { ZnpDevice } from '../../../znp/device/znp-device.ts';
import { observableFromListenerSource } from '../../observable-from-listener-source/observable-from-listener-source.ts';

/**
 * Property abilities over the network configuration of a Z-Stack ZNP
 * coordinator, bridged to the ZNP device:
 * - `read` reads the network state reported by the coordinator,
 * - `write` applies the configuration: the radio transmission power is set
 *   immediately, and the network parameters re-commission the network when
 *   they differ from the current network,
 * - `observe` emits the configuration after every startup or
 *   re-commissioning.
 */
export class ZnpZigbeeCoordinatorConfigBridge
  extends PropertyAbilities<ZigbeeCoordinatorConfig>
  implements ZigbeeCoordinatorConfigAbilities
{
  /**
   * Creates config property abilities bridged to the provided ZNP device.
   * @param device - The ZNP device connection.
   */
  constructor(device: ZnpDevice) {
    super({
      read: new AsyncFunction<[], ZigbeeCoordinatorConfig>(
        async (_signal: AbortSignal): Promise<ZigbeeCoordinatorConfig> => {
          await device.ensureStarted();
          return device.readNetworkState();
        },
      ),
      write: new AsyncFunction<[ZigbeeCoordinatorConfig], void>(
        async (_signal: AbortSignal, config: ZigbeeCoordinatorConfig): Promise<void> => {
          await device.setTxRadio(config.txRadio);
          await device.ensureNetworkOptions({
            channel: config.channel,
            panId: config.panId,
            extPanId: config.extPanId,
            key: config.key,
          });
        },
      ),
      observe: observableFromListenerSource<ZigbeeCoordinatorConfig>(
        async (): Promise<(emit: (config: ZigbeeCoordinatorConfig) => void) => () => void> => {
          await device.ensureStarted();
          return (emit: (config: ZigbeeCoordinatorConfig) => void): (() => void) => {
            return device.onNetworkState(emit);
          };
        },
      ),
    });
  }
}
