import { useContext, type ReactNode } from 'react';
import { EmbeddedChart, type EmbeddedChartProps } from '@/components/charts';
import { LayoutCard } from './LayoutCard';
import { CardPlacementContext } from './CardPlacementContext';
import { containerPolicy } from './layoutPolicy';

export type ChartCardProps = Omit<EmbeddedChartProps, 'height' | 'mobileHeight' | 'fluid' | 'className'> & {
  footer?: ReactNode;
};

export function ChartCard({ title, subtitle, children, footer, ...props }: ChartCardProps) {
  const placement = useContext(CardPlacementContext);
  const height = containerPolicy(placement?.width ?? 0).chartHeight;
  return (
    <LayoutCard title={title} description={subtitle} footer={footer}>
      <div data-chart className="min-w-0">
        <EmbeddedChart
          {...props}
          title={title}
          height={height}
          mobileHeight={height}
          fluid={false}
        >
          {children}
        </EmbeddedChart>
      </div>
    </LayoutCard>
  );
}
