import { QuickNav } from '../components/QuickNav';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function QuickNavWidget(_props: WidgetProps) {
  return (
    <WidgetShell noPadding>
      <QuickNav />
    </WidgetShell>
  );
}
