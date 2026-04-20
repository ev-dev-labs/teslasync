import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { SavedDashboard } from '../widgets/types';

interface LayoutManagerProps {
  dashboards: SavedDashboard[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function LayoutManager({
  dashboards,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: LayoutManagerProps) {
  const { t } = useTranslation('dashboard');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (d: SavedDashboard) => {
    setEditingId(d.id);
    setEditName(d.name);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmRename = () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const startCreate = () => {
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

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
      {dashboards.map((d) => (
        <div key={d.id} className="flex items-center gap-0.5 shrink-0">
          {editingId === d.id ? (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="px-2 py-1 text-xs rounded-lg bg-white/10 border border-white/20
                  text-white/90 outline-none focus:border-[var(--theme-primary)]/40 w-28"
              />
              <button
                onClick={confirmRename}
                className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="p-1 text-white/40 hover:bg-white/10 rounded"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onSwitch(d.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                d.id === activeId
                  ? 'bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] border border-[var(--theme-primary)]/20'
                  : 'bg-white/5 text-white/50 hover:bg-white/10',
              )}
            >
              {d.name}
              {d.isDefault && (
                <span className="ml-1 text-[9px] text-white/30">
                  {t('dashboard.default', 'default')}
                </span>
              )}
            </button>
          )}

          {d.id === activeId && !d.isDefault && editingId !== d.id && (
            <div className="flex items-center">
              <button
                onClick={() => startRename(d)}
                className="p-1 text-white/30 hover:text-white/60 hover:bg-white/5 rounded transition-colors"
                aria-label={t('dashboard.rename', 'Rename')}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => onDelete(d.id)}
                className="p-1 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                aria-label={t('dashboard.delete', 'Delete')}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ))}

      {/* New layout button / input */}
      {isCreating ? (
        <div className="flex items-center gap-1 shrink-0">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmCreate();
              if (e.key === 'Escape') setIsCreating(false);
            }}
            placeholder={t('dashboard.newName', 'Layout name...')}
            className="px-2 py-1 text-xs rounded-lg bg-white/10 border border-white/20
              text-white/90 outline-none focus:border-[var(--theme-primary)]/40 w-28
              placeholder:text-white/30"
          />
          <button
            onClick={confirmCreate}
            className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            onClick={() => setIsCreating(false)}
            className="p-1 text-white/40 hover:bg-white/10 rounded"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={startCreate}
          className="px-3 py-1.5 rounded-lg text-xs text-white/30 border border-dashed border-white/10
            hover:border-white/20 hover:text-white/50 transition-colors shrink-0"
        >
          <Plus className="h-3 w-3 inline mr-1" />
          {t('dashboard.newLayout', 'New Layout')}
        </button>
      )}
    </div>
  );
}
