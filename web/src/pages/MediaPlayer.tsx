import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getMediaData, getMediaLatest } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Music, Volume2, Play, Pause, Square, Radio, Headphones, BarChart3, Clock } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts'
import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'

/* ── Chart tooltip (same pattern as TirePressure) ─────────────────────────── */

interface TooltipPayload { name: string; value: number; color?: string }
function ChartTooltip({ active, payload, label, unit = '' }: { active?: boolean; payload?: TooltipPayload[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value?.toFixed(1)} {unit}
        </p>
      ))}
    </div>
  )
}

/* ── Volume gauge (mirrors PressureGauge) ─────────────────────────────────── */

function VolumeGauge({ value, max = 11 }: { value: number | null; max?: number }) {
  const vol = value ?? 0
  const pct = Math.min(100, Math.max(0, (vol / max) * 100))
  const isLow = vol > 0 && vol <= 3
  const isHigh = vol >= 9
  const color = isHigh ? 'text-neon-red' : isLow ? 'text-neon-cyan' : 'text-neon-green'
  const bg = isHigh ? 'bg-neon-red/20' : isLow ? 'bg-neon-cyan/20' : 'bg-neon-green/20'
  const statusLabel = vol === 0 ? 'Muted' : isHigh ? 'Loud' : isLow ? 'Quiet' : 'Normal'

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Volume</p>
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round" className={color} />
        </svg>
        <div className="flex flex-col items-center">
          <Volume2 className={clsx('h-5 w-5 mb-1', color)} />
          <span className={clsx('text-2xl font-bold', color)}>{vol > 0 ? vol : '--'}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {vol === 0 ? (
          <span className="text-xs text-[var(--text-muted)]">No data</span>
        ) : (
          <>
            <Volume2 className={clsx('h-3.5 w-3.5', color)} />
            <span className={clsx('text-xs', color)}>{statusLabel}</span>
          </>
        )}
      </div>
      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', bg, color)}>
        {vol > 0 ? `${vol} / ${max}` : 'N/A'}
      </span>
    </div>
  )
}

/* ── Playback status badge ────────────────────────────────────────────────── */

function StatusBadge({ status }: { status?: string }) {
  // Normalize protobuf enum values (MediaStatusPlaying → playing)
  const raw = cleanNil(status) ?? ''
  const s = raw.toLowerCase().replace('mediastatus', '')
  if (s === 'playing') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-neon-green/20 text-neon-green">
        <Play className="h-3 w-3" /> Playing
      </span>
    )
  }
  if (s === 'paused') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-neon-amber/20 text-neon-amber">
        <Pause className="h-3 w-3" /> Paused
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-white/10 text-[var(--text-muted)]">
      <Square className="h-3 w-3" /> {s || 'Stopped'}
    </span>
  )
}

/* ── Progress bar for elapsed / duration ──────────────────────────────────── */

function formatSeconds(s: number | undefined | null): string {
  if (s == null || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function ProgressBar({ elapsed, duration }: { elapsed?: number; duration?: number }) {
  const pct = duration && duration > 0 ? Math.min(100, ((elapsed ?? 0) / duration) * 100) : 0
  return (
    <div className="w-full">
      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-neon-cyan transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatSeconds(elapsed)}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatSeconds(duration)}</span>
      </div>
    </div>
  )
}

/* ── Now‑playing album art placeholder ────────────────────────────────────── */

function AlbumArtPlaceholder({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
      <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="mpDiscGrad" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
            <stop offset="60%" stopColor="#0f172a" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="1" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="44" fill="url(#mpDiscGrad)" stroke="#22d3ee" strokeWidth="0.8" strokeOpacity="0.3" />
        {[35, 28, 20, 12].map(r => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#22d3ee" strokeWidth="0.3" strokeOpacity="0.15" />
        ))}
        <circle cx="50" cy="50" r="8" fill="#0f172a" stroke="#22d3ee" strokeWidth="1" strokeOpacity="0.5" />
        <circle cx="50" cy="50" r="3" fill="#22d3ee" fillOpacity="0.6" />
        {isPlaying && (
          <circle cx="50" cy="50" r="44" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="6 6" opacity="0.4">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="4s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
      <Music className="absolute h-6 w-6 text-neon-cyan/40" />
    </div>
  )
}

/* ── Source icon helper ────────────────────────────────────────────────────── */

function SourceIcon({ source, className }: { source?: string; className?: string }) {
  const s = (source ?? '').toLowerCase()
  if (s.includes('radio') || s.includes('fm') || s.includes('am')) return <Radio className={className} />
  if (s.includes('bluetooth') || s.includes('phone')) return <Headphones className={className} />
  return <Music className={className} />
}

/** Filter out Go nil string representations */
import { cleanNil } from '../lib/cleanNil'

/* ── Pie chart colors ─────────────────────────────────────────────────────── */

const PIE_COLORS = ['#00f0ff', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6']

/* ══════════════════════════════════════════════════════════════════════════ */

export default function MediaPlayer() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['media-latest', vehicleId],
    queryFn: () => getMediaLatest(vehicleId!),
    enabled: vehicleId !== null,
    refetchInterval: 10000,
  })

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['media-history', vehicleId],
    queryFn: () => getMediaData(vehicleId!, 200),
    enabled: vehicleId !== null,
    refetchInterval: 10000,
  })

  /* ── Derived data ──────────────────────────────────────────────────────── */

  const volumeChartData = useMemo(() => {
    if (!history || history.length === 0) return []
    return history.slice().reverse().map(s => ({
      time: formatDateTime(s.created_at),
      volume: s.audio_volume ?? null,
    }))
  }, [history])

  const sourceDistribution = useMemo(() => {
    if (!history || history.length === 0) return []
    const counts: Record<string, number> = {}
    for (const s of history) {
      const src = cleanNil(s.playback_source) || 'Unknown'
      counts[src] = (counts[src] || 0) + 1
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [history])

  const listeningStats = useMemo(() => {
    if (!history || history.length === 0) return { uniqueTracks: 0, topSource: 'N/A', avgVolume: 0 }
    const tracks = new Set<string>()
    const sourceCounts: Record<string, number> = {}
    let volumeSum = 0
    let volumeCount = 0
    for (const s of history) {
      if (s.now_playing_title) tracks.add(`${s.now_playing_title}::${s.now_playing_artist ?? ''}`)
      const src = s.playback_source && s.playback_source !== '<nil>' ? s.playback_source : 'Unknown'
      sourceCounts[src] = (sourceCounts[src] || 0) + 1
      if (s.audio_volume != null) {
        volumeSum += s.audio_volume
        volumeCount++
      }
    }
    const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'N/A'
    return {
      uniqueTracks: tracks.size,
      topSource,
      avgVolume: volumeCount > 0 ? volumeSum / volumeCount : 0,
    }
  }, [history])

  const isPlaying = cleanNil(latest?.playback_status)?.toLowerCase() === 'playing'
  const volumeMax = latest?.audio_volume_max ?? 11

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <FadeIn>
      {/* Header + vehicle selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Media Player" subtitle="Now playing, volume, and playback history" icon={<Music className="h-7 w-7 text-neon-cyan" />} />
        {vehicles && vehicles.length > 1 && (
          <select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            className="glass-card px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          >
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
          </select>
        )}
      </div>

      {/* ── Now Playing Card ────────────────────────────────────────────── */}
      {loadingLatest ? (
        <Skeleton className="h-56 rounded-xl mb-6 sm:mb-8" />
      ) : latest ? (
        <GlassPanel className="p-5 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Headphones className="h-4 w-4 text-neon-cyan" /> Now Playing
          </h3>
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            <AlbumArtPlaceholder isPlaying={isPlaying} />
            <div className="flex-1 min-w-0 w-full">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {cleanNil(latest.now_playing_title) || 'No title'}
                  </p>
                  {cleanNil(latest.now_playing_artist) && (
                    <p className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                      {cleanNil(latest.now_playing_artist)}
                    </p>
                  )}
                  {cleanNil(latest.now_playing_album) && (
                    <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {cleanNil(latest.now_playing_album)}
                    </p>
                  )}
                </div>
                <StatusBadge status={cleanNil(latest.playback_status)} />
              </div>

              {cleanNil(latest.now_playing_station) && (
                <div className="flex items-center gap-1.5 mb-3">
                  <Radio className="h-3.5 w-3.5 text-neon-cyan" />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{cleanNil(latest.now_playing_station)}</span>
                </div>
              )}

              {cleanNil(latest.playback_source) && (
                <div className="flex items-center gap-1.5 mb-3">
                  <SourceIcon source={latest.playback_source} className="h-3.5 w-3.5 text-neon-cyan" />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Source: {cleanNil(latest.playback_source)}</span>
                </div>
              )}

              <ProgressBar elapsed={latest.now_playing_elapsed} duration={latest.now_playing_duration} />
            </div>
          </div>
        </GlassPanel>
      ) : (
        <GlassPanel className="p-6 mb-6 sm:mb-8 flex items-center justify-center h-40">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No media data available</p>
        </GlassPanel>
      )}

      {/* ── Volume Gauge + Listening Stats ──────────────────────────────── */}
      {loadingLatest ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <VolumeGauge value={latest?.audio_volume ?? null} max={volumeMax} />

          <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Unique Tracks</p>
            <div className="relative w-24 h-24 flex items-center justify-center">
              <Music className="absolute h-10 w-10 text-neon-cyan/10" />
              <span className="text-3xl font-bold text-neon-cyan">{listeningStats.uniqueTracks}</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-neon-cyan/20 text-neon-cyan">tracks seen</span>
          </div>

          <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Top Source</p>
            <div className="relative w-24 h-24 flex items-center justify-center">
              <SourceIcon source={listeningStats.topSource} className="absolute h-10 w-10 text-neon-purple/10" />
              <span className="text-lg font-bold text-neon-purple text-center leading-tight">{listeningStats.topSource}</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-neon-purple/20 text-neon-purple">most used</span>
          </div>

          <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Avg Volume</p>
            <div className="relative w-24 h-24 flex items-center justify-center">
              <Volume2 className="absolute h-10 w-10 text-neon-green/10" />
              <span className="text-3xl font-bold text-neon-green">{listeningStats.avgVolume.toFixed(1)}</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-neon-green/20 text-neon-green">average level</span>
          </div>
        </div>
      )}

      {/* ── Playback History Table ──────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Clock className="h-4 w-4 text-neon-cyan" /> Playback History
        </h3>
        {loadingHistory ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !history || history.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">No playback history available</div>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                  <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-secondary)' }}>Time</th>
                  <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-secondary)' }}>Title</th>
                  <th className="py-2 px-3 font-medium hidden sm:table-cell" style={{ color: 'var(--text-secondary)' }}>Artist</th>
                  <th className="py-2 px-3 font-medium hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Source</th>
                  <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-secondary)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map(row => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'var(--glass-border)' }}>
                    <td className="py-2 px-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="py-2 px-3 max-w-[180px] truncate" style={{ color: 'var(--text-primary)' }}>
                      {cleanNil(row.now_playing_title) || '—'}
                    </td>
                    <td className="py-2 px-3 max-w-[140px] truncate hidden sm:table-cell" style={{ color: 'var(--text-secondary)' }}>
                      {cleanNil(row.now_playing_artist) || '—'}
                    </td>
                    <td className="py-2 px-3 hidden md:table-cell">
                      <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                        <SourceIcon source={row.playback_source} className="h-3 w-3 text-neon-cyan" />
                        {cleanNil(row.playback_source) || '—'}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge status={cleanNil(row.playback_status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      {/* ── Volume Over Time Chart ─────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <BarChart3 className="h-4 w-4 text-neon-cyan" /> Volume Over Time
        </h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : volumeChartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No volume history data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={volumeChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, volumeMax]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `${v}`} />
              <Tooltip content={<ChartTooltip unit="" />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="volume" name="Volume" stroke="#00f0ff" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ── Source Distribution Pie Chart ───────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Radio className="h-4 w-4 text-neon-cyan" /> Source Distribution
        </h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : sourceDistribution.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No source data available</div>
        ) : (
          <div className="flex flex-col md:flex-row items-center gap-6">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={sourceDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                  nameKey="name"
                  stroke="none"
                >
                  {sourceDistribution.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip unit="plays" />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>

            <div className="flex flex-col gap-2 min-w-[140px]">
              {sourceDistribution.map((entry, idx) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                  <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{entry.name}</span>
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassPanel>

      {/* ── Listening Stats Summary ─────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <BarChart3 className="h-4 w-4 text-neon-cyan" /> Listening Stats
        </h3>
        {loadingHistory ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="glass-card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-neon-cyan/10 flex items-center justify-center">
                <Music className="h-5 w-5 text-neon-cyan" />
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Unique Tracks</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{listeningStats.uniqueTracks}</p>
              </div>
            </div>

            <div className="glass-card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-neon-purple/10 flex items-center justify-center">
                <Headphones className="h-5 w-5 text-neon-purple" />
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Most Played Source</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{listeningStats.topSource}</p>
              </div>
            </div>

            <div className="glass-card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-neon-green/10 flex items-center justify-center">
                <Volume2 className="h-5 w-5 text-neon-green" />
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Average Volume</p>
                <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{listeningStats.avgVolume.toFixed(1)}<span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}> / {volumeMax}</span></p>
              </div>
            </div>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
