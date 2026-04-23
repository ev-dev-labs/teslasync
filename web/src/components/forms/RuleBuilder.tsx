/**
 * RuleBuilder — visual editor for CEP condition trees.
 *
 * Renders a nested AND/OR tree of signal conditions with searchable
 * dropdowns, context-aware operators, and human-readable preview.
 */

import { useState, useMemo, useCallback } from 'react'
import type { RuleConditionTree } from '@/api/types'
import { signalCatalog, getSignalMeta } from '../../lib/signalCatalog'
import type { SignalMeta } from '../../lib/signalCatalog'
import { Plus, Trash2, ChevronDown, Layers, Clock, Search } from 'lucide-react'
import clsx from 'clsx'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'

// ─── Operator helpers ────────────────────────────────────────────────────────

interface OpDef {
  value: string
  label: string
  /** Types this operator applies to — empty means all. */
  types: ('number' | 'string' | 'boolean')[]
  /** If true no value input is needed. */
  noValue?: boolean
}

const ALL_OPERATORS: OpDef[] = [
  { value: '==', label: '==', types: ['number', 'string', 'boolean'] },
  { value: '!=', label: '!=', types: ['number', 'string', 'boolean'] },
  { value: '>', label: '>', types: ['number'] },
  { value: '<', label: '<', types: ['number'] },
  { value: '>=', label: '>=', types: ['number'] },
  { value: '<=', label: '<=', types: ['number'] },
  { value: 'contains', label: 'contains', types: ['string'] },
  { value: 'changed_to', label: 'changed to', types: ['number', 'string', 'boolean'] },
  { value: 'changed_from', label: 'changed from', types: ['number', 'string', 'boolean'] },
  { value: 'is_true', label: 'is true', types: ['boolean'], noValue: true },
  { value: 'is_false', label: 'is false', types: ['boolean'], noValue: true },
]

function opsForType(type: SignalMeta['type']): OpDef[] {
  return ALL_OPERATORS.filter(o => o.types.includes(type))
}

// ─── Defaults ────────────────────────────────────────────────────────────────

function emptyLeaf(): RuleConditionTree {
  return { signal: '', compare: '==', value: '' }
}

function emptyGroup(): RuleConditionTree {
  return { op: 'AND', rules: [emptyLeaf()] }
}

// ─── Immutable tree helpers ──────────────────────────────────────────────────

type Path = number[]

function updateAtPath(tree: RuleConditionTree, path: Path, updater: (n: RuleConditionTree) => RuleConditionTree): RuleConditionTree {
  if (path.length === 0) return updater(tree)
  const clone = { ...tree, rules: [...(tree.rules ?? [])] }
  const [head, ...rest] = path
  clone.rules[head] = updateAtPath(clone.rules[head], rest, updater)
  return clone
}

function removeAtPath(tree: RuleConditionTree, path: Path): RuleConditionTree {
  if (path.length === 0) return tree // can't remove root
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]
  return updateAtPath(tree, parentPath, parent => {
    const rules = [...(parent.rules ?? [])]
    rules.splice(idx, 1)
    return { ...parent, rules }
  })
}

function addAtPath(tree: RuleConditionTree, parentPath: Path, child: RuleConditionTree): RuleConditionTree {
  return updateAtPath(tree, parentPath, parent => ({
    ...parent,
    rules: [...(parent.rules ?? []), child],
  }))
}

// ─── Signal search dropdown ──────────────────────────────────────────────────

function SignalPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const meta = getSignalMeta(value)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return null // show all grouped
    return signalCatalog.filter(
      s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.category.toLowerCase().includes(q),
    )
  }, [search])

  const grouped = useMemo(() => {
    const items = filtered ?? signalCatalog
    const map = new Map<string, SignalMeta[]>()
    for (const s of items) {
      const list = map.get(s.category) ?? []
      list.push(s)
      map.set(s.category, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={clsx(
          'glass-input flex items-center justify-between gap-2 w-full text-left min-w-[200px]',
          !value && 'text-[var(--text-muted)]',
        )}
      >
        <span className="truncate">
          {meta ? (
            <>
              <span className="text-[var(--text-primary)]">{meta.name}</span>
              {meta.unit && <span className="text-[var(--text-muted)] text-xs ml-1">({meta.unit})</span>}
            </>
          ) : (
            'Select signal…'
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-96 max-h-96 overflow-auto rounded-xl shadow-2xl border border-neon-cyan/20 bg-[var(--bg,#0a0e1a)]">
            <div className="sticky top-0 p-2.5 border-b border-white/10 bg-[var(--bg,#0a0e1a)]">
              <Input
                  autoFocus
                  icon={<Search className="h-3.5 w-3.5" />}
                  className="w-full text-sm py-2"
                  placeholder="Search signals…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
            </div>
            {grouped.map(([cat, items]) => (
              <div key={cat}>
                <div className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-neon-cyan/70 border-b border-white/5 bg-[var(--surface-2,#111827)]">
                  {cat}
                </div>
                {items.map(s => (
                  <button
                    key={s.name}
                    type="button"
                    className={clsx(
                      'w-full text-left px-4 py-2 text-sm hover:bg-neon-cyan/10 transition-colors flex items-center justify-between gap-3',
                      s.name === value ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-[var(--text-primary)]',
                    )}
                    onClick={() => { onChange(s.name); setOpen(false); setSearch('') }}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{s.description}</span>
                    </div>
                    {s.unit && <span className="text-xs text-neon-cyan/60 shrink-0 font-mono">{s.unit}</span>}
                  </button>
                ))}
              </div>
            ))}
            {grouped.length === 0 && (
              <p className="p-4 text-sm text-[var(--text-muted)]">No signals match &quot;{search}&quot;</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Value input ─────────────────────────────────────────────────────────────

function ValueInput({ signal, compare, value, onChange }: {
  signal: SignalMeta | undefined
  compare: string
  value: string | number | boolean | undefined
  onChange: (v: string | number | boolean) => void
}) {
  const op = ALL_OPERATORS.find(o => o.value === compare)
  if (op?.noValue) return null

  // Enum dropdown
  if (signal?.enumValues?.length) {
    return (
      <Select
        className="text-xs min-w-[120px]"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        options={[
          { value: '', label: 'Select…' },
          ...signal.enumValues.map(v => ({ value: v, label: v })),
        ]}
      />
    )
  }

  // Boolean
  if (signal?.type === 'boolean') {
    return (
      <Select
        className="text-xs min-w-[80px]"
        value={String(value ?? 'true')}
        onChange={e => onChange(e.target.value === 'true')}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
      />
    )
  }

  // Number
  if (signal?.type === 'number') {
    return (
      <Input
        type="number"
        className="text-xs w-24"
        placeholder="value"
        value={value === undefined || value === '' ? '' : Number(value)}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    )
  }

  // Default: string
  return (
    <Input
      type="text"
      className="text-xs min-w-[120px]"
      placeholder="value"
      value={String(value ?? '')}
      onChange={e => onChange(e.target.value)}
    />
  )
}

// ─── Single condition row ────────────────────────────────────────────────────

function ConditionRow({ node, path, onUpdate, onRemove, canRemove }: {
  node: RuleConditionTree
  path: Path
  onUpdate: (path: Path, updates: Partial<RuleConditionTree>) => void
  onRemove: (path: Path) => void
  canRemove: boolean
}) {
  const meta = getSignalMeta(node.signal ?? '')
  const operators = meta ? opsForType(meta.type) : ALL_OPERATORS
  const [showFor, setShowFor] = useState((node.for_seconds ?? 0) > 0)

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      {/* Signal picker */}
      <SignalPicker
        value={node.signal ?? ''}
        onChange={signal => {
          const newMeta = getSignalMeta(signal)
          const updates: Partial<RuleConditionTree> = { signal }
          // Reset operator & value when signal type changes
          if (newMeta && meta && newMeta.type !== meta.type) {
            const validOps = opsForType(newMeta.type)
            if (!validOps.find(o => o.value === node.compare)) {
              updates.compare = validOps[0]?.value ?? '=='
            }
            updates.value = newMeta.type === 'number' ? 0 : newMeta.type === 'boolean' ? true : ''
          }
          onUpdate(path, updates)
        }}
      />

      {/* Operator */}
      <Select
        className="text-xs w-28"
        value={node.compare ?? '=='}
        onChange={e => onUpdate(path, { compare: e.target.value })}
        options={operators.map(o => ({ value: o.value, label: o.label }))}
      />

      {/* Value */}
      <ValueInput
        signal={meta}
        compare={node.compare ?? '=='}
        value={node.value}
        onChange={value => onUpdate(path, { value })}
      />

      {/* FOR duration toggle */}
      <button
        type="button"
        title="Hold for duration"
        className={clsx(
          'p-1.5 rounded-lg transition-colors',
          showFor ? 'bg-neon-purple/20 text-neon-purple' : 'bg-white/5 text-[var(--text-muted)] hover:text-neon-purple',
        )}
        onClick={() => {
          setShowFor(!showFor)
          if (showFor) onUpdate(path, { for_seconds: undefined })
        }}
      >
        <Clock className="h-3.5 w-3.5" />
      </button>

      {showFor && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">for</span>
          <Input
            type="number"
            min={0}
            className="text-xs w-16"
            placeholder="sec"
            value={node.for_seconds ?? ''}
            onChange={e => onUpdate(path, { for_seconds: e.target.value ? Number(e.target.value) : undefined })}
          />
          <span className="text-[10px] text-[var(--text-muted)]">sec</span>
        </div>
      )}

      {/* Remove */}
      {canRemove && (
        <button
          type="button"
          className="p-1.5 rounded-lg bg-white/5 text-[var(--text-muted)] hover:text-neon-red hover:bg-neon-red/10 transition-colors ml-auto"
          onClick={() => onRemove(path)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ─── Group node ──────────────────────────────────────────────────────────────

function GroupNode({ node, path, onUpdate, onRemove, onAddCondition, onAddGroup, onRemoveChild, canRemove, depth }: {
  node: RuleConditionTree
  path: Path
  onUpdate: (path: Path, updates: Partial<RuleConditionTree>) => void
  onRemove: (path: Path) => void
  onAddCondition: (parentPath: Path) => void
  onAddGroup: (parentPath: Path) => void
  onRemoveChild: (path: Path) => void
  canRemove: boolean
  depth: number
}) {
  const borderColor = depth % 2 === 0 ? 'border-neon-cyan/20' : 'border-neon-purple/20'
  const bgColor = depth % 2 === 0 ? 'bg-neon-cyan/[0.03]' : 'bg-neon-purple/[0.03]'

  return (
    <div className={clsx('rounded-xl border p-3', borderColor, bgColor)}>
      {/* Group header */}
      <div className="flex items-center gap-2 mb-2">
        <Layers className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        <div className="flex items-center rounded-lg bg-white/5 p-0.5">
          {(['AND', 'OR'] as const).map(op => (
            <button
              key={op}
              type="button"
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                node.op === op
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              )}
              onClick={() => onUpdate(path, { op })}
            >
              {op}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">
          {node.op === 'AND' ? 'All conditions must match' : 'Any condition can match'}
        </span>
        <div className="flex-1" />
        {canRemove && (
          <button
            type="button"
            className="p-1 rounded-lg bg-white/5 text-[var(--text-muted)] hover:text-neon-red hover:bg-neon-red/10 transition-colors"
            onClick={() => onRemove(path)}
            title="Remove group"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Children */}
      <div className="space-y-1 pl-2 border-l border-white/5 ml-2">
        {(node.rules ?? []).map((child, i) => {
          const childPath = [...path, i]
          if (child.op && child.rules) {
            return (
              <GroupNode
                key={i}
                node={child}
                path={childPath}
                onUpdate={onUpdate}
                onRemove={onRemoveChild}
                onAddCondition={onAddCondition}
                onAddGroup={onAddGroup}
                onRemoveChild={onRemoveChild}
                canRemove={(node.rules?.length ?? 0) > 1}
                depth={depth + 1}
              />
            )
          }
          return (
            <ConditionRow
              key={i}
              node={child}
              path={childPath}
              onUpdate={onUpdate}
              onRemove={onRemoveChild}
              canRemove={(node.rules?.length ?? 0) > 1}
            />
          )
        })}
      </div>

      {/* Add buttons */}
      <div className="flex items-center gap-2 mt-2 ml-2">
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-neon-cyan bg-white/5 hover:bg-neon-cyan/10 rounded-lg transition-colors"
          onClick={() => onAddCondition(path)}
        >
          <Plus className="h-3 w-3" /> Condition
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-neon-purple bg-white/5 hover:bg-neon-purple/10 rounded-lg transition-colors"
          onClick={() => onAddGroup(path)}
        >
          <Layers className="h-3 w-3" /> Group
        </button>
      </div>
    </div>
  )
}

// ─── Human-readable preview ──────────────────────────────────────────────────

function humanize(node: RuleConditionTree, depth = 0): string {
  if (node.op && node.rules?.length) {
    const parts = node.rules.map(r => humanize(r, depth + 1))
    const joiner = ` ${node.op} `
    const text = parts.join(joiner)
    return depth > 0 ? `(${text})` : text
  }
  if (!node.signal) return '…'
  const meta = getSignalMeta(node.signal)
  const opDef = ALL_OPERATORS.find(o => o.value === node.compare)
  const opLabel = opDef?.label ?? node.compare ?? '?'
  const valStr = opDef?.noValue ? '' : ` ${node.value ?? '?'}`
  const unit = meta?.unit ?? ''
  const dur = node.for_seconds ? ` for ${node.for_seconds}s` : ''
  return `${node.signal} ${opLabel}${valStr}${unit ? ' ' + unit : ''}${dur}`
}

// ─── Main component ─────────────────────────────────────────────────────────

export interface RuleBuilderProps {
  value: RuleConditionTree
  onChange: (tree: RuleConditionTree) => void
}

export default function RuleBuilder({ value, onChange }: RuleBuilderProps) {
  // Ensure root is always a group node
  const tree = useMemo<RuleConditionTree>(() => {
    if (value.op && value.rules) return value
    // Wrap bare leaf in AND group
    if (value.signal) return { op: 'AND', rules: [value] }
    return { op: 'AND', rules: [emptyLeaf()] }
  }, [value])

  const handleUpdate = useCallback((path: Path, updates: Partial<RuleConditionTree>) => {
    onChange(updateAtPath(tree, path, n => ({ ...n, ...updates })))
  }, [tree, onChange])

  const handleRemoveChild = useCallback((path: Path) => {
    onChange(removeAtPath(tree, path))
  }, [tree, onChange])

  const handleAddCondition = useCallback((parentPath: Path) => {
    onChange(addAtPath(tree, parentPath, emptyLeaf()))
  }, [tree, onChange])

  const handleAddGroup = useCallback((parentPath: Path) => {
    onChange(addAtPath(tree, parentPath, emptyGroup()))
  }, [tree, onChange])

  const preview = useMemo(() => humanize(tree), [tree])

  return (
    <div className="space-y-3">
      <GroupNode
        node={tree}
        path={[]}
        onUpdate={handleUpdate}
        onRemove={() => {}}
        onAddCondition={handleAddCondition}
        onAddGroup={handleAddGroup}
        onRemoveChild={handleRemoveChild}
        canRemove={false}
        depth={0}
      />

      {/* Human-readable preview */}
      <div className="glass-panel p-3 border border-white/5">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">Rule Preview</p>
        <p className="text-xs text-neon-cyan font-mono break-all">{preview}</p>
      </div>
    </div>
  )
}
