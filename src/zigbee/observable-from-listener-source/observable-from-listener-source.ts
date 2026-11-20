import { ListenerResource } from '@xstd/listener-resource';
import { ObservableAsyncFunction } from '@xstd/observable-async-function';

/**
 * A function attaching an emit function to an event source, returning the
 * detachment teardown.
 */
export type ListenerSourceAttach<GValue> = (emit: (value: GValue) => void) => () => void;

/**
 * Builds an {@link ObservableAsyncFunction} from a push-based event source.
 *
 * Each call establishes a new resource: the provided establish function is
 * awaited (it may ensure the upstream is ready), then its returned attach
 * function registers the emit function. Closing the established resource runs
 * the teardown returned by the attach function.
 * @param establish - Establishes the upstream and returns the attach function.
 * @returns The observable async function emitting the source's values.
 */
export function observableFromListenerSource<GValue, GArguments extends readonly unknown[] = []>(
  establish: (
    signal: AbortSignal,
    ...argumentsList: GArguments
  ) => Promise<ListenerSourceAttach<GValue>>,
): ObservableAsyncFunction<GValue, GArguments> {
  return new ObservableAsyncFunction<GValue, GArguments>(
    async (
      signal: AbortSignal,
      ...argumentsList: GArguments
    ): Promise<ListenerResource<GValue>> => {
      const attach: ListenerSourceAttach<GValue> = await establish(signal, ...argumentsList);
      return new ListenerResource<GValue>(
        (emit: (value: GValue) => void, _closeSignal: AbortSignal): (() => void) => {
          return attach(emit);
        },
      );
    },
  );
}
