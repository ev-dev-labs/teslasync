import type { TFunction } from 'i18next'
import { BatteryCharging, Bell, BellRing, Car, Compass, MapPin, MapPinned, Route, Search, Workflow } from 'lucide-react'
import type { SearchHit, SearchHitType } from '@/api/types'

export const ALL_TYPES: SearchHitType[] = [
  'vehicle', 'drive', 'charging', 'alert', 'notification',
  'geofence', 'automation', 'location', 'trip',
]

export interface SearchHitGroup {
  type: SearchHitType
  hits: SearchHit[]
}

export function groupSearchHits(hits: SearchHit[]): SearchHitGroup[] {
  const groups = new Map<SearchHitType, SearchHit[]>()
  for (const type of ALL_TYPES) groups.set(type, [])
  for (const hit of hits) groups.get(hit.type)?.push(hit)
  return ALL_TYPES.map(type => ({ type, hits: groups.get(type) ?? [] }))
    .filter(group => group.hits.length > 0)
}

export function searchHitIconSm(type: SearchHitType): JSX.Element {
  const cls = 'h-4 w-4'
  switch (type) {
    case 'vehicle': return <Car className={cls} aria-hidden="true" />
    case 'drive': return <Route className={cls} aria-hidden="true" />
    case 'charging': return <BatteryCharging className={cls} aria-hidden="true" />
    case 'alert': return <BellRing className={cls} aria-hidden="true" />
    case 'notification': return <Bell className={cls} aria-hidden="true" />
    case 'geofence': return <MapPinned className={cls} aria-hidden="true" />
    case 'automation': return <Workflow className={cls} aria-hidden="true" />
    case 'location': return <MapPin className={cls} aria-hidden="true" />
    case 'trip': return <Compass className={cls} aria-hidden="true" />
    default: return <Search className={cls} aria-hidden="true" />
  }
}

export function searchSectionLabel(type: SearchHitType, t: TFunction): string {
  switch (type) {
    case 'vehicle': return t('search.section.vehicle', 'Vehicles')
    case 'drive': return t('search.section.drive', 'Drives')
    case 'charging': return t('search.section.charging', 'Charging')
    case 'alert': return t('search.section.alert', 'Alerts')
    case 'notification': return t('search.section.notification', 'Notifications')
    case 'geofence': return t('search.section.geofence', 'Geofences')
    case 'automation': return t('search.section.automation', 'Automations')
    case 'location': return t('search.section.location', 'Locations')
    case 'trip': return t('search.section.trip', 'Trips')
    default: return t('search.section.results', 'Results')
  }
}

export function searchTypeScopeLabel(types: SearchHitType[] | null, t: TFunction): string {
  return types == null
    ? t('common.unknown', 'Unknown')
    : types.length > 0
      ? types.map(type => searchSectionLabel(type, t)).join(', ')
      : t('search.kpi.allTypes', 'All types shown')
}
