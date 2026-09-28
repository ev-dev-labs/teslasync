import { describe, expect, it } from 'vitest'
import type {
  MediaSnapshot, MotorSnapshot, TirePressureSnapshot, VehicleConfigSnapshot,
  VehicleSettingsResponse,
} from '@/api/types'
import { vehicles } from './fixtures'
import { vehicleDomain } from './vehicleDomain'

const get = (path: string) => {
  const url = new URL(path, 'https://demo.invalid')
  return vehicleDomain(url.pathname, url.searchParams)
}

describe('vehicleDomain', () => {
  it.each(vehicles)('keeps $display_name configuration and settings aligned', v => {
    const settings = get(`/vehicles/${v.id}/settings`)
    const config = get(`/vehicle-config/latest?vehicle_id=${v.id}`)
    const body = settings?.body as VehicleSettingsResponse
    const snapshot = config?.body as VehicleConfigSnapshot & { trim_badging: string }
    expect(settings?.status).toBe(200)
    expect(snapshot.vehicle_id).toBe(v.id)
    expect(snapshot.vehicle_name).toBe(v.display_name)
    expect(snapshot.car_type).toBe(v.model)
    expect(snapshot.trim_badging).toBe(v.trim_badging)
    expect(snapshot.wheel_type).toBe(v.wheel_type)
    expect(body.settings.find(row => row.key === 'nickname')).toEqual({
      key: 'nickname', value: v.display_name, source: 'vehicle',
    })
    expect(body.settings.find(row => row.key === 'units_distance')?.value).toBe('km')
  })

  it('serves stable, vehicle-scoped snapshots and bounded history', () => {
    for (const domain of ['vehicle-config', 'tire-pressure', 'motor', 'media']) {
      const latest = get(`/${domain}/latest?vehicle_id=7`)
      const list = get(`/${domain}?vehicle_id=7&limit=1&offset=0`)
      expect(latest?.status).toBe(200)
      expect(list?.body).toEqual([latest?.body])
      expect(get(`/${domain}?vehicle_id=7&offset=1`)?.body).toEqual([])
      expect(get(`/${domain}?vehicle_id=8`)?.body).not.toEqual(list?.body)
      expect(get(`/${domain}?vehicle_id=7&start=2099-01-01`)?.body).toEqual([])
    }
    const tires = get('/tire-pressure/latest?vehicle_id=7')?.body as TirePressureSnapshot
    expect([tires.front_left, tires.front_right, tires.rear_left, tires.rear_right])
      .toEqual([290_000, 292_000, 288_000, 290_000])
    const motor = get('/motor/latest?vehicle_id=7')?.body as MotorSnapshot
    expect(motor.motor_rpm_front).toBe(0)
    expect(motor.power_kw).toBe(0)
    const media = get('/media/latest?vehicle_id=7')?.body as MediaSnapshot
    expect(media.playback_status).toBe('Stopped')
    expect(media.now_playing_title).toBeUndefined()
  })

  it('never claims live connectivity or real account data', () => {
    expect(get('/vehicles/7/silence')?.body).toMatchObject({
      status: 'never', last_seen_at: null, silent_for_s: null,
    })
    for (const kind of ['options', 'specs', 'subscriptions', 'upgrades', 'warranty', 'enterprise-roles']) {
      expect(get(`/vehicles/7/${kind}`)?.body).toEqual({ data: null, fetched_at: null })
    }
    expect(get('/vehicles/7/drivers')?.body).toEqual([])
    expect(get('/vehicles/7/invitations')?.body).toEqual([])
    expect(get('/software-updates?vehicle_id=7')?.body).toEqual([])
  })

  it('rejects invalid filters and distinguishes unsupported and missing resources', () => {
    for (const path of [
      '/vehicles/no/settings', '/motor/latest', '/tire-pressure?vehicle_id=0',
      '/media?vehicle_id=999', '/vehicle-config?vehicle_id=7&limit=-1',
      '/motor?vehicle_id=7&start=tomorrow',
      '/motor?vehicle_id=7&start=2030-01-02&end=2030-01-01',
      '/software-updates?vehicle_id=7&offset=1.5',
    ]) expect(get(path)?.status).toBe(400)
    expect(get('/vehicles/999/settings')?.status).toBe(404)
    expect(get('/vehicles/7/settings/nickname')).toBeUndefined()
    expect(get('/motor/unsupported?vehicle_id=7')).toBeUndefined()
  })
})
