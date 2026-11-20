# Design: replace the local Node Web Serial adapter with `@thingmate/node-web-serial`

Date: 2026-11-20
Status: approved

## Intent and why

The project is a draft being improved. Its local adapter
`src/node-web-serial/node-web-serial.ts` (`NodeSerial`, `NodeSerialPort` on top
of the `serialport` package) duplicates what the published
[`@thingmate/node-web-serial`](https://www.npmjs.com/package/@thingmate/node-web-serial)
package provides — a spec-faithful Web Serial API implementation for Node.js.
Owning the adapter in this repository means maintaining serial semantics here;
owning it in the dedicated package keeps this repository focused on the ZNP
bridge.

## Goals

- Depend on `@thingmate/node-web-serial` instead of `serialport` (which becomes
  a transitive dependency of the new package).
- Delete the local adapter module and its tests; the package carries its own
  test suite upstream.
- Keep the library core untouched: it depends only on `SerialPortLike`.

## Non-goals

- No change to the ZNP/CC2652P layers.
- No update to historical records under `docs/superpowers/` (they document the
  state at their writing date).

## Constraints

- The package's `NodeSerialPort` must satisfy `SerialPortLike` structurally, so
  the same library code keeps running in a browser, in Node, and against mocks.

## Approaches considered

1. **Align `SerialPortLikeSignalsState` with the Web Serial spec (chosen).**
   `getSignals()` returns the four input signals only (`clearToSend`,
   `dataCarrierDetect`, `dataSetReady`, `ringIndicator`), as the spec's
   `SerialInputSignals` dictionary does. Nothing in the library reads
   `dataTerminalReady`/`requestToSend` from `getSignals()`; the two extra
   fields were a convenience of the local adapter. This makes the real browser
   `SerialPort`, the package's `NodeSerialPort`, and test mocks all satisfy
   `SerialPortLike` — the README's structural-compatibility claim becomes true
   without any wrapper.
2. **Keep the six-field state behind a wrapper.** Rejected: it reintroduces
   exactly the adapter code being deleted, and nothing consumes the extra
   fields.

## Decided API mapping

- `requestPort({ usbVendorId })` → `requestPort({ filters: [{ usbVendorId }] })`
  (spec form; the package validates that each filter carries `usbVendorId`).
- `getPorts()` takes no filters (spec behavior: it lists every port; filtering
  is `requestPort`'s job).
- Errors: no-match rejects with a `NotFoundError` DOMException; several matches
  reject with an error asking to narrow the filters.

## Changes

1. `package.json`: add `@thingmate/node-web-serial`, drop `serialport`.
2. Delete `src/node-web-serial/` (module + test).
3. `probes/list-ports.ts`, `probes/open-port/open-port.ts`: import from the
   package, adapt the `requestPort` call.
4. `src/serial-port-like/serial-port-like.ts`: `SerialPortLikeSignalsState`
   aligned on `SerialInputSignals` (four fields), documentation updated.
5. `README.md`, `probes/README.md`: import paths and mentions updated.

## Left to the builder

- Exact wording of README adjustments.
- Running `yarn install` to refresh the lockfile, then `yarn fb:check` and
  `yarn fb:test` as validation.
