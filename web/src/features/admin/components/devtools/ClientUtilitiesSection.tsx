import { useState, useMemo, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Car, Key, Clock, Braces, Link, Fingerprint, Hash, HardDrive,
  Palette, Timer, Network, BookOpen, Regex, Lock,
} from 'lucide-react'
import { Accordion, Input as UiInput, Text } from '@/components/ui'
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
    { id: 'vin', name: t('devtools.utils.vin', 'VIN decoder'), desc: t('devtools.utils.vinDesc', 'VIN decoder desc'), icon: Car, color: 'cyan', Component: VinDecoderTool },
    { id: 'jwt', name: t('devtools.utils.jwt', 'JWT decoder'), desc: t('devtools.utils.jwtDesc', 'JWT decoder desc'), icon: Key, color: 'purple', Component: JwtDecoderTool },
    { id: 'timestamp', name: t('devtools.utils.timestamp', 'Timestamp'), desc: t('devtools.utils.timestampDesc', 'Convert between Unix and ISO 8601 timestamps'), icon: Clock, color: 'green', Component: TimestampTool },
    { id: 'base64', name: t('devtools.utils.base64', 'Base64'), desc: t('devtools.utils.base64Desc', 'Base64Desc'), icon: Braces, color: 'amber', Component: Base64Tool },
    { id: 'url', name: t('devtools.utils.url', 'URL encoder'), desc: t('devtools.utils.urlDesc', 'URL encoder desc'), icon: Link, color: 'cyan', Component: UrlEncoderTool },
    { id: 'json', name: t('devtools.utils.json', 'JSON formatter'), desc: t('devtools.utils.jsonMenuDesc', 'JSON formatter desc'), icon: Braces, color: 'green', Component: JsonFormatterTool },
    { id: 'uuid', name: t('devtools.utils.uuid', 'UUID generator'), desc: t('devtools.utils.uuidDesc', 'UUID generator desc'), icon: Fingerprint, color: 'purple', Component: UuidGeneratorTool },
    { id: 'hash', name: t('devtools.utils.hash', 'Hash calculator'), desc: t('devtools.utils.hashDesc', 'Hash calculator desc'), icon: Hash, color: 'red', Component: HashCalculatorTool },
    { id: 'bytes', name: t('devtools.utils.byteSize', 'Byte size'), desc: t('devtools.utils.byteSizeMenuDesc', 'Byte size desc'), icon: HardDrive, color: 'cyan', Component: ByteSizeConverterTool },
    { id: 'color', name: t('devtools.utils.color', 'Color converter'), desc: t('devtools.utils.colorDesc', 'Color converter desc'), icon: Palette, color: 'purple', Component: ColorConverterTool },
    { id: 'cron', name: t('devtools.utils.cron', 'Cron parser'), desc: t('devtools.utils.cronDesc', 'Cron parser desc'), icon: Timer, color: 'green', Component: CronParserTool },
    { id: 'http', name: t('devtools.utils.httpStatus', 'HTTP status'), desc: t('devtools.utils.httpStatusDesc', 'Reference for HTTP response status codes'), icon: Network, color: 'amber', Component: HttpStatusTool },
    { id: 'tesla-api', name: t('devtools.utils.teslaApiRef', 'Tesla API ref'), desc: t('devtools.utils.teslaApiRefDesc', 'Tesla API ref desc'), icon: BookOpen, color: 'cyan', Component: TeslaApiRefTool },
    { id: 'regex', name: t('devtools.utils.regex', 'Regex tester'), desc: t('devtools.utils.regexDesc', 'Regex tester desc'), icon: Regex, color: 'red', Component: RegexTesterTool },
    { id: 'unix-perm', name: t('devtools.utils.unixPerm', 'Unix permissions'), desc: t('devtools.utils.unixPermMenuDesc', 'Unix perm desc'), icon: Lock, color: 'green', Component: UnixPermissionTool },
  ], [t])
}

/* ─── expandable tool card ────────────────────────────────────────────── */

const ExpandableToolCard = memo(function ExpandableToolCard({
  tool,
  expanded,
  onToggle,
}: {
  tool: ToolEntry
  expanded: boolean
  onToggle: (id: string) => void
}) {
  const Icon = tool.icon
  return (
    <Accordion
      title={tool.name}
      description={tool.desc}
      open={expanded}
      onOpenChange={() => onToggle(tool.id)}
      headerClassName="p-4"
      bodyClassName="p-4"
      icon={
        <span
          aria-hidden="true"
          className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', ICON_COLOR_MAP[tool.color] ?? ICON_COLOR_MAP.cyan)}
        >
          <Icon className="h-5 w-5" />
        </span>
      }
    >
      <div id={`devtools-tool-panel-${tool.id}`}>
        <tool.Component />
      </div>
    </Accordion>
  )
})
ExpandableToolCard.displayName = 'ExpandableToolCard'

/* ═══════════════════════════════════════════════════════════════════════
   Client Utilities Section — searchable grid
   ═══════════════════════════════════════════════════════════════════════ */

export function ClientUtilitiesSection() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const tools = useToolList()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tools
    return tools.filter(
      (tool) =>
        (tool.name ?? '').toLowerCase().includes(q) ||
        (tool.desc ?? '').toLowerCase().includes(q),
    )
  }, [tools, search])

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const searchLabel = t('devtools.searchTools', 'Search tools...')

  return (
    <div className="space-y-4">
      <UiInput
        type="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {filtered.map((tool) => (
            <ExpandableToolCard
              key={tool.id}
              tool={tool}
              expanded={expandedId === tool.id}
              onToggle={handleToggle}
            />
          ))}
        </div>
      ) : (
        <Text as="p" variant="bodySm" role="status" className="py-8 text-center">
          {t('devtools.noToolsFound', 'No tools match your search')}
        </Text>
      )}
    </div>
  )
}
