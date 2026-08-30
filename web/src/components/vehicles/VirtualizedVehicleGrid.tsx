import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { cn } from '@/lib/cn';
import type { Vehicle } from '@/types/vehicle';

export interface VirtualizedVehicleGridProps {
  vehicles: readonly Vehicle[];
  label: string;
  renderVehicle: (vehicle: Vehicle) => ReactNode;
  onVisibleVehiclesChange?: (vehicles: readonly Vehicle[]) => void;
  className?: string;
}

export function fleetGridColumnsForWidth(width: number): number {
  if (width >= 1920) return 4;
  if (width >= 1536) return 3;
  if (width >= 768) return 2;
  return 1;
}

/**
 * Responsive row virtualization for large vehicle fleets.
 *
 * Rows are virtualized instead of individual cards so the visual reading
 * order and responsive grid remain stable at every breakpoint.
 */
export function VirtualizedVehicleGrid({
  vehicles,
  label,
  renderVehicle,
  onVisibleVehiclesChange,
  className,
}: VirtualizedVehicleGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;

    const measure = () => {
      setContainerWidth(container.clientWidth);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const columns = fleetGridColumnsForWidth(
    containerWidth || (typeof window !== 'undefined' ? window.innerWidth : 0),
  );
  const rowCount = Math.ceil(vehicles.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 290,
    overscan: 2,
    getItemKey: (rowIndex) =>
      `${columns}:${vehicles[rowIndex * columns]?.id ?? rowIndex}`,
  });
  const virtualRows = virtualizer.getVirtualItems();

  useEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  const firstRenderedRow = virtualRows[0]?.index ?? 0;
  const lastRenderedRow =
    virtualRows[virtualRows.length - 1]?.index
    ?? Math.min(rowCount - 1, 2);
  const visibleVehicles = useMemo(() => {
    if (lastRenderedRow < firstRenderedRow) return [];
    return vehicles.slice(
      firstRenderedRow * columns,
      Math.min((lastRenderedRow + 1) * columns, vehicles.length),
    );
  }, [
    columns,
    firstRenderedRow,
    lastRenderedRow,
    vehicles,
  ]);

  useEffect(() => {
    onVisibleVehiclesChange?.(visibleVehicles);
  }, [onVisibleVehiclesChange, visibleVehicles]);

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label={label}
      className={cn(
        'relative h-[min(72vh,56rem)] min-h-[28rem] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]',
        className,
      )}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualRows.map((virtualRow) => {
          const rowStart = virtualRow.index * columns;
          const rowVehicles = vehicles.slice(rowStart, rowStart + columns);

          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              role="presentation"
              className="absolute left-0 top-0 grid w-full gap-3 pb-3 sm:gap-4 sm:pb-4"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {rowVehicles.map((vehicle, index) => (
                <div
                  key={vehicle.id}
                  role="listitem"
                  aria-posinset={rowStart + index + 1}
                  aria-setsize={vehicles.length}
                  className="h-full min-w-0"
                >
                  {renderVehicle(vehicle)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
