/**
 * P2-10: PV and load forecasts, the weather sources, and day-ahead accuracy (MAPE).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Calendar, Device, Forecast, Interval15, Site, initModels } from '@ecomanage/db'
import { DEMO_CALENDAR_INPUT, DEMO_DEVICES, DEMO_SITE, siteDateStart } from '@ecomanage/shared'
import { SiteEngine } from '@ecomanage/simulator/engine'
import { HORIZON_STEPS, dayClassOf, degreesOutside, horizon, loadForecast, mape, pvForecast, type LoadSlot } from '../forecast/models'
import { forecastSite, scoreForecasts } from '../forecast/run'
import { openMeteoWeather, simulatedWeather, type WeatherPoint } from '../forecast/weather'

const TZ = 'America/Toronto'
const LOC = { lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, tz: TZ }
const u = (iso: string) => new Date(iso)
const inverters = DEMO_DEVICES.filter((d) => d.type === 'pv')
const demoArrays = inverters.map((d) => ({ inverterId: d.id, kwp: d.kwp!, tiltDeg: 10, azimuthDeg: 180 }))
const ratings = new Map(inverters.map((d) => [d.id, d.ratedKw]))

describe('horizon', () => {
  it('is 48 h of 15-minute steps from the next boundary', () => {
    const h = horizon(u('2026-09-24T16:07:30Z'))
    expect(h).toHaveLength(HORIZON_STEPS)
    expect(h[0]).toEqual(u('2026-09-24T16:15:00Z'))
    expect(h.at(-1)).toEqual(u('2026-09-26T16:00:00Z'))
  })
})

describe('PV forecast', () => {
  it('matches what the simulator produces from the same weather profile', async () => {
    const weather = simulatedWeather(42)
    const instants = ['2026-09-24T14:00:00Z', '2026-09-24T17:00:00Z', '2026-09-24T20:30:00Z', '2026-09-25T16:00:00Z', '2026-09-26T18:00:00Z'].map(u)
    const forecast = pvForecast(DEMO_SITE, demoArrays, ratings, await weather.at(LOC, instants))
    instants.forEach((at, i) => {
      const engine = new SiteEngine({ tz: TZ, lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, seed: 42, devices: DEMO_DEVICES }, at)
      const actual = engine.inverterKw('invA') + engine.inverterKw('invB')
      // The simulator adds ±6% minute-to-minute cloud noise on top of the day's profile.
      expect(Math.abs(forecast[i] - actual) / actual).toBeLessThan(0.07)
    })
  })

  it('is zero at night, capped at the inverter rating, and follows the array geometry', async () => {
    const clear: WeatherPoint[] = [u('2026-09-25T04:00:00Z'), u('2026-06-21T17:15:00Z')].map((ts) => ({ ts, tempC: 20, cloud: 1 }))
    expect(pvForecast(DEMO_SITE, demoArrays, ratings, clear)[0]).toBe(0)
    const big = [{ inverterId: 'x', kwp: 100, tiltDeg: 10, azimuthDeg: 180 }]
    expect(pvForecast(DEMO_SITE, big, new Map([['x', 50]]), clear)[1]).toBe(50)
    const winter: WeatherPoint[] = [{ ts: u('2026-12-21T17:15:00Z'), tempC: -5, cloud: 1 }]
    const flat = pvForecast(DEMO_SITE, [{ inverterId: 'x', kwp: 40, tiltDeg: 10, azimuthDeg: 180 }], new Map(), winter)[0]
    const steep = pvForecast(DEMO_SITE, [{ inverterId: 'x', kwp: 40, tiltDeg: 45, azimuthDeg: 180 }], new Map(), winter)[0]
    expect(steep / flat).toBeGreaterThan(1.3)
  })
})

describe('load forecast', () => {
  // Six weeks of a school: 80 kW from 08:00 to 16:00 on open days, 30 kW otherwise; the load grows
  // 4% per degree outside 13–20 °C. Temperatures swing by day so the sensitivity can be learned.
  const start = siteDateStart('2026-08-13', TZ)
  const calendar = { terms: [{ name: 'Term', start: '2026-08-01', end: '2026-12-18' }], daysOff: [{ name: 'PA day', start: '2026-09-25', end: '2026-09-25' }], weekends: 'closed' as const }
  const tempOn = (ts: Date) => 16 + 10 * Math.sin(ts.getTime() / (3 * 86_400_000))
  const truth = (ts: Date, tempC: number) => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ts)
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(ts))
    const open = dayClassOf(date, calendar) === 'open' && hour >= 8 && hour < 16
    return (open ? 80 : 30) * (1 + 0.04 * degreesOutside(tempC))
  }
  const history: LoadSlot[] = Array.from({ length: 42 * 96 }, (_, i) => {
    const ts = new Date(start.getTime() + i * 15 * 60_000)
    const tempC = tempOn(ts)
    return { ts, tempC, kw: truth(ts, tempC) }
  })

  it('uses the same weekday and calendar class, and learns how load follows temperature', () => {
    const noonThu = u('2026-09-24T16:00:00Z') // Thursday, in term
    const f = loadForecast([{ ts: noonThu, tempC: 26, cloud: 1 }], history, TZ, calendar)
    expect(f.sensitivity).toBeCloseTo(0.04, 2)
    expect(f.kw[0]).toBeCloseTo(truth(noonThu, 26), -1) // within ~5 kW of 80 × 1.24
    expect(f.profiles).toEqual([{ date: '2026-09-24', label: 'Thursday open-day profile', days: 6 }])
  })

  it('treats days off and weekends as closed days', () => {
    const paDay = u('2026-09-25T16:00:00Z') // Friday, PA day
    const saturday = u('2026-09-26T16:00:00Z')
    const f = loadForecast([paDay, saturday].map((ts) => ({ ts, tempC: 16, cloud: 1 })), history, TZ, calendar)
    expect(f.kw[0]).toBeCloseTo(30, -1)
    expect(f.kw[1]).toBeCloseTo(30, -1)
    // No closed Friday in the history (term time): all closed days are used instead
    expect(f.profiles[0]).toEqual({ date: '2026-09-25', label: 'closed-day profile (all weekdays)', days: expect.any(Number) })
  })

  it('without a calendar, weekdays are open and weekends closed', () => {
    expect(dayClassOf('2026-09-25', null)).toBe('open')
    expect(dayClassOf('2026-09-26', null)).toBe('closed')
    expect(dayClassOf('2026-09-25', { terms: [], daysOff: [], weekends: 'closed' })).toBe('open')
  })

  it('has nothing to say without history for that time of day', () => {
    expect(loadForecast([{ ts: u('2026-09-24T16:00:00Z'), tempC: 20, cloud: 1 }], [], TZ, null)).toMatchObject({ kw: [null], sensitivity: 0 })
  })
})

describe('MAPE', () => {
  it('averages the absolute percentage error over the slots worth judging', () => {
    expect(mape([{ forecast: 90, actual: 100 }, { forecast: 55, actual: 50 }, { forecast: 3, actual: 0.2 }], 1)).toEqual({ mape: 10, n: 2 })
    expect(mape([], 1)).toEqual({ mape: null, n: 0 })
  })
})

describe('Open-Meteo', () => {
  it('interpolates hourly temperature and cloud cover to each instant', async () => {
    let url = ''
    const fetchFn = async (u: string) => {
      url = u
      return { ok: true, status: 200, json: async () => ({ hourly: { time: ['2026-09-24T16:00', '2026-09-24T17:00'], temperature_2m: [20, 22], cloud_cover: [0, 100] } }) }
    }
    const w = await openMeteoWeather(fetchFn).at({ lat: 43.65, lon: -79.38, tz: TZ }, [u('2026-09-24T16:30:00Z'), u('2026-09-24T18:00:00Z')])
    expect(url).toContain('latitude=43.65&longitude=-79.38&hourly=temperature_2m,cloud_cover&timezone=UTC')
    expect(w[0]).toMatchObject({ tempC: 21, cloud: expect.closeTo(1 - 0.75 * 0.5 ** 3.4, 6) })
    expect(w[1]).toMatchObject({ tempC: 22, cloud: 0.25 }) // past the last hour: held
    expect(await openMeteoWeather(fetchFn).at({ lat: 0, lon: 0, tz: 'UTC' }, [])).toEqual([])
  })

  it('reports a failed request', async () => {
    const down = async () => ({ ok: false, status: 503, json: async () => ({}) })
    await expect(openMeteoWeather(down).at({ lat: 0, lon: 0, tz: 'UTC' }, [u('2026-09-24T16:00:00Z')])).rejects.toThrow('open-meteo answered 503')
  })
})

// ---- stored forecasts ------------------------------------------------------------------------------

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_worker_forecast`
const siteId = new mongoose.Types.ObjectId()
const NOW = u('2026-09-24T16:05:00Z')

describe('forecastSite and scoring', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    await initModels()
  })

  afterAll(async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  })

  beforeEach(async () => {
    await Promise.all([Site.deleteMany({}), Device.deleteMany({}), Interval15.deleteMany({}), Forecast.deleteMany({}), Calendar.deleteMany({})])
    await Site.create({ _id: siteId, name: 'Maple Grove School', tz: TZ, lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, pvArrays: demoArrays.map((a, i) => ({ id: `a${i}`, name: `Roof ${i}`, ...a })) })
    await Device.create(inverters.map((d) => ({ _id: d.id, siteId, type: 'pv', name: d.name, ratedKw: d.ratedKw, status: 'live' })))
  })

  const intervalsFor = (days: number, kw = 40) =>
    Interval15.insertMany(
      Array.from({ length: days * 96 }, (_, i) => ({ siteId, start: new Date(NOW.getTime() - (days * 96 - i) * 15 * 60_000 - 5 * 60_000), grid: kw / 4, export: 0, pv: 0, batt: 0, demandKw: kw }))
    )

  it('issues 48 h of PV and load, with the weather and the profile used', async () => {
    await intervalsFor(14)
    expect(await forecastSite(String(siteId), simulatedWeather(42), NOW)).toEqual({ siteId: String(siteId), pv: true, load: true })
    const pv = await Forecast.findOne({ kind: 'pv' }).lean()
    const load = await Forecast.findOne({ kind: 'load' }).lean()
    expect(pv).toMatchObject({ issuedAt: NOW, source: 'simulated', accuracy: null })
    expect(pv!.points).toHaveLength(HORIZON_STEPS)
    expect(pv!.weather).toHaveLength(HORIZON_STEPS)
    expect(Math.max(...pv!.points.map((p) => p.kw!))).toBeGreaterThan(5) // two days of daylight, even overcast
    expect(load!.points.length).toBeGreaterThan(HORIZON_STEPS - 8)
    expect(load!.points.every((p) => Math.abs(p.kw! - 40) < 0.01)).toBe(true) // flat history, no temperature effect
    expect(load!.profiles.map((p) => p.date)).toEqual(['2026-09-24', '2026-09-25', '2026-09-26'])
  })

  it('forecasts PV but not load before there are 7 days of history, and nothing without a location', async () => {
    await intervalsFor(3)
    expect(await forecastSite(String(siteId), simulatedWeather(42), NOW)).toMatchObject({ pv: true, load: false, reason: 'load needs 7 days of intervals (has 4)' })
    await Site.updateOne({ _id: siteId }, { $set: { lat: null } })
    expect(await forecastSite(String(siteId), simulatedWeather(42), NOW)).toMatchObject({ pv: false, load: false, reason: 'the site has no location' })
  })

  it('scores yesterday’s forecast against the meter, once', async () => {
    const issuedAt = new Date(NOW.getTime() - 25 * 3600_000)
    const first = Math.ceil(issuedAt.getTime() / 900_000) * 900_000
    const ts = (i: number) => new Date(first + i * 900_000)
    // Forecast 44 kW for four steps; the meter saw 40 → 10% error. A step with no reading is skipped.
    await Forecast.create({ siteId, kind: 'load', issuedAt, source: 'simulated', points: [0, 1, 2, 3, 4].map((i) => ({ ts: ts(i), kw: 44 })) })
    await Interval15.insertMany([0, 1, 2, 3].map((i) => ({ siteId, start: ts(i), grid: 10, export: 0, pv: 0, batt: 0, demandKw: 40 })))
    expect(await scoreForecasts(String(siteId), NOW)).toEqual([{ siteId: String(siteId), kind: 'load', mape: 10, n: 4, issuedAt }])
    expect((await Forecast.findOne({ kind: 'load' }).lean())!.accuracy).toMatchObject({ mape: 10, n: 4, evaluatedAt: NOW })
    expect(await scoreForecasts(String(siteId), NOW)).toEqual([])
  })
})

describe('accuracy on the simulated site', () => {
  it('forecasts a school day from two weeks of simulated history (MAPE logged)', async () => {
    // Two weeks of the demo site, then forecast Thursday 17 Sep and compare with what happens.
    const start = u('2026-09-03T04:00:00Z') // Thu 3 Sep 00:00 EDT, school started 2 Sep
    const engine = new SiteEngine({ tz: TZ, lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, seed: 42, devices: DEMO_DEVICES }, start)
    const weather = simulatedWeather(42)
    const slots: { ts: Date; load: number; pv: number }[] = []
    const acc = { load: 0, pv: 0, n: 0 }
    for (let s = 0; s < 15 * 288; s++) {
      engine.step(300)
      // Site consumption = what the sources deliver: grid import + PV + battery discharge
      acc.load += engine.powerOf('meter') + engine.powerOf('invA') + engine.powerOf('invB') + engine.powerOf('bat')
      acc.pv += engine.powerOf('invA') + engine.powerOf('invB')
      if (++acc.n === 3) {
        slots.push({ ts: new Date(engine.now.getTime() - 15 * 60_000), load: acc.load / 3, pv: acc.pv / 3 })
        Object.assign(acc, { load: 0, pv: 0, n: 0 })
      }
    }
    const cut = u('2026-09-17T04:00:00Z')
    const past = slots.filter((s) => s.ts < cut)
    const day = slots.filter((s) => s.ts >= cut)
    const temps = await weather.at(LOC, past.map((s) => s.ts))
    const history = past.map((s, i) => ({ ts: s.ts, kw: s.load, tempC: temps[i].tempC }))
    const ahead = await weather.at(LOC, day.map((s) => s.ts))

    const load = loadForecast(ahead, history, TZ, DEMO_CALENDAR_INPUT)
    const pv = pvForecast(DEMO_SITE, demoArrays, ratings, ahead)
    const loadScore = mape(day.map((s, i) => ({ forecast: load.kw[i] ?? 0, actual: s.load })), 1)
    const pvScore = mape(day.map((s, i) => ({ forecast: pv[i], actual: s.pv })), 0.05 * 86)
    console.log(`simulated site, Thu 17 Sep: PV MAPE ${pvScore.mape}% (${pvScore.n} daylight steps), load MAPE ${loadScore.mape}% (${loadScore.n} steps), ${load.profiles[0].label}`)
    expect(load.profiles[0]).toMatchObject({ label: 'Thursday open-day profile', days: 2 })
    expect(pvScore.mape).toBeLessThan(10)
    expect(loadScore.mape).toBeLessThan(20)
  }, 120_000)
})
