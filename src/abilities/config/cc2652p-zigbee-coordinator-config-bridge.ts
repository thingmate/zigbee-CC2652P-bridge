import { PropertyAbilities } from '@thingmate/abilities';
import type { ZigbeeCoordinatorConfig, ZigbeeCoordinatorConfigAbilities } from '@thingmate/zigbee';
import { AsyncFunction } from '@xstd/async-function';
import type { Cc2652pZnpDevice } from '../../cc2652p-znp-device/cc2652p-znp-device.ts';
import { observableFromListenerSource } from '../../observable-from-listener-source/observable-from-listener-source.ts';

/**
 * Property abilities over the network configuration of a CC2652P ZNP
 * coordinator, bridged to the ZNP connection:
 * - `read` reads the configuration directly from the coordinator,
 * - `write` applies the configuration: the radio transmission power is set
 *   immediately, and the network parameters re-commission the network when
 *   they differ from the current network,
 * - `observe` emits the configuration after every startup or
 *   re-commissioning.
 */
export class Cc2652pZigbeeCoordinatorConfigBridge
  extends PropertyAbilities<ZigbeeCoordinatorConfig>
  implements ZigbeeCoordinatorConfigAbilities
{
  /**
   * Creates config property abilities bridged to the provided ZNP device.
   * @param device - The ZNP device connection.
   */
  constructor(device: Cc2652pZnpDevice) {
    super({
      read: new AsyncFunction<[], ZigbeeCoordinatorConfig>(
        async (_signal: AbortSignal): Promise<ZigbeeCoordinatorConfig> => {
          await device.ensureStarted();
          return device.readConfig();
        },
      ),
      write: new AsyncFunction<[ZigbeeCoordinatorConfig], void>(
        async (_signal: AbortSignal, config: ZigbeeCoordinatorConfig): Promise<void> => {
          await device.writeConfig(config);
        },
      ),
      observe: observableFromListenerSource<ZigbeeCoordinatorConfig>(
        async (): Promise<(emit: (config: ZigbeeCoordinatorConfig) => void) => () => void> => {
          await device.ensureStarted();
          return (emit: (config: ZigbeeCoordinatorConfig) => void): (() => void) => {
            return device.onConfig(emit);
          };
        },
      ),
    });
  }
}
