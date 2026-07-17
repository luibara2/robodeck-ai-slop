declare module "saturn" {
  export const SaturnPins: any;
  export function createSaturn(...args: any[]): any;
}
declare module "colors" {
  export const white: any; export const yellow: any; export const red: any;
  export const green: any; export const blue: any;
  export function rgb(r: number, g: number, b: number): any;
}
declare module "button" {
  export class Button { constructor(pin: any); on(event: string, cb: (...args: any[]) => void): void; }
}
declare module "adc" {
  export function configure(pin: any): void;
  export function read(pin: any): number;
}
declare module "piezo" {
  export const Effects: Record<string, any>;
  export const Volume: Record<string, any>;
  export class PIEZO {
    constructor(pin: any, volume?: any);
    playSong(effect: any): void;
    playNote(...args: any[]): void;
    stop(): void;
    tone(...args: any[]): void;
  }
}
declare module "mpu6050" {
  export class MPU6050 {
    constructor(i2c: any);
    getAcceleration(): number[];
    getRotation?(): number[];
  }
}

// Saturn runtime globals (injected by the host, not imported).
declare function sleep(ms: number): Promise<void>;
