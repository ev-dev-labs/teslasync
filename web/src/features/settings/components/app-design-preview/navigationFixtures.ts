import type { NavModel } from '@/components/layout/horizontal-nav';
import { Icons } from '@/lib/icons';

const samplePages = [
  { key: 'overview', label: 'Overview', icon: Icons.home },
  { key: 'activity', label: 'Activity', icon: Icons.activity },
  { key: 'review', label: 'Review', icon: Icons.search },
] as const;

/** Synthetic destinations cannot resolve to live application routes. */
const sampleSections = [
  'Home', 'Vehicles', 'Driving', 'Charging', 'Battery', 'Energy', 'Cabin',
  'Reports', 'Service', 'Commands', 'Automation', 'Settings', 'Account',
].map(title => ({
  title,
  titleKey: `nav.groups.${title.toLowerCase()}`,
  items: samplePages.map(page => ({
    to: `/preview/${title.toLowerCase()}/${page.key}`,
    label: page.label,
    labelKey: `settings:theme.appDesignPreview.${page.key}`,
    icon: page.icon,
  })),
}));

export const PREVIEW_NAV_SECTIONS: NavModel['sections'] = sampleSections.map(section => ({
  ...section,
  items: section.items.filter((_, index) => index !== 1),
}));

export const PREVIEW_NAV_COLLECTIONS: NavModel['collections'] = sampleSections.map(section => ({
  primary: section.items[0].to,
  label: 'Overview',
  labelKey: 'settings:theme.appDesignPreview.overview',
  pages: section.items.slice(0, 2),
}));
