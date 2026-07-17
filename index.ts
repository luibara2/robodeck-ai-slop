// ROBODECK - FULLY OFFLINE, SPLIT-MODULE BUILD
// =============================================================================
// No Wi-Fi/server/clock. Every input device (D-pad, joystick, slider, buzzer,
// gyro) is turned on/off and re-pinned from the single CONFIG block below, so
// the same firmware runs on deck variants with different hardware fitted.
//
// Games are separate files under ./games and are dynamically imported only
// when selected. The menu firmware no longer parses or rewrites every game at
// startup, and replaying a game reuses the same module path instead of creating
// g0.js, g1.js, g2.js... cached copies.
// =============================================================================
import { createSaturn, SaturnPins } from "saturn";
import * as colors from "colors";
import { Button } from "button";
import * as adc from "adc";
// These are Saturn runtime libraries and are always resolvable. Only the
// PIEZO/MPU6050 *devices* are optional - construction happens further down and
// only when the matching CONFIG block is enabled. If a particular board build
// genuinely ships without one of these modules, comment its import out and set
// the corresponding `enabled: false`.
import { PIEZO, Effects, Volume } from "piezo";
import { MPU6050 } from "mpu6050";
import { I2C1 } from "i2c";

// ============================================================================
// HARDWARE CONFIG  -  edit this block to match your deck.
// ----------------------------------------------------------------------------
// Every peripheral has an `enabled` flag plus its pins and orientation. Turn a
// device off and the firmware substitutes a safe stub; games that hard-require
// it (e.g. gyro games) show their own "missing hardware" message instead of
// crashing. Nothing outside this block needs editing to re-pin the deck.
//
//   * enabled  - is this hardware physically fitted on your board?
//   * pmod/pin - which header/pin it is wired to (see SaturnPins.PmodN.PinM)
//   * invert*  - flip an axis/direction (use for 180-degree or mirrored mounts)
//   * swapXY   - exchange the X and Y axes (for a chip rotated 90 degrees)
// ============================================================================
const CONFIG = {
  // --- D-PAD : four momentary buttons ---------------------------------------
  dpad: {
    enabled: true,
    pmod: SaturnPins.Pmod1,
    // Physical pin -> logical direction. The default order matches this deck's
    // 180-degree mounting (left/right/up/down already reversed). Re-map here if
    // your buttons are wired or oriented differently.
    pins: { up: "Pin3", down: "Pin2", left: "Pin1", right: "Pin4" },
  },

  // --- JOYSTICK : analog X/Y + push-to-click --------------------------------
  joystick: {
    enabled: true,
    pmod: SaturnPins.Pmod2,
    xPin: "Pin1",
    yPin: "Pin2",
    clickPin: "Pin4",
    invertX: true,    // 180-degree mount -> reverse left/right
    invertY: false,   // set true to reverse up/down
    swapXY: false,    // set true if the stick is physically rotated 90 degrees
    deadzone: 0.15,   // readings smaller than this are treated as centred
  },

  // --- SLIDER : linear analog potentiometer ---------------------------------
  slider: {
    enabled: true,
    pin: SaturnPins.Pmod3.Pin5,
    invert: true,     // "slider rotation": flip which end reads as 0 vs 1
  },

  // --- PIEZO / BUZZER : sound effects ---------------------------------------
  // Leave disabled on decks with no buzzer; games stay silent but keep working.
  piezo: {
    enabled: false,
    pin: SaturnPins.Pmod2.Pin1,
    volume: "MID",    // "LOW" | "MID" | "HIGH"  (keys of the piezo Volume enum)
  },

  // --- GYRO / ACCELEROMETER : MPU6050 over I2C ------------------------------
  // Leave disabled on decks with no motion sensor. When enabled, games get
  // mpu.getAcceleration() and mpu.getRotation(); the invert/swap options below
  // are applied to both so the whole system shares one orientation.
  gyro: {
    enabled: false,
    scl: 21,
    sda: 14,
    invertX: false,   // flip tilt/rotation left-right
    invertY: false,   // flip tilt/rotation up-down
    swapXY: false,    // exchange X and Y (chip mounted rotated 90 degrees)
  },
};
// ============================================================================

// ==== OFFLINE GAME INDEX =====================================================
// Only this small list is parsed at boot. Every game is a separate module and
// is imported only when selected. Stable paths also prevent duplicate module
// instances from accumulating when a game is launched repeatedly.
const GAME_LIST: { id: string; name: string; color: number[] }[] = [{"id":"snake","name":"SNAKE","color":[0,255,0]},{"id":"flap","name":"FLAP","color":[255,220,0]},{"id":"dino","name":"DINO","color":[80,255,100]},{"id":"ski","name":"SKI","color":[80,180,255]},{"id":"dash","name":"DASH","color":[0,220,255]},{"id":"simon","name":"SIMON","color":[255,220,0]},{"id":"tetris","name":"TETRIS","color":[0,200,255]},{"id":"astro","name":"ASTRO","color":[180,80,255]},{"id":"break","name":"BREAK","color":[255,100,0]},{"id":"pong","name":"PONG","color":[0,200,255]},{"id":"race","name":"RACE","color":[200,0,255]},{"id":"stack","name":"STACK","color":[0,255,150]},{"id":"shoot","name":"SHOOT","color":[255,0,120]},{"id":"maze","name":"MAZE","color":[0,180,255]},{"id":"catch","name":"CATCH","color":[0,255,150]},{"id":"cross","name":"CROSS","color":[100,230,80]},{"id":"2048","name":"2048","color":[255,180,0]},{"id":"beat","name":"BEAT","color":[255,0,180]}];

type GameModule = { default?: (api: any) => Promise<void>; run?: (api: any) => Promise<void> };
const GAME_LOADERS: Record<string, () => Promise<GameModule>> = {
  "snake": () => import("./games/snake.js"),
  "flap": () => import("./games/flap.js"),
  "dino": () => import("./games/dino.js"),
  "ski": () => import("./games/ski.js"),
  "dash": () => import("./games/dash.js"),
  "simon": () => import("./games/simon.js"),
  "tetris": () => import("./games/tetris.js"),
  "astro": () => import("./games/astro.js"),
  "break": () => import("./games/break.js"),
  "pong": () => import("./games/pong.js"),
  "race": () => import("./games/race.js"),
  "stack": () => import("./games/stack.js"),
  "shoot": () => import("./games/shoot.js"),
  "maze": () => import("./games/maze.js"),
  "catch": () => import("./games/catch.js"),
  "cross": () => import("./games/cross.js"),
  "2048": () => import("./games/2048.js"),
  "beat": () => import("./games/beat.js"),
};
// =============================================================================

const saturn = createSaturn();
const display = saturn.display;

// Saturn's HUB75 display exposes an RGB888 framebuffer. Writing directly to
// that ArrayBuffer avoids thousands of JS -> native setPixel() calls per frame.
// Direct framebuffer writes bypass Display.setPixel(), so we must apply the
// display's configured rotation ourselves. Without this mapping the whole UI
// appears rotated by 90 degrees on Saturn.
const DISPLAY_WIDTH = display.width;
const DISPLAY_HEIGHT = display.height;
const DISPLAY_ROTATION = display.rotation;
const FRAME = new Uint8Array(display.frame);

// Precompute the RGB byte offset for every logical pixel. This restores
// Saturn's normal orientation without adding rotation arithmetic to every
// pixel written by the menu and games.
const PIXEL_BYTE_INDEX = new Int32Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);
for (let y = 0; y < DISPLAY_HEIGHT; y++) {
for (let x = 0; x < DISPLAY_WIDTH; x++) {
let px = x;
let py = y;
if (DISPLAY_ROTATION === 1) {
// Direct framebuffer coordinates need the inverse of Display.setPixel()'s
// configured rotation.
px = DISPLAY_WIDTH - 1 - y;
py = x;
} else if (DISPLAY_ROTATION === -1 || DISPLAY_ROTATION === 3) {
px = y;
py = DISPLAY_HEIGHT - 1 - x;
} else if (DISPLAY_ROTATION === 2 || DISPLAY_ROTATION === -2) {
px = DISPLAY_WIDTH - 1 - x;
py = DISPLAY_HEIGHT - 1 - y;
}

// Rotate the final physical framebuffer position by 180 degrees.
px = DISPLAY_WIDTH - 1 - px;
py = DISPLAY_HEIGHT - 1 - py;

PIXEL_BYTE_INDEX[x + y * DISPLAY_WIDTH] = (px + py * DISPLAY_WIDTH) * 3;
}
}

function writePixelUnchecked(x: number, y: number, color: number) {
const i = PIXEL_BYTE_INDEX[x + y * DISPLAY_WIDTH];
FRAME[i] = (color >> 16) & 0xff;
FRAME[i + 1] = (color >> 8) & 0xff;
FRAME[i + 2] = color & 0xff;
}

// --- PIEZO / BUZZER setup ---------------------------------------------------
// `Effects` is just a bag of song ids (no hardware) so it is always available.
// `piezo` is a real driver when a buzzer is fitted and CONFIG.piezo.enabled, or
// a harmless stub otherwise, so games can call piezo.playSong(...) either way.
const piezoStub: any = { playSong() {}, playNote() {}, stop() {}, tone() {} };
let piezo: any = piezoStub;
if (CONFIG.piezo.enabled) {
  try {
    const V: any = Volume;
    const vol = (CONFIG.piezo.volume in V) ? V[CONFIG.piezo.volume] : V.MID;
    piezo = new PIEZO(CONFIG.piezo.pin, vol);
    console.log("PIEZO OK");
  } catch (e) {
    piezo = piezoStub;
    console.log("PIEZO init failed: " + e);
  }
}

// --- GYRO / ACCELEROMETER setup ---------------------------------------------
// When enabled and detected, `mpu` exposes getAcceleration() and getRotation(),
// each returning an [x, y, z] array with the configured orientation applied.
// When disabled or not found, `mpu` is null and gyro games show "NO GRO".
let mpu: any = null;
if (CONFIG.gyro.enabled) {
  try {
    I2C1.setup({ scl: CONFIG.gyro.scl, sda: CONFIG.gyro.sda });
    const dev: any = new MPU6050(I2C1);
    const g = CONFIG.gyro;
    // Apply the configured mounting orientation. Accepts either an [x,y,z]
    // array or an {x,y,z} object and always returns an array games can destructure.
    const orient = (v: any): number[] => {
      const a = Array.isArray(v)
        ? v.slice()
        : [v && v.x || 0, v && v.y || 0, v && v.z || 0];
      let x = a[0] || 0;
      let y = a[1] || 0;
      if (g.swapXY) { const t = x; x = y; y = t; }
      if (g.invertX) x = -x;
      if (g.invertY) y = -y;
      a[0] = x; a[1] = y;
      return a;
    };
    mpu = {
      raw: dev,
      getAcceleration(): number[] { return orient(dev.getAcceleration()); },
      getRotation(): number[] {
        // Not every driver build exposes gyro rates; fall back to zeros.
        try { if (typeof dev.getRotation === "function") return orient(dev.getRotation()); } catch (e) {}
        return [0, 0, 0];
      },
    };
    console.log("MPU6050 OK");
  } catch (e) {
    mpu = null;
    console.log("MPU6050 not found: " + e);
  }
}

function setPx(x: number, y: number, color: any) {
x = Math.round(x);
y = Math.round(y);
if (x < 0 || x >= DISPLAY_WIDTH || y < 0 || y >= DISPLAY_HEIGHT) return;
writePixelUnchecked(x, y, color as number);
}
// Resolve a pin handle from a Pmod object and a "PinN" name string.
function pin(pmod: any, name: string): any { return pmod[name]; }

// Analog input pins, resolved once from CONFIG. Null means "not fitted".
const JOY_X_PIN = CONFIG.joystick.enabled ? pin(CONFIG.joystick.pmod, CONFIG.joystick.xPin) : null;
const JOY_Y_PIN = CONFIG.joystick.enabled ? pin(CONFIG.joystick.pmod, CONFIG.joystick.yPin) : null;
const SLIDER_PIN = CONFIG.slider.enabled ? CONFIG.slider.pin : null;

// Only configure the ADC channels that are actually present.
if (JOY_X_PIN != null) adc.configure(JOY_X_PIN);
if (JOY_Y_PIN != null) adc.configure(JOY_Y_PIN);
if (SLIDER_PIN != null) adc.configure(SLIDER_PIN);

type Dir = "up" | "down" | "left" | "right";
const held: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
const lastAcceptedPress: Record<Dir, number> = { up: 0, down: 0, left: 0, right: 0 };
let dpadHandler: (d: Dir) => void = () => {};
let exitRequested = false;
let exitComboEnabled = false;
function makeBtn(pinHandle: any, dir: Dir): Button {
const b = new Button(pinHandle);
b.on("press", () => {
const now = Date.now();
// Button already has 30 ms GPIO debounce. This extra state guard prevents a
// duplicate logical press from reaching the menu before a real release.
if (held[dir] || now - lastAcceptedPress[dir] < 70) return;
held[dir] = true;
lastAcceptedPress[dir] = now;
if (exitComboEnabled && held.left && held.right) exitRequested = true;
dpadHandler(dir);
});
b.on("release", () => { held[dir] = false; });
return b;
}
// Build the D-pad from the configured pin -> direction mapping.
if (CONFIG.dpad.enabled) {
const dp = CONFIG.dpad;
makeBtn(pin(dp.pmod, dp.pins.up), "up");
makeBtn(pin(dp.pmod, dp.pins.down), "down");
makeBtn(pin(dp.pmod, dp.pins.left), "left");
makeBtn(pin(dp.pmod, dp.pins.right), "right");
}
let joyClickHandler: () => void = () => { dpadHandler("right"); };
const defaultJoyClick = () => { dpadHandler("right"); };
if (CONFIG.joystick.enabled) {
const joyBtn = new Button(pin(CONFIG.joystick.pmod, CONFIG.joystick.clickPin));
joyBtn.on("press", () => joyClickHandler());
}
// Read one analog axis, centred to -1..1, with optional inversion.
function readAxis(pinHandle: any, invert: boolean): number {
if (pinHandle == null) return 0;
let v = (adc.read(pinHandle) - 511.5) / 511.5;
return invert ? -v : v;
}
function joyX(): number {
if (!CONFIG.joystick.enabled) return 0;
const j = CONFIG.joystick;
// swapXY makes the physical Y wire drive logical X (and vice versa).
const v = j.swapXY ? readAxis(JOY_Y_PIN, j.invertY) : readAxis(JOY_X_PIN, j.invertX);
return Math.abs(v) < j.deadzone ? 0 : v;
}
function joyY(): number {
if (!CONFIG.joystick.enabled) return 0;
const j = CONFIG.joystick;
const v = j.swapXY ? readAxis(JOY_X_PIN, j.invertX) : readAxis(JOY_Y_PIN, j.invertY);
return Math.abs(v) < j.deadzone ? 0 : v;
}
// Normalize the physical slider to 0..1. CONFIG.slider.invert flips which end
// reads as 0 vs 1. Returns 0 when no slider is fitted.
function sliderPos(): number {
if (!CONFIG.slider.enabled || SLIDER_PIN == null) return 0;
let v = adc.read(SLIDER_PIN) / 1023;
if (v < 0) v = 0;
if (v > 1) v = 1;
return CONFIG.slider.invert ? 1 - v : v;
}
function makeHControl(startX: number, minX: number, maxX: number, speed: number) {
let x = startX;
let owner = "none";
let lastS = sliderPos();
return { update(): number {
const s = sliderPos();
if (s >= 0 && Math.abs(s - lastS) > 0.03) owner = "slider";
lastS = s;
const jx = joyX();
if (jx !== 0) owner = "joy";
if (held.left || held.right) owner = "dpad";
if (owner === "slider" && s >= 0) x = minX + s * (maxX - minX);
else if (owner === "joy") x += jx * speed * 1.2;
else if (owner === "dpad") { if (held.left) x -= speed; if (held.right) x += speed; }
if (x < minX) x = minX;
if (x > maxX) x = maxX;
return x;
} };
}
const FONT: Record<string, number[]> = {
"A":[2,5,7,5,5],"B":[6,5,6,5,6],"C":[7,4,4,4,7],"D":[6,5,5,5,6],"E":[7,4,7,4,7],"F":[7,4,7,4,4],
"G":[7,4,5,5,7],"H":[5,5,7,5,5],"I":[7,2,2,2,7],"J":[1,1,1,5,7],"K":[5,5,6,5,5],"L":[4,4,4,4,7],
"M":[5,7,7,5,5],"N":[7,5,5,5,5],"O":[7,5,5,5,7],"P":[7,5,7,4,4],"Q":[7,5,5,7,1],"R":[7,5,6,5,5],
"S":[7,4,7,1,7],"T":[7,2,2,2,2],"U":[5,5,5,5,7],"V":[5,5,5,5,2],"W":[5,5,7,7,5],"X":[5,5,2,5,5],
"Y":[5,5,2,2,2],"Z":[7,1,2,4,7],
"0":[7,5,5,5,7],"1":[2,6,2,2,7],"2":[7,1,7,4,7],"3":[7,1,7,1,7],"4":[5,5,7,1,1],
"5":[7,4,7,1,7],"6":[7,4,7,5,7],"7":[7,1,2,2,2],"8":[7,5,7,5,7],"9":[7,5,7,1,7],
" ":[0,0,0,0,0],"-":[0,0,7,0,0],"_":[0,0,0,0,7],".":[0,0,0,0,2],":":[0,2,0,2,0],"!":[2,2,2,0,2],
"?":[7,1,3,0,2],"+":[0,2,7,2,0],"/":[1,1,2,4,4],"=":[0,7,0,7,0],"(":[1,2,2,2,1],")":[4,2,2,2,4]
};
function drawText(x: number, y: number, text: string, color: any) {
const c = color as number;
const r = (c >> 16) & 0xff;
const green = (c >> 8) & 0xff;
const b = c & 0xff;
for (let charIndex = 0; charIndex < text.length; charIndex++) {
const glyph = FONT[text[charIndex].toUpperCase()] || FONT["?"];
if (!glyph) continue;
const baseX = Math.round(x + charIndex * 4);
const baseY = Math.round(y);
for (let row = 0; row < 5; row++) {
const py = baseY + row;
if (py < 0 || py >= DISPLAY_HEIGHT) continue;
for (let col = 0; col < 3; col++) {
if (!(glyph[row] & (1 << (2 - col)))) continue;
const px = baseX + col;
if (px < 0 || px >= DISPLAY_WIDTH) continue;
const frameIndex = PIXEL_BYTE_INDEX[px + py * DISPLAY_WIDTH];
FRAME[frameIndex] = r;
FRAME[frameIndex + 1] = green;
FRAME[frameIndex + 2] = b;
}
}
}
}
function drawRect(x: number, y: number, w: number, h: number, color: any) {
let x0 = Math.max(0, Math.ceil(x));
let y0 = Math.max(0, Math.ceil(y));
let x1 = Math.min(DISPLAY_WIDTH, Math.ceil(x + w));
let y1 = Math.min(DISPLAY_HEIGHT, Math.ceil(y + h));
const c = color as number;
const r = (c >> 16) & 0xff;
const g = (c >> 8) & 0xff;
const b = c & 0xff;
for (let py = y0; py < y1; py++) {
const logicalRow = py * DISPLAY_WIDTH;
for (let px = x0; px < x1; px++) {
const i = PIXEL_BYTE_INDEX[logicalRow + px];
FRAME[i] = r;
FRAME[i + 1] = g;
FRAME[i + 2] = b;
}
}
}

// A capped fixed-step scheduler. Unlike the official GameLoop, which runs an
// unbounded setInterval(..., 0) and redraws every tick, this lets the menu poll
// input predictably without continuously flooding the display.
async function waitForNextTick(nextTick: number, stepMs: number): Promise<number> {
nextTick += stepMs;
const wait = nextTick - Date.now();
if (wait > 0) await sleep(wait);
else {
// Yield once if work overran, then reset the schedule so lag cannot accumulate.
await sleep(0);
nextTick = Date.now();
}
return nextTick;
}
async function flashScreen(color: any, times: number) {
for (let i = 0; i < times; i++) { display.fill(color); display.show(); await sleep(70); display.clear(); display.show(); await sleep(60); }
}
async function explode(x: number, y: number) {
const cols = [colors.white, colors.yellow, colors.rgb(255,100,0), colors.rgb(120,30,0)];
for (let r = 1; r <= 4; r++) {
setPx(x-r,y,cols[r-1]); setPx(x+r,y,cols[r-1]); setPx(x,y-r,cols[r-1]); setPx(x,y+r,cols[r-1]);
setPx(x-r+1,y-r+1,cols[r-1]); setPx(x+r-1,y-r+1,cols[r-1]); setPx(x-r+1,y+r-1,cols[r-1]); setPx(x+r-1,y+r-1,cols[r-1]);
display.show(); await sleep(60);
}
}
let gameIndex = 0;
let curGameName = "";
let scoreSubmitted = false;
let lastScore = -1;

// Menu built from the embedded game list. Best scores live in memory only.
let games: { id: string; name: string; color: number[] }[] = [];
const bests: Record<string, number> = {};

function initGames() {
games = GAME_LIST.map(g => ({ id: g.id, name: g.name, color: g.color.slice() }));
}
function scoreKey(game: string): string { return game.toUpperCase().slice(0, 5); }
function bestForGame(game: string): number { return bests[scoreKey(game)] || 0; }
function submitScore(game: string, score: number): number {
const key = scoreKey(game);
const best = Math.max(bests[key] || 0, score);
bests[key] = best;
return best;
}

async function gameOverScreen(score: number) {
lastScore = score;
scoreSubmitted = false;
piezo.playSong(Effects.lose);
for (let f = 0; f < 6; f++) {
display.clear();
const c = f % 2 === 0 ? colors.red : colors.rgb(60,0,0);
drawText(14,14,"GAME",c); drawText(14,22,"OVER",c);
display.show(); await sleep(160);
}
const best = submitScore(curGameName, score);
scoreSubmitted = true;
display.clear();
drawText(14,6,"GAME",colors.red); drawText(14,14,"OVER",colors.red);
drawText(4,30,"SCORE",colors.yellow);
const s = String(score);
drawText(62 - s.length * 4,30,s,colors.white);
drawText(4,42,"BEST",colors.rgb(0,200,255));
const b = String(best);
drawText(62 - b.length * 4,42,b,best === score ? colors.green : colors.white);
display.show();
let pressed = false;
dpadHandler = () => { pressed = true; };
joyClickHandler = () => { pressed = true; };
while (!pressed && !exitRequested) await sleep(30);
}

function drawGameLoading(name: string) {
display.clear();
drawText(6, 20, "LOAD", colors.rgb(0,200,255));
drawText(Math.max(1, Math.floor((64 - name.length * 4) / 2)), 29, name.slice(0, 14), colors.white);
drawRect(6, 40, 52, 4, colors.rgb(40,40,40));
drawRect(6, 40, 52, 4, colors.green);
display.show();
}

const gameApi = {
display, colors, piezo, Effects, mpu,
setPx, drawText, drawRect, sleep,
flashScreen, explode, makeHControl,
joyX, joyY, sliderPos, held,
gameOverScreen,
get exitRequested() { return exitRequested; },
set dpadHandler(fn: any) { dpadHandler = fn; },
set joyClickHandler(fn: any) { joyClickHandler = fn; },
};
const MENU_VISIBLE = 5;
const MENU_TITLE_COLOR = colors.rgb(90,180,255);
const MENU_DIM_TEXT = colors.rgb(150,150,150);
const MENU_SCROLL_COLOR = colors.rgb(90,90,90);

// The old menu continuously redrew the complete display every 60 ms even when
// nothing changed. On this small device display.show() and hundreds of JS-to-
// native pixel calls are the expensive part. This version only draws when the
// selected item changes, when entering the menu, or for the short select flash.
function drawMenuFrame(sel: number, top: number, flash = false) {
display.clear();
const n = games.length;
const gameCountText = n > 99 ? "99+" : String(n);
drawText(2,2,"GAMES",MENU_TITLE_COLOR);
drawText(25,2,gameCountText,colors.green);
for (let row = 0; row < MENU_VISIBLE; row++) {
const gi = top + row;
if (gi < 0 || gi >= n) continue;
const y = 11 + row * 10;
const isSel = gi === sel;
const g = games[gi];
drawRect(8, y, 7, 7, colors.rgb(g.color[0], g.color[1], g.color[2]));
drawText(20, y+1, g.name, isSel ? (flash ? colors.yellow : colors.white) : MENU_DIM_TEXT);
}
const selectedRow = sel - top;
const hy = 11 + selectedRow * 10;
setPx(2,hy+3,colors.white); setPx(3,hy+2,colors.white); setPx(3,hy+3,colors.white);
setPx(3,hy+4,colors.white); setPx(4,hy+3,colors.white);
if (n > 1) {
const barY = 11 + Math.floor((sel/(n-1))*42);
for (let j = 0; j < 6; j++) setPx(63, barY+j, MENU_SCROLL_COLOR);
}
display.show();
}
async function bestScreen() {
display.clear(); drawText(20,24,"SCORES",colors.rgb(0,200,255)); display.show();
piezo.playSong(Effects.menuSelect);
await sleep(250);
display.clear(); drawText(14,0,"BEST",colors.yellow);
const rows = games
.map(g => ({ name: g.name, score: bests[scoreKey(g.name)] || 0 }))
.filter(r => r.score > 0)
.sort((a, b) => b.score - a.score);
if (rows.length === 0) drawText(10,24,"NO DATA",colors.rgb(120,120,120));
for (let i = 0; i < rows.length && i < 9; i++) {
const e = rows[i]; const y = 8 + i*6;
drawText(1,y,e.name.slice(0,7),colors.rgb(0,200,255));
drawText(40,y,String(e.score).slice(0,5),colors.white);
}
display.show();
let out = false;
dpadHandler = () => { out = true; }; joyClickHandler = () => { out = true; };
while (!out && !exitRequested) await sleep(30);
exitRequested = false;
}
async function runMenu(): Promise<number> {
exitComboEnabled = false;
const n = games.length;
let sel = Math.max(0, Math.min(gameIndex, n - 1));
let top = Math.max(0, Math.min(sel - 2, Math.max(0, n - MENU_VISIBLE)));
let chosen = -1;
let btnDir = 0;
let btnHeldSince = 0;
let lastBtnMove = 0;
let holdAllSince = 0;
let holdUDSince = 0;
let dirty = true;
let joyArmed = false;
let joyBlockedUntil = 0;
let nextTick = Date.now();
exitRequested = false;

// Do not carry a held exit/menu button into the new menu. This also prevents
// the release after leaving a game from being interpreted as menu navigation.
dpadHandler = () => {};
joyClickHandler = () => {};
const releaseDeadline = Date.now() + 600;
while ((held.up || held.down || held.left || held.right) && Date.now() < releaseDeadline) {
await sleep(10);
}

const ensureVisible = () => {
if (sel < top) top = sel;
if (sel >= top + MENU_VISIBLE) top = sel - MENU_VISIBLE + 1;
if (top < 0) top = 0;
const maxTop = Math.max(0, n - MENU_VISIBLE);
if (top > maxTop) top = maxTop;
};
const move = (d: number) => {
const next = (sel + d + n) % n;
if (next !== sel) {
sel = next;
ensureVisible();
dirty = true;
piezo.playSong(Effects.menuMove);
}
};
const menuDpad = (d: Dir) => {
const now = Date.now();
// A D-pad press owns vertical navigation for a short window. Without this,
// the same action could be followed by one joystick-poll movement in the loop.
joyBlockedUntil = now + 280;
joyArmed = false;
if (d === "up" && !held.down) {
move(-1);
btnDir = -1;
btnHeldSince = now;
lastBtnMove = now;
} else if (d === "down" && !held.up) {
move(1);
btnDir = 1;
btnHeldSince = now;
lastBtnMove = now;
} else if (d === "right" && !held.up && !held.down && !held.left) {
chosen = sel;
}
};
const setMenuHandlers = () => {
dpadHandler = menuDpad;
joyClickHandler = () => { chosen = sel; };
};
setMenuHandlers();

while (chosen < 0) {
const now = Date.now();
const all = held.up && held.down && held.left && held.right;
const ud = held.up && held.down && !held.left && !held.right;

if (all) {
if (holdAllSince === 0) holdAllSince = now;
holdUDSince = 0;
if (now - holdAllSince >= 450) {
dpadHandler = () => {};
joyClickHandler = defaultJoyClick;
while (held.up || held.down || held.left || held.right) await sleep(20);
return -1;
}
} else {
holdAllSince = 0;
if (ud) {
if (holdUDSince === 0) holdUDSince = now;
if (now - holdUDSince >= 450) {
holdUDSince = 0;
exitRequested = false;
await bestScreen();
while (held.up || held.down) await sleep(20);
exitRequested = false;
setMenuHandlers();
joyArmed = false;
joyBlockedUntil = Date.now() + 280;
dirty = true;
nextTick = Date.now();
continue;
}
} else holdUDSince = 0;
}

// Button auto-repeat starts only after a deliberate long hold. A normal tap is
// handled exactly once by menuDpad above.
const nextBtnDir = held.up && !held.down ? -1 : held.down && !held.up ? 1 : 0;
if (nextBtnDir === 0) {
btnDir = 0;
} else if (btnDir !== nextBtnDir) {
btnDir = nextBtnDir;
btnHeldSince = now;
lastBtnMove = now;
} else if (now - btnHeldSince >= 500 && now - lastBtnMove >= 180) {
move(btnDir);
lastBtnMove = now;
}

// Joystick navigation is edge-triggered: one movement per tilt, then it must
// return near the centre before another movement can happen. D-pad activity
// temporarily blocks this path so one physical button press cannot move twice.
const jy = joyY();
if (Math.abs(jy) < 0.30) {
joyArmed = true;
} else if (
joyArmed &&
now >= joyBlockedUntil &&
!held.up && !held.down &&
Math.abs(jy) > 0.68
) {
move(jy > 0 ? 1 : -1);
joyArmed = false;
}

if (dirty) {
drawMenuFrame(sel, top, false);
dirty = false;
}

// 50 Hz input loop, but display output is still only sent when dirty.
nextTick = await waitForNextTick(nextTick, 20);
}

piezo.playSong(Effects.menuSelect);
drawMenuFrame(sel, top, true);
await sleep(45);
drawMenuFrame(sel, top, false);
await sleep(35);
dpadHandler = () => {};
joyClickHandler = defaultJoyClick;
return chosen;
}
function textX(text: string) {
return Math.floor((65 - text.length * 4) / 2);
}
function drawBoot(status: string, frame: number, progress = -1, reveal = 8, statusColor: any = colors.rgb(0,200,255)) {
display.clear();
for (let i = 0; i < 9; i++) {
const x = (frame * 2 + i * 11) % 68 - 2;
const y = 8 + ((i * 13 + frame) % 48);
setPx(x, y, colors.rgb(0, 20 + (i % 3) * 12, 35 + (i % 4) * 15));
}
const logo = "ROBODECK";
const c = colors.rgb(80 + Math.floor(80 * (Math.sin(frame * 0.22) + 1)), 150 + Math.floor(50 * (Math.sin(frame * 0.18 + 1) + 1)), 255);
for (let i = 0; i < reveal; i++) drawText(textX(logo) + i * 4, 18, logo[i], c);
if (status) {
drawText(textX(status), 36, status, statusColor);
const dots = frame % 12;
for (let i = 0; i < 3; i++) if (dots >= i * 3) setPx(28 + i * 4, 45, statusColor);
}
if (progress >= 0) {
drawRect(6, 52, 52, 3, colors.rgb(20,30,40));
drawRect(6, 52, Math.floor(52 * progress), 3, colors.rgb(0,220,140));
}
for (let i = 0; i < 8; i++) setPx((frame * 3 + i) % 64, 61, colors.rgb(30,100,160));
display.show();
}
async function bootScreen(msg: string, color: any) {
drawBoot(msg, 0, -1, 8, color);
}
function bootSound(effect: any) {
try { piezo.playSong(effect); } catch (e) {}
}
async function bootLocal() {
bootSound(Effects.menuSelect);
for (let f = 0; f < 30; f++) {
if (f % 6 === 0) bootSound(Effects.menuMove);
drawBoot("", f, -1, Math.min(8, Math.floor(f / 3) + 1));
await sleep(45);
}
let frame = 30;
bootSound(Effects.menuMove);
drawBoot("LOADING", frame++, 0.2); await sleep(120);
initGames();
drawBoot("LOADING", frame++, 0.7); await sleep(120);
bootSound(Effects.menuSelect);
for (let f = 0; f < 8; f++) {
if (f === 3) bootSound(Effects.menuMove);
drawBoot("READY", frame++, 1);
await sleep(55);
}
bootSound(Effects.menuSelect);
}

console.log("Robodeck OFFLINE split build started! " + GAME_LIST.length + " games available.");
initGames();
await bootLocal();
while (true) {
if (games.length === 0) { initGames(); await sleep(200); continue; }
const choice = await runMenu();
if (choice < 0) {
exitRequested = false;
await bootLocal();
continue;
}
gameIndex = choice;
const g = games[choice];
curGameName = g.name;
exitRequested = false;
lastScore = -1;
scoreSubmitted = false;
exitComboEnabled = true;
const loadGame = GAME_LOADERS[g.id];
if (!loadGame) {
await bootScreen("NO GAME", colors.red);
piezo.playSong(Effects.error);
await sleep(1500);
exitComboEnabled = false;
continue;
}
try {
drawGameLoading(g.name);
console.log("loading offline module " + g.id);
const mod = await loadGame();
const run = mod.default || mod.run;
if (typeof run !== "function") throw new Error("game has no default/run export");
await run(gameApi);
} catch (e) {
console.log("game error: " + e);
await bootScreen("CRASH", colors.red);
await sleep(1500);
}
exitComboEnabled = false;
dpadHandler = () => {}; joyClickHandler = defaultJoyClick;
exitRequested = false;
if (lastScore >= 0 && !scoreSubmitted) {
submitScore(g.name, lastScore);
scoreSubmitted = true;
}
await sleep(200);
}