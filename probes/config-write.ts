import type { ZigbeeCoordinatorConfig } from '@thingmate/zigbee';
import { ZnpZigbeeCoordinator } from '../src/zigbee/znp-zigbee-coordinator/znp-zigbee-coordinator.ts';
import { requestCoordinatorPort } from './open-port/open-port.ts';

/** Mutable accumulator of the provided configuration overrides. */
interface ConfigOverrides {
  channel?: number;
  panId?: number;
  extPanId?: bigint;
  key?: Uint8Array;
}

function printUsage(): void {
  console.log(
    [
      'usage: node probes/config-write.ts [--channel=<11..26>] [--pan-id=<hex|decimal>]',
      '                                   [--ext-pan-id=<hex up to 16 digits>] [--key=<32 hex digits>]',
      '',
      'without arguments, the current configuration is written back unchanged:',
      'only the radio power is re-applied (non-destructive).',
      'with network arguments, the network is RE-COMMISSIONED: every paired',
      'device must be paired again.',
    ].join('\n'),
  );
}

function parseArguments(argumentsList: readonly string[]): ConfigOverrides {
  const overrides: ConfigOverrides = {};
  for (const argument of argumentsList) {
    const match: RegExpMatchArray | null = argument.match(/^--([a-z-]+)=(.+)$/);
    if (match === null) {
      printUsage();
      process.exit(1);
    }
    const name: string = match[1] as string;
    const value: string = match[2] as string;
    switch (name) {
      case 'channel': {
        const channel: number = Number.parseInt(value, 10);
        if (!Number.isInteger(channel) || channel < 11 || channel > 26) {
          console.error(`invalid channel: ${value}`);
          process.exit(1);
        }
        overrides.channel = channel;
        break;
      }
      case 'pan-id': {
        const panId: number = Number.parseInt(value, value.startsWith('0x') ? 16 : 10);
        if (!Number.isInteger(panId) || panId < 0 || panId > 0xfffe) {
          console.error(`invalid pan id: ${value}`);
          process.exit(1);
        }
        overrides.panId = panId;
        break;
      }
      case 'ext-pan-id': {
        if (!/^[0-9a-fA-F]{1,16}$/.test(value)) {
          console.error(`invalid ext pan id: ${value}`);
          process.exit(1);
        }
        overrides.extPanId = BigInt(`0x${value}`);
        break;
      }
      case 'key': {
        if (!/^[0-9a-fA-F]{32}$/.test(value)) {
          console.error(`invalid key: ${value} (32 hexadecimal digits required)`);
          process.exit(1);
        }
        overrides.key = new Uint8Array(16).map((_byte: number, index: number): number =>
          Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
        );
        break;
      }
      default: {
        console.error(`unknown option: --${name}`);
        printUsage();
        process.exit(1);
      }
    }
  }
  return overrides;
}

function formatConfig(config: ZigbeeCoordinatorConfig): string {
  return `channel ${config.channel}  panId 0x${config.panId.toString(16).padStart(4, '0')}  extPanId 0x${config.extPanId
    .toString(16)
    .padStart(16, '0')}  key ${Array.from(config.key)
    .map((byte: number): string => byte.toString(16).padStart(2, '0'))
    .join('')}  txRadio ${config.txRadio} dBm`;
}

try {
  const overrides: ConfigOverrides = parseArguments(process.argv.slice(2));
  const port = await requestCoordinatorPort();
  const coordinator: ZnpZigbeeCoordinator = ZnpZigbeeCoordinator.fromPort(port);

  const current: ZigbeeCoordinatorConfig = await coordinator.config.read.call(
    new AbortController().signal,
  );
  console.log(`current config: ${formatConfig(current)}`);

  const desired: ZigbeeCoordinatorConfig = {
    channel: overrides.channel ?? current.channel,
    panId: overrides.panId ?? current.panId,
    extPanId: overrides.extPanId ?? current.extPanId,
    key: overrides.key ?? current.key,
    txRadio: current.txRadio,
  };

  const destructive: boolean =
    desired.channel !== current.channel ||
    desired.panId !== current.panId ||
    desired.extPanId !== current.extPanId ||
    desired.key.some((byte: number, index: number): boolean => byte !== current.key[index]);
  if (destructive) {
    console.log(
      '!! DESTRUCTIVE: the network will be RE-COMMISSIONED, every paired device must be paired again !!',
    );
  }

  await coordinator.config.write.call(new AbortController().signal, desired);
  const applied: ZigbeeCoordinatorConfig = await coordinator.config.read.call(
    new AbortController().signal,
  );
  console.log(`applied config: ${formatConfig(applied)}`);

  await coordinator.close();
} catch (error: unknown) {
  console.error(`config-write failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
