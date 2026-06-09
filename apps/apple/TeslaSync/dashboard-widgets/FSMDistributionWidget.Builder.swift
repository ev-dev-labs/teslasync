//
//  FSMDistributionWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0052 · FSMDistributionWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the data prep in
//  features/dashboard/widgets/FSMDistributionWidget.tsx (`stateColor` bucketing,
//  `buildDonutData`, `fmtDuration`, and the transitions slice). The duration
//  string is assembled from injected localized `h`/`m` unit suffixes (web
//  `fmtDuration(ms, t)` reads `t('…hr','h')`/`t('…min','m')`), and the feed
//  timestamp is delegated to the OS relative formatter (web `TimeStamp`). No
//  SwiftUI / transport here — this is the unit-tested core.
//

import Foundation

// MARK: - Number / duration / relative-time formatting

/// Locale-aware number + duration formatting that mirrors the web `fmtNumber`
/// (`Intl.NumberFormat`) and `fmtDuration` (ms → `"Xm"` / `"Xh Ym"`).
public enum FSMDistributionFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0 (the
    /// web helpers run every value through `safeNumber` first).
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(value, decimals)` — fixed fraction digits, grouped, rounding
    /// half away from zero to match `Intl.NumberFormat`. Backs the legend's
    /// `fmtInt(pct)` (decimals 0) and the tooltip's `fmtNumber(pct, 1)`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// Ports `fmtDuration(ms, t)` exactly: `totalMin = ms / 60000`,
    /// `hrs = floor(totalMin / 60)`, `mins = round(totalMin % 60)`; renders
    /// `"<mins><minuteUnit>"` when there are no whole hours, otherwise
    /// `"<hrs><hourUnit> <mins><minuteUnit>"`. The unit suffixes are injected so
    /// the localized `h`/`m` come from the P1/S10 facade (web `t(key, 'h'/'m')`).
    public static func duration(milliseconds: Double, hourUnit: String, minuteUnit: String) -> String {
        let total = safeNumber(milliseconds)
        let totalMinutes = total / 60000
        let hours = (totalMinutes / 60).rounded(.down)
        let minutes = totalMinutes.truncatingRemainder(dividingBy: 60).rounded()
        if hours == 0 {
            return "\(Int(minutes))\(minuteUnit)"
        }
        return "\(Int(hours))\(hourUnit) \(Int(minutes))\(minuteUnit)"
    }
}

/// Locale-aware relative timestamp for a transition row (web `TimeStamp` relative
/// format — "2h ago" / "5m ago" / "now"), delegated to the OS so it is localized
/// without hardcoded English. `now` is injectable for deterministic tests.
public enum FSMRelativeTime {
    public static func string(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Projection builder (port of the web stateColor / buildDonutData memos)

/// Pure adapter that turns cached FSM stats + transitions into the rendered
/// projection, faithfully reproducing the web component's `useMemo` pipeline.
public enum FSMDistributionBuilder {
    /// Classifies a state into a color bucket — the Swift port of the web
    /// `stateColor`: a case-insensitive match against the five known
    /// `STATE_COLORS` keys, with everything else (the web `?? '#6b7280'`) folding
    /// into `.other` (the same gray).
    public static func classify(state: String) -> FSMStateKind {
        switch state.lowercased() {
        case "driving": .driving
        case "charging": .charging
        case "asleep": .asleep
        case "idle": .idle
        case "offline": .offline
        default: .other
        }
    }

    /// Ports `buildDonutData(stats)`: keep only positive durations, derive the
    /// total, drop everything when the total is zero (web `if (total === 0) return []`),
    /// project each to `{ state, value, pct }`, then sort largest-first. The sort
    /// is stable, so equal durations keep their server order (matching the web
    /// object-key order the JS `sort` preserves).
    public static func buildSegments(durations: [FSMStateDuration]) -> [FSMDonutSegment] {
        let positive = durations.filter { FSMDistributionFormat.safeNumber($0.milliseconds) > 0 }
        let total = positive.reduce(0.0) { $0 + FSMDistributionFormat.safeNumber($1.milliseconds) }
        guard total > 0 else { return [] }
        let segments = positive.map { entry -> FSMDonutSegment in
            let value = FSMDistributionFormat.safeNumber(entry.milliseconds)
            return FSMDonutSegment(
                state: entry.state,
                milliseconds: value,
                percent: value / total * 100,
                kind: classify(state: entry.state)
            )
        }
        return segments.sorted { $0.milliseconds > $1.milliseconds }
    }

    /// Projects the raw transition log rows into feed items, coalescing a
    /// missing/blank from/to state to the universal "—" (web `tr.from_state ?? '—'`).
    /// Input order (newest-first, as the API returns) is preserved; the view caps
    /// the count per layout.
    public static func buildTransitions(rows: [FSMStateTransitionDTO]) -> [FSMTransitionItem] {
        rows.map { row in
            FSMTransitionItem(
                id: row.id,
                fromState: normalize(row.fromState),
                toState: normalize(row.toState),
                timestamp: row.timestamp
            )
        }
    }

    /// Builds the merged projection: donut segments + transition rows + the
    /// `hasData` flag (web `segments.length > 0`).
    public static func buildProjection(
        durations: [FSMStateDuration],
        rows: [FSMStateTransitionDTO]
    ) -> FSMDistributionProjection {
        let segments = buildSegments(durations: durations)
        let transitions = buildTransitions(rows: rows)
        return FSMDistributionProjection(segments: segments, transitions: transitions, hasData: !segments.isEmpty)
    }

    private static func normalize(_ state: String) -> String {
        let trimmed = state.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "—" : trimmed
    }
}
