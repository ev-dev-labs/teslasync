import { type ReactNode, useState, useCallback } from 'react';
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
        className={cn(
          'flex items-center gap-3 px-5 py-4 cursor-pointer select-none',
          'hover:bg-white/[0.02] transition-colors',
        )}
      >
        <div className="text-cyan-400 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white/90">
            {title}
          </div>
          <div className="text-xs text-white/40 mt-0.5">
            {description}
          </div>
        </div>
        {badges && (
          <div className="flex items-center gap-2 shrink-0">{badges}</div>
        )}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-white/40 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </div>
      {open && (
        <FadeIn>
          <div className="border-t border-white/[0.06] px-5 py-4 space-y-4">
            {children}
          </div>
        </FadeIn>
      )}
    </GlassPanel>
  );
}
