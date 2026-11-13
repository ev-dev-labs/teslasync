import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Caption, GlassPanel, Input, PanelTitle, Text } from '@/components/ui';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import '@/components/ui/appDesignPacks.css';
import { cn } from '@/lib/cn';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import PreviewOverview from './app-design-preview/PreviewOverview';
import PreviewForm from './app-design-preview/PreviewForm';
import PreviewTable from './app-design-preview/PreviewTable';
import PreviewChart from './app-design-preview/PreviewChart';
import PreviewMap from './app-design-preview/PreviewMap';
import PreviewFeedback from './app-design-preview/PreviewFeedback';
import PreviewOverlays from './app-design-preview/PreviewOverlays';

interface AppDesignPackPreviewProps {
  packId: PackId;
  children?: ReactNode;
}

/** Deliberately has no preference bridge, domain queries, commands or mutations. */
export default function AppDesignPackPreview({ packId, children }: AppDesignPackPreviewProps) {
  const { t } = useTranslation('settings');
  const previewRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState('overview');
  useLayoutEffect(() => {
    const host = previewRef.current;
    if (host) return observeAppDesignScopes(host);
  }, []);
  const navigationMode = APPLICATION_DESIGNS[packId].navigation;
  const navigation = [
    { key: 'overview', label: t('theme.appDesignPreview.overview', 'Overview') },
    { key: 'activity', label: t('theme.appDesignPreview.activity', 'Activity') },
    { key: 'review', label: t('theme.appDesignPreview.review', 'Review') },
  ];
  return (
    <div ref={previewRef} {...getAppDesignAttributes(packId)} data-app-design-preview="" data-preview-synthetic="true"
      className="min-w-0 space-y-6">
      <header data-role="workspace-header" data-app-part="workspace-header" className="space-y-3 p-4">
        <PanelTitle>{t('theme.widgetDesignPacks.appPreview', 'Application preview')}</PanelTitle>
        <Text>{t('theme.appDesignPreview.disclosure', 'Synthetic sandbox. All readings, journeys and locations below are examples, not your vehicle data. Interactions stay here; nothing is saved and no commands are sent.')}</Text>
        <Caption>{t('theme.widgetDesignPacks.appPreviewHelp', 'Shared navigation, headings, controls and panels use this design when applied to the entire application.')}</Caption>
        <Input label={t('theme.widgetDesignPacks.sampleVehicle', 'Sample vehicle')} value="Model Y" readOnly />
      </header>
      <div data-app-part="shell" className={cn('grid min-w-0 gap-4',
        navigationMode === 'rail' && 'md:grid-cols-[minmax(0,7rem)_minmax(0,1fr)]',
        navigationMode === 'sidebar' && 'md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]')}>
        <aside data-app-part="shell-sidebar" className="min-w-0">
          <nav data-app-part="navigation" aria-label={t('theme.appDesignPreview.navigation', 'Sandbox navigation')}
            className={cn('flex flex-wrap gap-2',
              (navigationMode === 'rail' || navigationMode === 'sidebar') && 'md:flex-col',
              navigationMode === 'hybrid' && 'justify-between border-b border-[var(--border-default)] pb-3')}>
            {navigation.map(item => (
              <Button key={item.key} data-app-part="nav-item" variant="secondary"
                aria-current={section === item.key ? 'page' : undefined}
                onClick={() => setSection(item.key)}>{item.label}</Button>
            ))}
          </nav>
        </aside>
        <div data-app-part="shell-main page" className="min-w-0 space-y-6">
          <div data-app-part="page-header" className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <PanelTitle data-app-part="page-title">{navigation.find(item => item.key === section)?.label}</PanelTitle>
              <Text variant="bodySm">{t('theme.appDesignPreview.workspace', 'Explore a complete sample workspace, including open controls and recovery states.')}</Text>
            </div>
            <div data-app-part="page-actions"><PreviewOverlays /></div>
          </div>
          <div data-app-part="page-content" className="min-w-0 space-y-6">
            <PreviewOverview section={section} />
            <div data-app-part="grid" className="grid min-w-0 gap-4 lg:grid-cols-2">
              <PreviewChart />
              <PreviewMap />
            </div>
            <PreviewTable />
            <PreviewForm />
            <PreviewFeedback />
            <GlassPanel className="min-w-0 space-y-4 p-4" data-preview-section="widgets">
              <PanelTitle>{t('theme.appDesignPreview.widgets', 'Original widget designs')}</PanelTitle>
              {children}
            </GlassPanel>
          </div>
        </div>
      </div>
    </div>
  );
}
