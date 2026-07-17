# Robodeck — Offline Firmware

A fully offline, split-module build of the Robodeck handheld. No Wi-Fi, no
server, no clock — it boots straight into a menu of 18 built-in games that load
on demand. Every input device (D-pad, joystick, slider, buzzer, gyro) is turned
on/off and re-pinned from a single `CONFIG` block at the top of `index.ts`, so
the same firmware runs on deck variants with different hardware fitted.

---

## Contents

```
robodeck-offline/
├── index.ts         # Firmware: boot, menu, input layer, game runner
├── runtime.d.ts     # Type declarations for the Saturn runtime modules
├── games/           # One module per game, imported only when selected
└── README.md
```

The firmware targets the **Saturn** runtime (HUB75 RGB display, Pmod headers,
ADC, I2C). Games are separate `.js` modules under `games/`; the menu only parses
the small game index at boot and dynamically imports a game when you pick it.

---

## Quick start

1. Open `index.ts` and edit the **`CONFIG`** block to match your board (see below).
2. Flash the firmware and the `games/` folder to the device.
3. Power on — the deck boots into the game menu.

Out of the box the config reproduces the original deck's behavior exactly:
D-pad, joystick, and slider enabled (with the mounting inversions this deck
uses), and the buzzer and gyro **disabled**. Turn those two on when the hardware
is fitted (details below).

---

## The `CONFIG` block

Everything hardware-related lives in one place. Each device has an `enabled`
flag, its pins, and orientation options. Nothing outside this block needs
editing to re-pin the deck.

| Option | Meaning |
| --- | --- |
| `enabled` | Is this hardware physically fitted on your board? |
| `pmod` / `pin` | Which header / pin it is wired to (`SaturnPins.PmodN.PinM`) |
| `invertX` / `invertY` / `invert` | Flip an axis or direction (180° or mirrored mounts) |
| `swapXY` | Exchange the X and Y axes (chip/stick rotated 90°) |
| `deadzone` | Joystick readings smaller than this count as centred |

### Default pin map

| Device | Header | Pins | Notes |
| --- | --- | --- | --- |
| D-pad | Pmod1 | up=Pin3, down=Pin2, left=Pin1, right=Pin4 | Order matches the 180° mount |
| Joystick | Pmod2 | X=Pin1, Y=Pin2, click=Pin4 | `invertX: true` for the mount |
| Slider | Pmod3 | Pin5 | `invert: true` |
| Piezo | Pmod2 | Pin1 | disabled by default |
| Gyro (MPU6050) | I2C | SCL=21, SDA=14 | disabled by default |

---

## Enabling each peripheral

### Buzzer (piezo)

```ts
piezo: {
  enabled: true,              // set true once a buzzer is fitted
  pin: SaturnPins.Pmod2.Pin1,
  volume: "MID",              // "LOW" | "MID" | "HIGH"
},
```

When enabled, a real driver is used; when disabled, a silent stub takes its
place so games can call `piezo.playSong(...)` either way. The sound-effect IDs
(`Effects`) are always available.

### Gyro / accelerometer (MPU6050)

```ts
gyro: {
  enabled: true,              // set true once an MPU6050 is fitted
  scl: 21,
  sda: 14,
  invertX: false,            // flip tilt/rotation left-right
  invertY: false,            // flip tilt/rotation up-down
  swapXY: false,             // exchange X and Y (chip rotated 90°)
},
```

When enabled and detected, games get an `mpu` object with:

- `mpu.getAcceleration()` → `[x, y, z]` acceleration
- `mpu.getRotation()` → `[x, y, z]` gyro (angular rate)

The `invert*` / `swapXY` options are applied to **both** so the whole system
shares one orientation. When the gyro is disabled or not detected, `mpu` is
`null` and gyro-based games show their own "NO GRO" message instead of crashing.
Device setup is wrapped in try/catch, so a missing or misbehaving chip degrades
gracefully.

### Slider, joystick, D-pad

Already enabled by default. Re-pin or re-orient them in the same way — for
example, to reverse the slider direction flip `slider.invert`, or to reverse
up/down on the stick set `joystick.invertY: true`.

---

## Controls

**In the menu**

| Action | Control |
| --- | --- |
| Move up / down | D-pad up/down, or push the joystick up/down |
| Select game | D-pad right, or click the joystick |
| Open SCORES screen | Hold **up + down** together (~0.45 s) |
| Reboot / reload | Hold **all four** D-pad directions (~0.45 s) |

**In a game**

| Action | Control |
| --- | --- |
| Exit to menu | Hold **left + right** together |

Best scores are kept in memory for the current session (there is no persistent
storage or server in the offline build).

---

## Games

18 games ship in the menu:

`SNAKE`, `FLAP`, `DINO`, `SKI`, `DASH`, `SIMON`, `TETRIS`, `ASTRO`, `BREAK`,
`PONG`, `RACE`, `STACK`, `SHOOT`, `MAZE`, `CATCH`, `CROSS`, `2048`, `BEAT`.

To add or remove a game, edit `GAME_LIST` (the menu entry) and `GAME_LOADERS`
(the import path) near the top of `index.ts`, and drop the module in `games/`.

---

## Writing a game

Each game module exports a `default` (or `run`) async function that receives an
`api` object. Destructure what you need:

```js
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

  while (!api.exitRequested) {
    // ... game loop ...
    await sleep(33);
  }
  await gameOverScreen(score);
}
```

Handy pieces of the API:

- **Input:** `joyX()`, `joyY()` (−1..1 with deadzone), `sliderPos()` (0..1),
  `held` (`{up,down,left,right}` booleans), `mpu` (gyro or `null`).
- **`makeHControl(startX, minX, maxX, speed)`** — a horizontal control that
  automatically follows whichever of slider / joystick / D-pad the player last
  used. Call `.update()` each frame for the new X.
- **Drawing:** `setPx`, `drawText`, `drawRect`, plus `flashScreen` and `explode`
  effects, on the RGB display.
- **Sound:** `piezo.playSong(Effects.coin)` etc. Available effect IDs: `coin`,
  `damage`, `error`, `jump`, `lose`, `menuMove`, `menuSelect`, `upgrade`, `win`.
  These are safe no-ops when the buzzer is disabled.
- **Custom input handlers:** set `api.dpadHandler` / `api.joyClickHandler` to
  react to presses, and read `api.exitRequested` to leave the loop.

---

## Notes

- The firmware imports `piezo`, `mpu6050`, and `i2c` at the top (the same
  pattern as the networked `deck-firmware.ts`). These are Saturn runtime
  libraries and are safe to import even when the *device* isn't fitted — only
  the `PIEZO` / `MPU6050` objects are constructed, and only when the matching
  `enabled` flag is set. If a specific board build genuinely ships without one
  of those modules, comment out that one import and leave its `enabled: false`.
- The display uses a precomputed pixel map that corrects for the 180° mounting,
  so games draw in normal orientation without per-pixel rotation math.
