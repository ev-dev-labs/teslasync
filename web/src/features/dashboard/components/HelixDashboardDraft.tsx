import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { withAiFeature } from '@/components/ai/withAiFeature';
import { Button, Text, Textarea } from '@/components/ui';
import { useDraftDashboardWidgets, type DashboardWidgetDraft } from '@/api/hooks/useDashboard';
import { WIDGET_REGISTRY } from '../widgets/registry';

const catalog = WIDGET_REGISTRY.map(({ id, name, description }) => ({ id, name, description }));
const catalogIds = new Set(catalog.map(({ id }) => id));

interface HelixDashboardDraftProps {
  onDraft: (draft: DashboardWidgetDraft) => void;
}

function HelixDashboardDraftForm({ onDraft }: HelixDashboardDraftProps) {
  const { t } = useTranslation('dashboard');
  const [prompt, setPrompt] = useState('');
  const [invalid, setInvalid] = useState(false);
  const draft = useDraftDashboardWidgets();

  const handleDraft = () => {
    const request = prompt.trim();
    if (!request || draft.isPending) return;
    setInvalid(false);
    draft.mutate({ prompt: request, widgets: catalog }, {
      onSuccess: (result) => {
        if (!result || typeof result.title !== 'string' || !result.title.trim()
          || !Array.isArray(result.widget_ids) || result.widget_ids.length === 0
          || result.widget_ids.length > 16 || new Set(result.widget_ids).size !== result.widget_ids.length
          || result.widget_ids.some((id) => typeof id !== 'string' || !catalogIds.has(id))) {
          setInvalid(true);
          return;
        }
        onDraft(result);
      },
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-4">
      <Text as="h3" variant="sectionTitle">{t('templates.helixTitle', 'Create with Helix')}</Text>
      <Text as="p" variant="bodySm">
        {t('templates.helixDescription', 'Describe your dashboard. Helix will pick real widgets and arrange them for every screen size. Review the preview before creating it.')}
      </Text>
      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        aria-label={t('templates.helixPromptLabel', 'Describe your dashboard')}
        placeholder={t('templates.helixPlaceholder', 'Show charging costs, battery health, and upcoming maintenance')}
        maxLength={1200}
        rows={2}
      />
      <Button type="button" variant="outline" size="sm" disabled={!prompt.trim() || draft.isPending} onClick={handleDraft}>
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {draft.isPending
          ? t('templates.helixWorking', 'Choosing widgets…')
          : t('templates.helixDraft', 'Draft layout')}
      </Button>
      {(draft.isError || invalid) && (
        <Text as="p" variant="bodySm" role="alert">
          {t('templates.helixError', 'Helix could not create a valid layout. Check your AI settings and try again.')}
        </Text>
      )}
    </div>
  );
}

export const HelixDashboardDraft = withAiFeature('nl-dashboard-composer', HelixDashboardDraftForm);
