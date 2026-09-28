import { drives } from './fixtures'

type Drive = (typeof drives)[number]

export function visitedLocations(rows: Drive[]) {
  const places = new Map<string, Drive[]>()
  for (const drive of rows) {
    if (!drive.end_ts || !drive.end_address) continue
    const key = `${drive.vehicle_id}:${drive.end_address}`
    places.set(key, [...(places.get(key) ?? []), drive])
  }
  return [...places.values()].map(visits => ({
    id: Math.min(...visits.map(row => row.id)),
    vehicle_id: visits[0].vehicle_id,
    address_name: visits[0].end_address,
    visit_count: visits.length,
    total_duration_s: visits.reduce((total, row) => total + row.duration_s, 0),
    last_visited: visits.reduce((latest, row) =>
      row.end_ts > latest ? row.end_ts : latest, visits[0].end_ts),
    created_at: visits.reduce((earliest, row) =>
      row.start_ts < earliest ? row.start_ts : earliest, visits[0].start_ts),
  })).sort((a, b) => b.visit_count - a.visit_count || a.id - b.id)
}
