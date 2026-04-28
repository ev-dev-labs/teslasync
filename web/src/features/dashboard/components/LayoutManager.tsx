import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Check, X, Copy, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button as UiButton, Input as UiInput } from '@/components/ui';
import type { SavedDashboard } from '../widgets/types';

interface LayoutManagerProps {
  dashboards: SavedDashboard[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDuplicate: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onOpenTemplates?: () => void;
}

/* ─── Context menu item ─── */
function CtxItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <UiButton
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-auto w-full justify-start rounded-none px-3 py-1.5 text-xs transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-white/70 hover:bg-white/10',
        disabled && 'opacity-30 cursor-not-allowed',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </UiButton>
  );
}

export function LayoutManager({
  dashboards,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onDuplicate,
  onOpenSettings,
  onOpenTemplates,
}: LayoutManagerProps) {
  const { t } = useTranslation('dashboard');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /* ─── Drag state ─── */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  /* ─── Context menu state ─── */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; dashId: string } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [ctxMenu]);

  const handleContextMenu = useCallback((dashId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    // Clamp to viewport bounds
    const menuW = 180;
    const menuH = 160;
    const x = Math.min(e.clientX, window.innerWidth - menuW);
    const y = Math.min(e.clientY, window.innerHeight - menuH);
    setCtxMenu({ x, y, dashId });
  }, []);

  /* ─── Drag handlers ─── */
  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    const el = e.currentTarget as HTMLElement;
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (targetIndex: number) => () => {
    if (dragIndex !== null && dragIndex !== targetIndex) {
      onReorder(dragIndex, targetIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  /* ─── Rename ─── */
  const startRename = (d: SavedDashboard) => {
    setEditingId(d.id);
    setEditName(d.name);
    setCtxMenu(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmRename = () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName.trim());
    }
    setEditingId(null);
  };

  /* ─── Create ─── */
  const startCreate = () => {
    if (onOpenTemplates) {
      onOpenTemplates();
      return;
    }
    setIsCreating(true);
    setNewName('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmCreate = () => {
    if (newName.trim()) {
      onCreate(newName.trim());
    }
    setIsCreating(false);
  };

  /* ─── Context menu actions ─── */
  const ctxDash = ctxMenu ? dashboards.find((d) => d.id === ctxMenu.dashId) : null;

  return (
    <>
      <div className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-thin">
        {dashboards.map((d, i) => (
          <div key={d.id} className="flex items-center shrink-0">
            {editingId === d.id ? (
              <div className="flex items-center gap-1">
                <UiInput
                  ref={inputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="h-auto w-28 rounded-lg border-white/20 bg-white/10 px-2 py-1
                    text-xs text-white/90 focus:border-[var(--theme-primary)]/40
                    focus:ring-0 focus:ring-offset-0"
                />
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={confirmRename}
                  className="h-auto rounded p-1 text-emerald-400 hover:bg-emerald-500/10"
                  aria-label={t('dashboard.confirmRename', 'Confirm rename')}
                >
                  <Check className="h-3 w-3" />
                </UiButton>
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingId(null)}
                  className="h-auto rounded p-1 text-white/40 hover:bg-white/10"
                  aria-label={t('dashboard.cancelRename', 'Cancel rename')}
                >
                  <X className="h-3 w-3" />
                </UiButton>
              </div>
            ) : (
              <div
                draggable
                onDragStart={handleDragStart(i)}
                onDragOver={handleDragOver(i)}
                onDrop={handleDrop(i)}
                onDragEnd={handleDragEnd}
                onClick={() => onSwitch(d.id)}
                onContextMenu={handleContextMenu(d.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
                  'whitespace-nowrap transition-all select-none cursor-pointer',
                  d.id === activeId
                    ? 'bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] border border-[var(--theme-primary)]/20'
                    : 'bg-white/5 text-white/50 hover:bg-white/10',
                  dragIndex === i && 'opacity-50',
                  dragOverIndex === i && dragIndex !== i &&
                    'border-l-2 border-[var(--theme-primary)]',
                )}
              >
                <span className="text-sm leading-none">{d.icon ?? '📊'}</span>
                <span className="truncate max-w-[120px]">{d.name}</span>
                {d.isDefault && (
                  <span className="text-[9px] text-white/30">
                    {t('dashboard.default', 'default')}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        {/* New layout button / input */}
        {isCreating ? (
          <div className="flex items-center gap-1 shrink-0">
            <UiInput
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              placeholder={t('dashboard.newName', 'Layout name...')}
              className="h-auto w-28 rounded-lg border-white/20 bg-white/10 px-2 py-1
                text-xs text-white/90 placeholder:text-white/30
                focus:border-[var(--theme-primary)]/40 focus:ring-0 focus:ring-offset-0"
            />
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={confirmCreate}
              className="h-auto rounded p-1 text-emerald-400 hover:bg-emerald-500/10"
              aria-label={t('dashboard.confirmCreate', 'Confirm create')}
            >
              <Check className="h-3 w-3" />
            </UiButton>
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCreating(false)}
              className="h-auto rounded p-1 text-white/40 hover:bg-white/10"
              aria-label={t('dashboard.cancelCreate', 'Cancel create')}
            >
              <X className="h-3 w-3" />
            </UiButton>
          </div>
        ) : (
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={startCreate}
            className="h-auto shrink-0 rounded-lg border border-dashed border-white/10 px-3 py-1.5
              text-xs text-white/30
              hover:border-white/20 hover:text-white/50 transition-colors shrink-0"
          >
            <Plus className="h-3 w-3 inline mr-1" />
            {t('dashboard.newLayout', 'New Layout')}
          </UiButton>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && ctxDash && (
        <div
          ref={ctxRef}
          className="fixed z-50 bg-[var(--bg-secondary)] border border-white/10
            rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <CtxItem
            icon={Pencil}
            label={t('dashboard.rename', 'Rename')}
            onClick={() => startRename(ctxDash)}
          />
          <CtxItem
            icon={Copy}
            label={t('dashboard.duplicate', 'Duplicate')}
            onClick={() => { onDuplicate(ctxMenu.dashId); setCtxMenu(null); }}
          />
          <CtxItem
            icon={Settings}
            label={t('dashboard.settings', 'Settings')}
            onClick={() => { onOpenSettings(ctxMenu.dashId); setCtxMenu(null); }}
          />
          <div className="my-1 border-t border-white/5" />
          <CtxItem
            icon={Trash2}
            label={t('dashboard.delete', 'Delete')}
            onClick={() => { onDelete(ctxMenu.dashId); setCtxMenu(null); }}
            danger
            disabled={!!ctxDash.isDefault}
          />
        </div>
      )}
    </>
  );
}
