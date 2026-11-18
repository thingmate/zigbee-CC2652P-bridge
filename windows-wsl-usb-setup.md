# Windows + WSL USB setup (SONOFF ZBDongle-P)

The coordinator is a [SONOFF Zigbee 3.0 USB Dongle Plus (ZBDongle-P)](https://sonoff.tech/products/sonoff-zigbee-3-0-usb-dongle-plus-p): an TI CC2652P radio behind a Silicon Labs CP2102N USB-to-UART bridge.

WSL2 has no USB access by default, so the dongle is shared from the Windows host with [usbipd-win](https://learn.microsoft.com/windows/dev-environment/devices/usbipd-win).

## Windows side (PowerShell as Administrator)

```powershell
# One-time install
winget install usbipd

# Find the dongle — look for "CP2102N USB-to-UART", VID 10C4:EA60
usbipd list

# Share it and attach it to WSL (busid from the previous output)
usbipd bind --busid 4-2
usbipd attach --wsl --auto-attach --busid 4-2
```

Notes:

- `bind` is one-time per device and survives reboots; `attach` is lost on every
  reboot, so keep the `--auto-attach` command running (it re-attaches
  automatically whenever the dongle appears or WSL restarts).
- `--auto-attach` blocks the terminal: run it in a dedicated PowerShell window
  (or a scheduled task / startup shortcut).
- The busid (`4-2` here) is the physical USB port. Plugging the dongle into a
  different port changes the busid — re-run `usbipd list` to find it.

## WSL side

Once attached, the dongle shows up as a USB serial device:

```console
$ ls -l /dev/serial/by-id/
lrwxrwxrwx ... usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_34e8f9c82315f0119068e274b887153e-if00-port0 -> ../../ttyUSB0
```

- Prefer the `/dev/serial/by-id/...` path over `/dev/ttyUSB0`: it is stable
  regardless of how many other serial devices are attached or in which order.
- The kernel driver `cp210x` is built as a module in the WSL2 kernel and loads
  automatically, nothing to install.

## Serial port permissions

The device node is owned by `root:dialout` with mode `0660`. Add your user to
the `dialout` group, then log out and back in (or restart WSL with
`wsl --shutdown` on Windows):

```sh
sudo usermod -aG dialout $USER
```

## Firmware

Flashed on 2026-11-18 with the Koenkk coordinator firmware
[`Z-Stack_3.x.0_coordinator_20250321`](https://github.com/Koenkk/Z-Stack-firmware/releases/latest)
(file `CC1352P2_CC2652P_launchpad_coordinator_20250321.zip`, launchpad variant
is the one for the ZBDongle-P). The factory ITead firmware it replaced
(build 20210708) stopped answering MT requests after the first exchange after
each power-on.

Flashing is done from WSL directly over the usbipd-attached serial port, no
enclosure opening and no BOOT button needed:

```sh
python3 -m pip install --user --break-system-packages pyserial intelhex
git clone --depth 1 https://github.com/JelmerT/cc2538-bsl /tmp/cc2538-bsl
python3 /tmp/cc2538-bsl/cc2538_bsl/cc2538_bsl.py \
  --bootloader-sonoff-usb \
  -p /dev/serial/by-id/usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_34e8f9c82315f0119068e274b887153e-if00-port0 \
  -e -w -v CC1352P2_CC2652P_launchpad_coordinator_20250321.hex
```

`--bootloader-sonoff-usb` toggles DTR/RTS to reset the CC2652P into its
bootloader. The mass erase wipes the Zigbee network state, so flash only
before pairing devices. The primary IEEE address is preserved (it lives in a
separate info page).

To verify after flashing, issue a raw `SYS_VERSION` request
(`FE 00 21 02 23` at 115200 8N1) and check the `revision` UINT32: it reads
back as `20250321` (little-endian bytes `D1 FE 34 01`).
