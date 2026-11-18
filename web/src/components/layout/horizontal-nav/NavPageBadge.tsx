import { useTranslation } from 'react-i18next'
import type { NavBadge } from '../sectionGroups'
import { SidebarCountChip, SidebarNotificationDot } from '../sidebar/SidebarRow'
import { SidebarDriveBadge } from '../sidebar/SidebarDriveBadge'
import type { NavModel } from './navGroups'

export function NavPageBadge({ badge, model }: { badge: NavBadge; model: Pick<NavModel, 'vehicleId' | 'unreadCount' | 'vehicleCount' | 'staleCount'> }) {
  const { t } = useTranslation()
  switch (badge) {
    case 'drives-today':
    case 'drive-score':
      return model.vehicleId ? <SidebarDriveBadge vehicleId={model.vehicleId} kind={badge === 'drives-today' ? 'today' : 'score'} /> : null
    case 'unread':
      return model.unreadCount > 0 ? <SidebarNotificationDot /> : null
    case 'vehicles':
      return model.vehicleCount > 0 ? <SidebarCountChip value={model.vehicleCount}
        label={t('nav.vehicleCount', { count: model.vehicleCount, defaultValue: '{{count}} vehicles' })} /> : null
    case 'stale':
      return model.staleCount > 0 ? <SidebarCountChip value={model.staleCount}
        label={t('nav.staleCount', { count: model.staleCount, defaultValue: '{{count}} stale rows' })} /> : null
  }
}
