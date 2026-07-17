# Robodeck — Offline Firmware

A fully **offline** build of the Robodeck handheld running on the **Saturn
(ESP32-S3)** board with the [**Jaculus**](https://jaculus.org) JavaScript
runtime. No Wi-Fi, no server, no clock — it boots straight into a menu of **18
built-in games** that load on demand. Every input device (D-pad, joystick,
slider, buzzer, gyro) is turned on/off and re-pinned from a single `CONFIG`
block at the top of `index.ts`, so the same firmware runs on deck variants with
different hardware fitted.

> Coming from the networked build? This version has **no `deck-firmware.ts`, no
> `server.js`, no leaderboard, and no gallery**. Games are bundled on the device
> and everything runs standalone. There's nothing to configure for WiFi or a
> server here.

---

## Contents

```
robodeck-ai-slop/
├── index.ts         # Firmware: boot, menu, input layer, game runner + CONFIG
├── runtime.d.ts     # Type declarations for the Saturn runtime modules
├── games/           # One .ts module per game, imported only when selected
└── README.md
```

The firmware targets the **Saturn** runtime (HUB75 RGB display, Pmod headers,
ADC, I2C). Games are separate modules under `games/`; the menu parses the small
game index at boot and dynamically imports a game only when you pick it.

---

## Prerequisites

- **[Node.js](https://nodejs.org) 22 LTS or newer.**
- **Jaculus CLI tools:**
  ```bash
  npm install -g jaculus-tools@latest
  ```
  Test it with `npx jac` — it should print the help.
- A **Chromium-based browser** (Chrome, Edge, Vivaldi) or recent Firefox for the web firmware installer (needs WebSerial).
- **USB-to-UART driver** for the Saturn — usually [CP210x](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers) or CH340.
  - On Linux, if CH340 isn't detected, uninstall `brltty`, and add the [udev rules](https://docs.espressif.com/projects/esp-idf/en/v5.2.2/esp32s2/api-guides/dfu.html#udev-rule-linux-only).

---

## Setup & flashing

### 1. Flash the Jaculus runtime (once per board)

This installs the JavaScript runtime onto the Saturn. Only needed once, or when updating Jaculus.

1. Connect the Saturn with a **USB-C** cable.
   - If it keeps disconnecting/reconnecting, put it in **boot mode**: hold `BOOT`, press `EN`, release `BOOT`.
2. Open the **[Jaculus web installer](https://installer.jaculus.org/)** in Chrome/Edge/Vivaldi.
3. Click **Connect to device** and pick the Saturn's serial port (`COM…`, `ttyACM…`, or "USB JTAG/serial debug unit"). If unsure, unplug/replug — the port that changes is the right one.
4. Click **Flash firmware (ESP32-S3)** and wait. Don't change any installer settings.
5. Unplug/replug USB, then press `EN`.

Verify:

```bash
npx jac list-ports
npx jac --port <port> version
```

### 2. Put the firmware in a Jaculus project

This repo holds the source files only. Drop them into a Jaculus project so the
tools can build and upload them.

```bash
# Create a project pre-loaded with the Saturn libraries this firmware needs
npx jac project-create --from-device robodeck
cd robodeck
```

Then copy this repo's files into the project's `src/` directory:

```
src/
├── index.ts         # from this repo (project entry point)
├── runtime.d.ts     # from this repo
└── games/           # from this repo (all *.ts game modules)
```

The Saturn runtime libraries the firmware imports — `saturn`, `colors`,
`button`, `adc`, `piezo`, `mpu6050`, `i2c` — come from the project template
created above. `piezo`, `mpu6050`, and `i2c` are imported even though the buzzer
and gyro are disabled by default; that's fine, the objects are only constructed
when the matching `enabled` flag is set.

### 3. Configure the hardware

Open `src/index.ts` and edit the **`CONFIG`** block (see the next section) so it
matches how your deck is wired. Out of the box it reproduces the reference
deck's behavior exactly.

### 4. Build, flash, and run

From the project directory:

```bash
npx jac build flash monitor
```

This compiles the TypeScript (including `games/*.ts` → `.js`), uploads
everything, and opens the serial console. Press `Ctrl+C` to leave the monitor.
The deck boots into the game menu.

---

## The `CONFIG` block

Everything hardware-related lives in one place at the top of `index.ts`. Each
device has an `enabled` flag, its pins, and orientation options. Nothing outside
this block needs editing to re-pin the deck.

| Option                           | Meaning                                                     |
| -------------------------------- | ----------------------------------------------------------- |
| `display.rotation`               | Display rotation: `0`, `1`, `2`, or `3`.                    |
| `enabled`                        | Is this hardware physically fitted on your board?           |
| `pmod` / `pin`                   | Which header / pin it is wired to (`SaturnPins.PmodN.PinM`). |
| `invertX` / `invertY` / `invert` | Flip an axis or direction (180° or mirrored mounts).        |
| `swapXY`                         | Exchange the X and Y axes (chip/stick rotated 90°).         |
| `deadzone`                       | Joystick readings smaller than this count as centred.       |

### Default pin map

| Device         | Header | Pins                                      | Notes                          |
| -------------- | ------ | ----------------------------------------- | ------------------------------ |
| D-pad          | Pmod1  | up=Pin3, down=Pin2, left=Pin1, right=Pin4 | Order matches the deck's mount |
| Joystick       | Pmod2  | X=Pin1, Y=Pin2, click=Pin4                | `invertX: true` for the mount  |
| Slider         | Pmod3  | Pin5                                      | `invert: true`                 |
| Piezo          | Pmod2  | Pin1                                      | **disabled** by default        |
| Gyro (MPU6050) | I2C    | SCL=21, SDA=14                            | **disabled** by default        |

The display uses a precomputed pixel map that applies a mirror on top of the
configured `rotation` to match this deck's panel mounting, so games draw upright
without per-pixel rotation math.

---

## Enabling each peripheral

### Buzzer (piezo)

```ts
piezo: {
  enabled: true,               // set true once a buzzer is fitted
  pin: SaturnPins.Pmod2.Pin1,
  volume: "MID",               // "LOW" | "MID" | "HIGH"
},
```

When enabled, a real driver is used; when disabled, a silent stub takes its
place so games can call `piezo.playSong(...)` either way. The effect IDs
(`Effects`) are always available.

### Gyro / accelerometer (MPU6050)

```ts
gyro: {
  enabled: true,               // set true once an MPU6050 is fitted
  scl: 21,
  sda: 14,
  invertX: false,              // flip tilt/rotation left-right
  invertY: false,              // flip tilt/rotation up-down
  swapXY: false,               // exchange X and Y (chip rotated 90°)
},
```

When enabled and detected, games get an `mpu` object with:

- `mpu.getAcceleration()` → `[x, y, z]` acceleration
- `mpu.getRotation()` → `[x, y, z]` angular rate

The `invert*` / `swapXY` options apply to **both** so the whole system shares
one orientation. When the gyro is disabled or not detected, `mpu` is `null` and
gyro-based games fall back gracefully instead of crashing. Device setup is
wrapped in try/catch, so a missing or misbehaving chip degrades cleanly.

### Slider, joystick, D-pad

Enabled by default. Re-pin or re-orient them the same way — e.g. flip
`slider.invert` to reverse the slider, or set `joystick.invertY: true` to
reverse up/down on the stick.

---

## Controls

**In the menu**

| Action             | Control                                      |
| ------------------ | -------------------------------------------- |
| Move up / down     | D-pad up/down, or push the joystick up/down  |
| Select game        | D-pad right, or click the joystick           |
| Open SCORES screen | Hold **up + down** together (~0.45 s)        |
| Reboot / reload    | Hold **all four** D-pad directions (~0.45 s) |

**In a game**

| Action       | Control                        |
| ------------ | ------------------------------ |
| Exit to menu | Hold **left + right** together |

Best scores are kept in memory for the current session only — there is no
persistent storage or server in the offline build, so they reset on reboot.

---

## Games

18 games ship in the menu:

`SNAKE`, `FLAP`, `DINO`, `SKI`, `DASH`, `SIMON`, `TETRIS`, `ASTRO`, `BREAK`,
`PONG`, `RACE`, `STACK`, `SHOOT`, `MAZE`, `CATCH`, `CROSS`, `2048`, `BEAT`.

### Adding or removing a game

Two lists near the top of `index.ts` drive the menu — keep them in sync:

1. **`GAME_LIST`** — the menu entries (`id`, display `name`, tile `color`):
   ```ts
   { "id": "mygame", "name": "MYGAME", "color": [255, 120, 0] }
   ```
2. **`GAME_LOADERS`** — maps each `id` to its dynamic import:
   ```ts
   "mygame": () => import("./games/mygame.js"),
   ```
   (Games are authored as `./games/mygame.ts` but imported as `.js` — Jaculus
   compiles them on build.)
3. Drop the module in `games/`.

Display names use the deck's built-in font: `A–Z 0–9` and
`` space _ . : ! ? + / = ( ) - `` (lowercase is upper-cased automatically).

---

## Writing a game

Each module exports a `default` (or `run`) async function that receives an `api`
object. Destructure what you need:

```ts
export default async function (api) {
  const {
    display, colors, setPx, drawText, drawRect, sleep,
    flashScreen, explode, gameOverScreen,
    joyX, joyY, sliderPos, held, makeHControl,
    piezo, Effects, mpu,
  } = api;

  // mpu is null if no gyro is fitted — guard before using it:
  if (mpu) {
    const [ax, ay] = mpu.getAcceleration();
  }

  let score = 0;
  while (!api.exitRequested) {
    // ... game loop ...
    await sleep(33);
  }
  await gameOverScreen(score);
}
```

Handy pieces of the API:

- **Input:** `joyX()`, `joyY()` (−1..1 with deadzone), `sliderPos()` (0..1),
  `held` (`{up, down, left, right}` booleans), `mpu` (gyro or `null`).
- **`makeHControl(startX, minX, maxX, speed)`** — a horizontal control that
  automatically follows whichever of slider / joystick / D-pad the player last
  used. Call `.update()` each frame for the new X.
- **Drawing:** `setPx`, `drawText`, `drawRect`, plus `flashScreen` and `explode`
  effects, on the RGB display.
- **Sound:** `piezo.playSong(Effects.coin)` etc. Effect IDs include `coin`,
  `damage`, `error`, `jump`, `lose`, `menuMove`, `menuSelect`, `upgrade`, `win`.
  Safe no-ops when the buzzer is disabled.
- **Custom input:** set `api.dpadHandler` / `api.joyClickHandler` to react to
  presses, and read `api.exitRequested` to leave the loop.

---

## Troubleshooting

| Symptom                          | Likely cause / fix                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Board disconnects while flashing | Put it in boot mode: hold `BOOT`, press `EN`, release `BOOT`.                       |
| Display mirrored / upside-down   | Adjust `CONFIG.display.rotation` (`0`–`3`).                                         |
| A direction or axis is reversed  | Flip the relevant `invert*` (or `swapXY`) flag for that device in `CONFIG`.         |
| A game crashes on launch         | It probably uses the gyro — enable `gyro`, or check the module guards `mpu` for `null`. |
| No sound                         | `piezo.enabled` is `false` by default; set it `true` once a buzzer is fitted.       |
| New game doesn't appear          | You added it to only one of `GAME_LIST` / `GAME_LOADERS` — update both.             |
| `jac` / driver issues            | See the [Jaculus troubleshooting guide](https://jaculus.org/troubleshooting/).      |

---

## Reference

- Jaculus runtime & tools: <https://jaculus.org>
- Firmware installer (web): <https://installer.jaculus.org/>
- Robodeck build & lessons: <https://2026.robotickytabor.cz>
