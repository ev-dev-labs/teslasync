import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HorizontalNavigation, type NavModel } from '@/components/layout/horizontal-nav';
import { PREVIEW_NAV_COLLECTIONS, PREVIEW_NAV_SECTIONS } from './navigationFixtures';

export default function PreviewHorizontalNavigation({ onSelect }: { onSelect: (section: string) => void }) {
  const { t } = useTranslation('settings');
  const [pathname, setPathname] = useState('/preview/home/overview');
  const [pinnedPaths, setPinnedPaths] = useState<ReadonlySet<string>>(new Set());
  const model: NavModel = {
    sections: PREVIEW_NAV_SECTIONS,
    collections: PREVIEW_NAV_COLLECTIONS,
    pathname,
    pinnedPaths,
    onPin: path => setPinnedPaths(previous => new Set([...previous, path])),
    onUnpin: path => setPinnedPaths(previous => new Set([...previous].filter(item => item !== path))),
    onNavigate: path => {
      setPathname(path);
      onSelect(path.split('/').pop() ?? 'overview');
    },
    unreadCount: 0,
    vehicleCount: 0,
    staleCount: 0,
  };
  const primary = PREVIEW_NAV_COLLECTIONS.find(group => group.pages.some(page => page.to === pathname))?.primary ?? pathname;
  return <HorizontalNavigation model={model}
    activeSectionTitle={PREVIEW_NAV_SECTIONS.find(section => section.items.some(item => item.to === primary))?.title}
    label={t('theme.appDesignPreview.navigation', 'Sandbox navigation')} />;
}
