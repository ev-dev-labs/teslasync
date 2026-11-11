import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Popover, Tabs, Text, Tooltip } from '@/components/ui';

export default function PreviewOverlays() {
  const { t } = useTranslation('settings');
  const [dialog, setDialog] = useState(false);
  const [popover, setPopover] = useState(false);
  const [tab, setTab] = useState('summary');
  const anchor = useRef<HTMLButtonElement>(null);
  const dialogTrigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const tabs = [
    { key: 'summary', label: t('theme.appDesignPreview.dialogSummary', 'Summary') },
    { key: 'quality', label: t('theme.appDesignPreview.dialogQuality', 'Quality') },
    { key: 'live', label: t('theme.appDesignPreview.dialogLive', 'Live unavailable'), disabled: true },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      <Button ref={dialogTrigger} onClick={() => setDialog(true)}>{t('theme.appDesignPreview.openDialog', 'Inspect sample journey')}</Button>
      <Button ref={anchor} variant="secondary" aria-haspopup="dialog" aria-expanded={popover}
        onClick={() => setPopover(value => !value)}>{t('theme.appDesignPreview.openPopover', 'Preview help')}</Button>
      <Tooltip portal content={t('theme.appDesignPreview.tooltip', 'Every action here is local to this synthetic preview.')}>
        <Button variant="ghost">{t('theme.appDesignPreview.tooltipTrigger', 'Safety information')}</Button>
      </Tooltip>
      <Popover open={popover} onClose={() => setPopover(false)} anchorRef={anchor} zIndex={120}
        ariaLabel={t('theme.appDesignPreview.openPopover', 'Preview help')}>
        <div className="max-w-xs space-y-3 p-4">
          <Text>{t('theme.appDesignPreview.popoverHelp', 'Explore open, selected and focus states without changing the saved design.')}</Text>
          <Button variant="secondary" onClick={() => setPopover(false)}>{t('theme.appDesignPreview.dismissHelp', 'Dismiss help')}</Button>
        </div>
      </Popover>
      <Modal open={dialog} onClose={() => setDialog(false)}
        getReturnFocusTarget={() => dialogTrigger.current}
        title={t('theme.appDesignPreview.dialog', 'Synthetic journey details')} size="lg" aboveNotifications
        footer={<Button onClick={() => setDialog(false)}>{t('theme.appDesignPreview.closeDetails', 'Close details')}</Button>}>
        <Tabs idBase={id} tabs={tabs} activeTab={tab} onChange={setTab}
          ariaLabel={t('theme.appDesignPreview.dialogTabs', 'Sample journey details')} />
        {tabs.filter(item => !item.disabled).map(item => (
          <div key={item.key} id={`${id}-panel-${item.key}`} role="tabpanel"
            aria-labelledby={`${id}-tab-${item.key}`} hidden={tab !== item.key} className="py-4">
            <Text>{item.key === 'summary'
              ? t('theme.appDesignPreview.dialogSummaryText', 'Harbor loop is a synthetic journey with a real plotted trace and local map geometry.')
              : t('theme.appDesignPreview.dialogQualityText', 'The trace includes an observation gap. Missing values are not interpolated into verified readings.')}</Text>
          </div>
        ))}
      </Modal>
    </div>
  );
}
