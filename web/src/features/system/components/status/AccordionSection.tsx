import { type ReactNode, useState, useCallback, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';

interface AccordionSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function AccordionSection({
  icon,
  title,
  description,
  badges,
  defaultOpen = false,
  children,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const panelId = `${reactId}-panel`;

  const handleToggle = useCallback(() => setOpen((prev) => !prev), []);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    },
    [],
  );

  return (
    <GlassPanel className="overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'flex items-center gap-3 px-5 py-4 cursor-pointer select-none',
          'hover:bg-white/[0.02] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-inset',
        )}
      >
        <div className="text-cyan-400 shrink-0" aria-hidden="true">{icon}</div>
        <div className="flex-1 min-w-0">
          <div
            id={titleId}
            className="text-sm font-semibold text-[var(--text-primary)]"
          >
            {title}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">
            {description}
          </div>
        </div>
        {badges && (
          <div className="flex items-center gap-2 shrink-0">{badges}</div>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-4 w-4 text-[var(--text-muted)] transition-transform duration-normal',
            open && 'rotate-180',
          )}
        />
      </div>
      {open && (
        <FadeIn>
          <div
            id={panelId}
            role="region"
            aria-labelledby={titleId}
            className="border-t border-white/[0.06] px-5 py-4 space-y-4"
          >
            {children}
          </div>
        </FadeIn>
      )}
    </GlassPanel>
  );
}
