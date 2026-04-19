import { Suspense, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { getWidgetDef } from '../widgets/registry';
import type { WidgetInstance } from '../widgets/types';

interface DashboardGridProps {
  widgets: WidgetInstance[];
  editMode: boolean;
  onReorder: (activeId: string, overId: string) => void;
  onRemove: (instanceId: string) => void;
}

function SortableWidget({
  instance,
  editMode,
  onRemove,
}: {
  instance: WidgetInstance;
  editMode: boolean;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: instance.id,
    disabled: !editMode,
  });

  const widgetDef = getWidgetDef(instance.widgetId);
  if (!widgetDef) return null;

  const Component = widgetDef.component;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        gridColumn: `span ${instance.size.cols}`,
        gridRow: `span ${instance.size.rows}`,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="relative group min-h-0"
    >
      {editMode && (
        <div
          className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between
            bg-black/60 backdrop-blur-sm rounded-t-xl px-3 py-1.5
            opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-white/40 hover:text-white/70"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="text-xs text-white/50 font-medium">{widgetDef.name}</span>
          <button
            onClick={() => onRemove(instance.id)}
            className="text-white/40 hover:text-red-400 transition-colors"
            aria-label={`Remove ${widgetDef.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {editMode && (
        <div className="absolute inset-0 border-2 border-dashed border-white/10 rounded-xl pointer-events-none z-[5]" />
      )}
      <Suspense
        fallback={
          <GlassPanel className="h-full flex items-center justify-center">
            <Skeleton className="h-3/4 w-3/4 rounded-xl" />
          </GlassPanel>
        }
      >
        <Component vehicleId={instance.config?.vehicleId as number | undefined} size={instance.size} />
      </Suspense>
    </div>
  );
}

export function DashboardGrid({ widgets, editMode, onReorder, onRemove }: DashboardGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        onReorder(String(active.id), String(over.id));
      }
    },
    [onReorder],
  );

  const sorted = [...widgets].sort((a, b) => a.position - b.position);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sorted.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[180px]">
          {sorted.map((w) => (
            <SortableWidget key={w.id} instance={w} editMode={editMode} onRemove={onRemove} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
