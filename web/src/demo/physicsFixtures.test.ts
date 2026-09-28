import { describe, expect, it } from 'vitest'
import type { PhysicsLedger } from '@/api/types'
import type { GearTheater, SilentReport } from '@/types/teslaPhysics'
import { drives } from './fixtures'
import { physicsFixtures } from './physicsFixtures'

const query = (path: string, search = '') =>
  physicsFixtures(path, new URLSearchParams(search))

describe('fictional drive physics endpoints', () => {
  it('replays shift boundaries for each fixture drive without mistaking port state for a trip', () => {
    for (const drive of drives) {
      const result = query(`/physics/drives/${drive.id}/theater`)
      expect(result?.status).toBe(200)
      const body = result?.body as GearTheater
      expect(body).toMatchObject({
        drive_id: drive.id, vehicle_id: drive.vehicle_id,
        events: [{ at: drive.start_ts, gear: 'D' }, { at: drive.end_ts, gear: 'P' }],
      })
      expect(body.events.every(event =>
        event.charge_port_door_open === false && event.charge_port_latch === 'Engaged')).toBe(true)
      expect(body.honesty).toContain('Synthetic')
    }
  })

  it('provides a bounded counter-silent moving interval, not a disengagement count', () => {
    const drive = drives[0]
    const result = query(`/physics/drives/${drive.id}/silent`)
    expect(result?.status).toBe(200)
    const body = result?.body as SilentReport
    expect(body).toMatchObject({
      drive_id: drive.id, vehicle_id: drive.vehicle_id, unknown: false,
      intervals: [{ gear: 'D', duration_s: 120, label: 'counter silent' }],
    })
    expect(Date.parse(body.intervals[0].ended_at) - Date.parse(body.intervals[0].started_at))
      .toBe(120_000)
    expect(Date.parse(body.intervals[0].started_at)).toBeGreaterThan(Date.parse(drive.start_ts))
    expect(Date.parse(body.intervals[0].ended_at)).toBeLessThan(Date.parse(drive.end_ts))
    expect(body.honesty).toContain('not a disengagement')
  })

  it('provides the complete drive ledger with reconciling energy, SI dimensions and session markers', () => {
    for (const drive of drives) {
      const result = query(`/physics/drives/${drive.id}/ledger`)
      expect(result?.status).toBe(200)
      const body = result?.body as PhysicsLedger
      expect(body).toMatchObject({
        vehicle_id: drive.vehicle_id, kind: 'drive', start: drive.start_ts, end: drive.end_ts,
        charge: null, park: null, unknown_intervals: [], unknown_hours: 0, truncated: false,
        markers: [
          { at: drive.start_ts, kind: 'drive', id: drive.id, edge: 'start' },
          { at: drive.end_ts, kind: 'drive', id: drive.id, edge: 'end' },
        ],
      })
      expect(body.dynamics?.points.length).toBeGreaterThan(3)
      expect(body.dynamics?.regen_wh).toBe(drive.regen_energy_wh)
      expect(body.dynamics?.mass_source).toBe('default')
      expect(body.drive?.session_wh).toBe(drive.energy_used_wh)
      expect(body.drive?.measured_wh.value_wh).toBe(drive.energy_used_wh)
      expect(body.drive?.reconcile_wh).toBe(0)
      const terms = body.drive && [
        body.drive.aero_wh, body.drive.rolling_wh, body.drive.grade_wh,
        body.drive.inertial_wh, body.drive.accessory_wh, body.drive.drivetrain_loss_wh,
      ]
      expect(terms).toBeTruthy()
      expect(terms?.every(term => term.value_wh !== null && !term.unknown)).toBe(true)
      expect(body.drive?.predicted_wh).toBeCloseTo(
        terms!.reduce((sum, term) => sum + term.value_wh!, 0), 1)
      expect((body.drive?.predicted_wh ?? 0) + (body.drive?.unexplained_wh ?? 0))
        .toBeCloseTo(drive.energy_used_wh, 1)
      expect(body.thermal?.outside_c).toBe(drive.outside_temp_avg_c)
      expect(body.range?.energy_wh).toBeCloseTo(drive.end_soc_pct * 780, 1)
      expect(body.range?.spread_m).toBeCloseTo(
        body.range!.ideal_m! - body.range!.est_m!, 1)
      expect(body.tires?.imbalance_kpa).toBe(3)
      expect(body.epochs?.[0]?.unexplained_wh).toBe(body.drive?.unexplained_wh)
      expect(body.black_box?.length).toBeGreaterThan(1)
      expect(body.black_box?.every(point =>
        Date.parse(point.at) >= Date.parse(drive.end_ts) - 90_000
        && Date.parse(point.at) <= Date.parse(drive.end_ts))).toBe(true)
      expect(body.honesty).toContain('fictional')
    }
  })

  it('rejects invalid IDs and filters, reports absent drives, and leaves unknown routes unhandled', () => {
    for (const id of ['0', '-1', 'foo', '1.5', '9007199254740992']) {
      expect(query(`/physics/drives/${id}/ledger`)).toMatchObject({
        status: 400, body: { code: 'INVALID_FILTER' },
      })
    }
    expect(query('/physics/drives/9999/theater')).toMatchObject({
      status: 404, body: { code: 'NOT_FOUND' },
    })
    expect(query('/physics/drives/101/silent', 'vehicle_id=8')).toMatchObject({
      status: 400, body: { code: 'INVALID_FILTER' },
    })
    expect(query('/physics/drives/101/unknown')).toBeUndefined()
    expect(query('/physics/drives/101/shares')).toBeUndefined()
    expect(query('/physics/drives/101/ledger/extra')).toBeUndefined()
    expect(query('/physics/ledger')).toBeUndefined()
  })
})
