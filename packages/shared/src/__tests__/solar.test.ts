/**
 * The shared weather and solar model (moved from the simulator in P2-10 so the PV forecast uses
 * exactly what the simulator does), plus array geometry.
 */
import { describe, expect, it } from 'vitest'
import {
  PV_SYSTEM_FACTOR,
  arrayFactor,
  clearSkyGhi,
  cloudFromCover,
  createRng,
  gaussian,
  hashRandom,
  pvKw,
  sunElevationDeg,
  sunPosition,
  weatherAt,
} from '../index'

const TO = { lat: 43.65, lon: -79.38 }
const at = (iso: string) => new Date(iso)

describe('random', () => {
  it('repeats for the same seed and key, and stays in [0, 1)', () => {
    const a = createRng(7)
    const b = createRng(7)
    const draws = Array.from({ length: 1000 }, () => a())
    expect(Array.from({ length: 1000 }, () => b())).toEqual(draws)
    expect(draws.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(hashRandom(42, 'cloud:2026-09-24')).toBe(hashRandom(42, 'cloud:2026-09-24'))
    expect(hashRandom(42, 'cloud:2026-09-24')).not.toBe(hashRandom(43, 'cloud:2026-09-24'))
  })

  it('draws standard normals', () => {
    const rng = createRng(1)
    const xs = Array.from({ length: 20000 }, () => gaussian(rng))
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(sd).toBeCloseTo(1, 1)
    expect(Number.isFinite(gaussian(() => 0))).toBe(true)
  })
})

describe('sun position', () => {
  it('is due south and highest at solar noon, east in the morning, west in the afternoon', () => {
    // Toronto solar noon on 24 Sep is about 17:10 UTC
    const noon = sunPosition(at('2026-09-24T17:10:00Z'), TO.lat, TO.lon)
    expect(noon.elevationDeg).toBeCloseTo(90 - TO.lat - 0.5, 0) // declination ≈ −0.5° just after the equinox
    expect(noon.azimuthDeg).toBeGreaterThan(175)
    expect(noon.azimuthDeg).toBeLessThan(185)
    expect(sunPosition(at('2026-09-24T13:00:00Z'), TO.lat, TO.lon).azimuthDeg).toBeLessThan(130)
    expect(sunPosition(at('2026-09-24T21:00:00Z'), TO.lat, TO.lon).azimuthDeg).toBeGreaterThan(230)
    expect(sunElevationDeg(at('2026-09-25T04:00:00Z'), TO.lat, TO.lon)).toBeLessThan(0)
  })

  it('gives clear-sky irradiance by day and none at night', () => {
    expect(clearSkyGhi(-5)).toBe(0)
    expect(clearSkyGhi(46)).toBeGreaterThan(700)
    expect(clearSkyGhi(46)).toBeLessThan(800)
    expect(pvKw(48, 750, 1)).toBeCloseTo((48 * 750 * PV_SYSTEM_FACTOR) / 1000)
  })
})

describe('array geometry', () => {
  const noonDec = at('2026-12-21T17:15:00Z')
  const noonJun = at('2026-06-21T17:15:00Z')

  it('is 1 for the reference array (10° south), so the simulator keeps its calibration', () => {
    expect(arrayFactor(at('2026-09-24T17:10:00Z'), TO.lat, TO.lon, 10, 180)).toBeCloseTo(1, 9)
  })

  it('favours steep south arrays in winter and flat ones in summer, and faces the sun', () => {
    expect(arrayFactor(noonDec, TO.lat, TO.lon, 40, 180)).toBeGreaterThan(1.3)
    expect(arrayFactor(noonJun, TO.lat, TO.lon, 40, 180)).toBeLessThan(1)
    expect(arrayFactor(noonDec, TO.lat, TO.lon, 30, 0)).toBeLessThan(0.5) // north-facing
    expect(arrayFactor(at('2026-09-24T13:30:00Z'), TO.lat, TO.lon, 30, 90)).toBeGreaterThan(arrayFactor(at('2026-09-24T13:30:00Z'), TO.lat, TO.lon, 30, 270))
  })

  it('is 0 at night', () => {
    expect(arrayFactor(at('2026-09-25T04:00:00Z'), TO.lat, TO.lon, 30, 180)).toBe(0)
  })
})

describe('weather', () => {
  it('repeats per seed and day, within the profile’s ranges', () => {
    const w = weatherAt(at('2026-09-24T19:00:00Z'), 'America/Toronto', 42)
    expect(weatherAt(at('2026-09-24T19:00:00Z'), 'America/Toronto', 42)).toEqual(w)
    for (let d = 1; d <= 60; d++) {
      const x = weatherAt(new Date(Date.parse('2026-01-01T17:00:00Z') + d * 86_400_000), 'America/Toronto', 42)
      expect(x.cloud).toBeGreaterThanOrEqual(0.15)
      expect(x.cloud).toBeLessThanOrEqual(1)
      expect(x.tempC).toBeGreaterThan(-20)
      expect(x.tempC).toBeLessThan(10)
    }
  })

  it('turns cloud cover into the share of sunshine that gets through', () => {
    expect(cloudFromCover(0)).toBe(1)
    expect(cloudFromCover(100)).toBeCloseTo(0.25)
    expect(cloudFromCover(50)).toBeCloseTo(1 - 0.75 * 0.5 ** 3.4)
    expect(cloudFromCover(-10)).toBe(1)
    expect(cloudFromCover(150)).toBeCloseTo(0.25)
  })
})

describe('thunderstorm warnings', () => {
  const TZ = 'America/Toronto'
  const dayAt = (date: string, hourLocal: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (hourLocal + 4) * 3_600_000) // EDT

  it('come on about one summer day in 25, from 15:00 to 19:00', () => {
    const days = Array.from({ length: 200 }, (_, i) => new Date(Date.parse('2026-04-01T12:00:00Z') + i * 86_400_000).toISOString().slice(0, 10))
    const stormy = days.filter((d) => weatherAt(dayAt(d, 16), TZ, 42).storm)
    expect(stormy.length).toBeGreaterThan(2)
    expect(stormy.length).toBeLessThan(20)
    const d = stormy[0]
    expect([12, 14, 15, 18, 19].map((h) => weatherAt(dayAt(d, h), TZ, 42).storm)).toEqual([false, false, true, true, false])
  })

  it('never come in winter', () => {
    const winter = Array.from({ length: 90 }, (_, i) => new Date(Date.parse('2026-11-01T21:00:00Z') + i * 86_400_000))
    expect(winter.some((at) => weatherAt(at, TZ, 42).storm)).toBe(false)
  })
})
