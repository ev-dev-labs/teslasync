import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Car, Key, Clock, Braces, Link, Fingerprint, Hash, HardDrive,
  Palette, Timer, Network, BookOpen, Regex, Lock, ChevronDown,
} from 'lucide-react'
import { Button as UiButton, Input as UiInput, GlassPanel } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ICON_COLOR_MAP } from './constants'

import { VinDecoderTool } from './tools/VinDecoder'
import { JwtDecoderTool } from './tools/JwtDecoder'
import { TimestampTool } from './tools/TimestampTool'
import { Base64Tool } from './tools/Base64Tool'
import { UrlEncoderTool } from './tools/UrlEncoder'
import { JsonFormatterTool } from './tools/JsonFormatter'
import { UuidGeneratorTool } from './tools/UuidGenerator'
import { HashCalculatorTool } from './tools/HashCalculator'
import { ByteSizeConverterTool } from './tools/ByteSizeConverter'
import { ColorConverterTool } from './tools/ColorConverter'
import { CronParserTool } from './tools/CronParser'
import { HttpStatusTool } from './tools/HttpStatusTool'
import { TeslaApiRefTool } from './tools/TeslaApiRefTool'
import { RegexTesterTool } from './tools/RegexTester'
import { UnixPermissionTool } from './tools/UnixPermissionTool'

/* ─── tool registry ───────────────────────────────────────────────────── */

interface ToolEntry {
  id: string
  name: string
  desc: string
  icon: React.ElementType
  color: string
  Component: React.ComponentType
}

function useToolList(): ToolEntry[] {
  const { t } = useTranslation()
  return useMemo(() => [
    { id: 'vin', name: t('Vin Decoder'), desc: t('Vin Decoder Desc'), icon: Car, color: 'cyan', Component: VinDecoderTool },
    { id: 'jwt', name: t('Jwt Decoder'), desc: t('Jwt Decoder Desc'), icon: Key, color: 'purple', Component: JwtDecoderTool },
    { id: 'timestamp', name: t('Timestamp'), desc: t('Timestamp Desc'), icon: Clock, color: 'green', Component: TimestampTool },
    { id: 'base64', name: t('devtools.utils.base64', 'Base64'), desc: t('devtools.utils.base64Desc', 'Base64Desc'), icon: Braces, color: 'amber', Component: Base64Tool },
    { id: 'url', name: t('Url Encoder'), desc: t('Url Encoder Desc'), icon: Link, color: 'cyan', Component: UrlEncoderTool },
    { id: 'json', name: t('Json Formatter'), desc: t('Json Formatter Desc'), icon: Braces, color: 'green', Component: JsonFormatterTool },
    { id: 'uuid', name: t('Uuid Generator'), desc: t('Uuid Generator Desc'), icon: Fingerprint, color: 'purple', Component: UuidGeneratorTool },
    { id: 'hash', name: t('Hash Calculator'), desc: t('Hash Calculator Desc'), icon: Hash, color: 'red', Component: HashCalculatorTool },
    { id: 'bytes', name: t('Byte Size'), desc: t('Byte Size Desc'), icon: HardDrive, color: 'cyan', Component: ByteSizeConverterTool },
    { id: 'color', name: t('Color Converter'), desc: t('Color Converter Desc'), icon: Palette, color: 'purple', Component: ColorConverterTool },
    { id: 'cron', name: t('Cron Parser'), desc: t('Cron Parser Desc'), icon: Timer, color: 'green', Component: CronParserTool },
    { id: 'http', name: t('Http Status'), desc: t('Http Status Desc'), icon: Network, color: 'amber', Component: HttpStatusTool },
    { id: 'tesla-api', name: t('Tesla Api Ref'), desc: t('Tesla Api Ref Desc'), icon: BookOpen, color: 'cyan', Component: TeslaApiRefTool },
    { id: 'regex', name: t('Regex Tester'), desc: t('Regex Tester Desc'), icon: Regex, color: 'red', Component: RegexTesterTool },
    { id: 'unix-perm', name: t('Unix Perm'), desc: t('Unix Perm Desc'), icon: Lock, color: 'green', Component: UnixPermissionTool },
  ], [t])
}

/* ─── expandable tool card ────────────────────────────────────────────── */

function ExpandableToolCard({ tool, expanded, onToggle }: { tool: ToolEntry; expanded: boolean; onToggle: () => void }) {
  const Icon = tool.icon
  return (
    <GlassPanel hover className="overflow-hidden transition-all duration-200">
      <UiButton
        type="button"
        variant="ghost"
        onClick={onToggle}
        aria-expanded={expanded}
        className="!h-auto !w-full !justify-start !rounded-none !p-4 text-left hover:!bg-transparent"
      >
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', ICON_COLOR_MAP[tool.color] ?? ICON_COLOR_MAP.cyan)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white">{tool.name}</h3>
          <p className="text-xs text-white/50">{tool.desc}</p>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-white/40 transition-transform duration-200', expanded && 'rotate-180')} />
      </UiButton>
      {expanded && (
        <div className="border-t border-white/[0.04] p-4">
          <tool.Component />
        </div>
      )}
    </GlassPanel>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Client Utilities Section — searchable grid
   ═══════════════════════════════════════════════════════════════════════ */

export function ClientUtilitiesSection() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const tools = useToolList()

  const filtered = useMemo(() => {
    if (!search.trim()) return tools
    const q = search.toLowerCase()
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        tool.desc.toLowerCase().includes(q),
    )
  }, [tools, search])

  return (
    <div className="space-y-4">
      <UiInput
        placeholder={t('devtools.searchTools', 'Search tools...')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((tool) => (
          <ExpandableToolCard
            key={tool.id}
            tool={tool}
            expanded={expandedId === tool.id}
            onToggle={() => setExpandedId((prev) => (prev === tool.id ? null : tool.id))}
          />
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-white/40">
          {t('devtools.noToolsFound', 'No tools match your search')}
        </p>
      )}
    </div>
  )
}
