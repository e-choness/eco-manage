// Simulated time runs `speed` times faster than wall-clock time (1×–60×, spec §7).

export const MIN_SPEED = 1;
export const MAX_SPEED = 60;

export class SimClock {
  private realAnchor: number;
  private simAnchor: number;
  private speedValue: number;

  constructor(simStart: Date, speed = 1, realNow = Date.now()) {
    this.speedValue = SimClock.check(speed);
    this.realAnchor = realNow;
    this.simAnchor = simStart.getTime();
  }

  static check(speed: number): number {
    if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
      throw new RangeError(`speed must be between ${MIN_SPEED} and ${MAX_SPEED}`);
    }
    return speed;
  }

  get speed(): number {
    return this.speedValue;
  }

  now(realNow = Date.now()): Date {
    return new Date(this.simAnchor + (realNow - this.realAnchor) * this.speedValue);
  }

  /** Changes speed without a jump in simulated time. */
  setSpeed(speed: number, realNow = Date.now()): void {
    const check = SimClock.check(speed);
    this.simAnchor = this.now(realNow).getTime();
    this.realAnchor = realNow;
    this.speedValue = check;
  }
}
