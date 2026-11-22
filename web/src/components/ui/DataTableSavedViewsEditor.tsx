import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import type { GridView } from './DataTableSavedViews';
import { Input } from './Input';
import { Text } from './Typography';

interface NamedView {
  name: string;
  view: GridView;
}

function readViews(key: string): NamedView[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is NamedView => {
      if (typeof item?.name !== 'string' || !item.name.trim() || !item.view
        || typeof item.view !== 'object' || Array.isArray(item.view)) return false;
      const layout = item.view.layout;
      return layout === null || (Array.isArray(layout?.order) && Array.isArray(layout.hidden)
        && [...layout.order, ...layout.hidden].every(key => typeof key === 'string'));
    }).slice(0, 20);
  } catch {
    return [];
  }
}

export default function DataTableSavedViewsEditor({ storageKey, capture, apply }: {
  storageKey: string;
  capture: () => GridView;
  apply: (view: GridView) => void;
}) {
  const { t } = useTranslation();
  const [views, setViews] = useState(() => readViews(storageKey));
  const [name, setName] = useState('');
  const [error, setError] = useState(false);
  const trimmed = name.trim();
  const nameUsed = views.some(item => item.name === trimmed);
  const commit = (next: NamedView[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setViews(next);
      setName('');
      setError(false);
    } catch {
      setError(true);
    }
  };

  return <div className="min-w-0 space-y-3">
    <Text as="p" variant="bodySm" color="secondary">
      {t('table.grid.savedViewsHelp', 'Save search, filters and layout in this browser. Rows and selections are not saved.')}
    </Text>
    <form className="space-y-2" onSubmit={event => {
      event.preventDefault();
      if (trimmed && !nameUsed && views.length < 20) commit([...views, { name: trimmed, view: capture() }]);
    }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-36">
          <Input label={t('table.grid.viewName', 'View name')} maxLength={60} value={name}
            onChange={event => setName(event.target.value)} />
        </div>
        <Button type="submit" disabled={!trimmed || nameUsed || views.length >= 20}>
          {t('table.grid.saveView', 'Save current view')}
        </Button>
      </div>
    </form>
    {nameUsed && <Text as="p" variant="bodySm">{t('table.grid.viewNameUsed', 'A view with this name already exists.')}</Text>}
    {views.length >= 20 && <Text as="p" variant="bodySm">{t('table.grid.viewLimit', 'Remove a saved view before adding another.')}</Text>}
    {error && <Text as="p" variant="bodySm" role="alert">{t('table.grid.viewStorageError', 'This browser could not store your views.')}</Text>}
    {views.length > 0 && <ul className="space-y-2">
      {views.map(item => <li key={item.name} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" wrapLabel className="max-w-full break-all"
          onClick={() => apply(item.view)}>{item.name}</Button>
        <Button variant="ghost" size="sm" wrapLabel onClick={() => commit(views.filter(view => view !== item))}
          aria-label={t('table.grid.removeViewNamed', 'Remove saved view {{name}}', { name: item.name })}>
          {t('table.grid.removeView', 'Remove')}
        </Button>
      </li>)}
    </ul>}
  </div>;
}
