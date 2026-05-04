import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { ChevronDown } from 'lucide-react';
import { FadeIn } from '@/components/motion';
import { Button as ControlButton } from '@/components/ui';
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
  const Icon = meta.icon;

  return (
    <div>
      <ControlButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={toggle}
        aria-expanded={open}
        className="group h-auto w-full justify-start py-2 text-left font-normal hover:bg-transparent"
      >
        <Icon className="h-4 w-4 text-[var(--text-muted)]" />
        <span className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium">
          {t(meta.labelKey, meta.fallback)}
        </span>
        <span className="text-[10px] text-[var(--text-muted)] ml-1">({count})</span>
        <ChevronDown className={cn(
          'h-3.5 w-3.5 text-[var(--text-muted)] ml-auto transition-transform duration-normal',
          open && 'rotate-180',
        )} />
      </ControlButton>
      {open && (
        <FadeIn>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-2">
            {children}
          </div>
        </FadeIn>
      )}
    </div>
  );
}
