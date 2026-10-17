import type { ReactNode } from 'react';
import { CardGrid } from '@/components/layout';

interface SafetyPanelGridProps {
  label: string;
  primary: ReactNode;
  secondary: ReactNode;
  widePrimary?: boolean;
}

/** Presentation only: source order and both independent panel shells survive. */
export function SafetyPanelGrid({
  label,
  primary,
  secondary,
  widePrimary = false,
}: SafetyPanelGridProps) {
  return (
    <section aria-label={label} className="min-w-0">
      <CardGrid
        label={label}
        items={[
          { id: 'primary', size: widePrimary ? 'half' : 'third', content: primary },
          { id: 'secondary', size: widePrimary ? 'third' : 'half', content: secondary },
        ]}
      />
    </section>
  );
}
