import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Icons } from '@/lib/icons';
import { FadeIn } from '@/components/motion';
import { Button as ControlButton, Text } from '@/components/ui';
import { CATEGORY_META, type CommandCategory } from '../commands';

interface CollapsibleCommandGroupProps {
  category: CommandCategory;
  vehicleId: number;
  children: ReactNode;
  count: number;
  defaultOpen?: boolean;
}

export function CollapsibleCommandGroup({
  category,
  vehicleId,
  children,
  count,
  defaultOpen = false,
}: CollapsibleCommandGroupProps) {
  const { t } = useTranslation();
  const storageKey = `teslasync-cat-${vehicleId}-${category}`;
  const panelId = `teslasync-cmdgroup-${vehicleId}-${category}`;

  const [open, setOpen] = useState(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      return stored !== null ? stored === 'true' : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { sessionStorage.setItem(storageKey, String(next)); } catch { /* noop */ }
  };

  const meta = CATEGORY_META[category];
  // Guard against an unknown category reaching this component at runtime
  // (e.g. an API-driven command list) — render nothing instead of crashing
  // the whole command center on `meta.icon`.
  if (!meta) return null;
  const Icon = meta.icon;
  const ChevronDown = Icons.expand;

  return (
    <div>
      <ControlButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="group h-auto w-full justify-start py-2 text-left font-normal hover:bg-transparent"
      >
        <Icon aria-hidden="true" className="h-4 w-4 text-[var(--text-muted)]" />
        <Text size="xs" weight="medium" className="uppercase tracking-wider text-[var(--text-secondary)]">
          {t(meta.labelKey, meta.fallback)}
        </Text>
        <Text size="2xs" color="muted" className="ml-1">({count ?? 0})</Text>
        <ChevronDown aria-hidden="true" className={cn(
          'h-3.5 w-3.5 text-[var(--text-muted)] ml-auto transition-transform duration-normal',
          open && 'rotate-180',
        )} />
      </ControlButton>
      {open && (
        <FadeIn>
          <div id={panelId} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-2">
            {children}
          </div>
        </FadeIn>
      )}
    </div>
  );
}
