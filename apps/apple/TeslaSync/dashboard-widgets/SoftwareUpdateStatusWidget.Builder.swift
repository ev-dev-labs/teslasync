//
//  SoftwareUpdateStatusWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  Pure parser + formatting primitives — the deterministic core of the
//  cached→projection adapter, a faithful Swift port of the helpers in
//  features/dashboard/widgets/SoftwareUpdateStatusWidget.tsx (the `updateStatus`
//  memo, the `${pct}%` / `~${duration}` template-literal number rendering, the
//  stage→chip mapping, and the `MetricBar` fill maths). The projection assembly
//  lives in SoftwareUpdateStatusWidget.Projection.swift. No SwiftUI / transport.
//

import Foundation

/// Pure adapters that derive the stage + format the update fields. Mirrors the web
/// source exactly so iOS, iPadOS, macOS, and the web render the same version
/// strings, percentages, and chips.
public enum SoftwareStatusProjectionBuilder {
    // MARK: Version narrowing (web truthiness)

    /// Web `!updateVersion` / `{version || '—'}` truthiness: an empty string is
    /// falsy, so it narrows to `nil`; any other string is kept verbatim (a
    /// whitespace-only string stays truthy, matching JS).
    static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// Web `currentVersion = state?.software_version ?? '—'` followed by the
    /// display `{version || '—'}` — an absent or empty version renders `"—"`.
    static func displayVersion(_ value: String?) -> String {
        nonEmpty(value) ?? "—"
    }

    // MARK: Stage (web `updateStatus` useMemo)

    /// Faithful port of the web `updateStatus` memo. Order matters: an in-flight
    /// install wins over an in-flight download, then the terminal `=== 100`
    /// checks, then the generic "available". `nil`/empty `updateVersion` short
    /// circuits to `.upToDate` (web `if (!updateVersion)`).
    static func updateStage(
        updateVersion: String?,
        downloadPct: Double?,
        installPct: Double?
    ) -> SoftwareStatusStage {
        guard nonEmpty(updateVersion) != nil else { return .upToDate }
        if let installPct, installPct > 0, installPct < 100 { return .installing }
        if let downloadPct, downloadPct > 0, downloadPct < 100 { return .downloading }
        if let installPct, installPct == 100 { return .installed }
        if let downloadPct, downloadPct == 100 { return .ready }
        return .available
    }

    // MARK: Stage → chip (web `StatusBadgeSmall` config map)

    /// Web `StatusBadgeSmall` config: the stage's chip label + semantic variant.
    static func badge(for stage: SoftwareStatusStage) -> SoftwareStatusBadge {
        switch stage {
        case .upToDate:
            SoftwareStatusBadge(
                label: SoftwareStatusText("widget.statusUpToDate", "Up to date"),
                variant: .success
            )
        case .available:
            SoftwareStatusBadge(
                label: SoftwareStatusText("widget.statusAvailable", "Available"),
                variant: .info
            )
        case .downloading:
            SoftwareStatusBadge(
                label: SoftwareStatusText("widget.statusDownloading", "Downloading"),
                variant: .warning
            )
        case .ready:
            SoftwareStatusBadge(
                label: SoftwareStatusText("widget.statusReady", "Ready"),
                variant: .info
            )
        case .installing:
            SoftwareStatusBadge(
                label: SoftwareStatusText("widget.statusInstalling", "Installing"),
                variant: .warning
            )
        case .installed:
            SoftwareStatusBadge(
                label: SoftwareStatusText("widget.statusInstalled", "Installed"),
                variant: .success
            )
        }
    }

    // MARK: Progress bar (web `MetricBar`)

    /// Web progress `MetricBar` — rendered only for the `.downloading` /
    /// `.installing` stages, and only when the matching percent cell is present
    /// (web `downloadPct != null` / `installPct != null`). Cyan download bar,
    /// violet install bar.
    static func progress(
        stage: SoftwareStatusStage,
        downloadPct: Double?,
        installPct: Double?
    ) -> SoftwareStatusProgress? {
        switch stage {
        case .downloading:
            guard let downloadPct else { return nil }
            return SoftwareStatusProgress(
                kind: .downloading,
                fraction: fraction(downloadPct),
                percentText: percentText(downloadPct),
                label: SoftwareStatusText("widget.downloading", "Downloading")
            )
        case .installing:
            guard let installPct else { return nil }
            return SoftwareStatusProgress(
                kind: .installing,
                fraction: fraction(installPct),
                percentText: percentText(installPct),
                label: SoftwareStatusText("widget.installing", "Installing")
            )
        default:
            return nil
        }
    }

    /// Web `MetricBar` fill — `Math.min((value / max) * 100, 100)` with `max = 100`,
    /// expressed as a `0...1` fraction and clamped low (CSS clamps a negative width
    /// to 0).
    static func fraction(_ percent: Double) -> Double {
        guard percent.isFinite else { return percent > 0 ? 1 : 0 }
        return Swift.min(Swift.max(percent / 100, 0), 1)
    }

    // MARK: Number rendering (web template-literal `${n}`)

    /// Web `${pct}%` — the raw (un-clamped, un-grouped) percent followed by `%`.
    static func percentText(_ percent: Double) -> String {
        jsNumberString(percent) + "%"
    }

    /// Web `~${expectedDuration}` — a leading tilde + the raw minute count.
    static func durationText(_ minutes: Double) -> String {
        "~" + jsNumberString(minutes)
    }

    /// JavaScript `String(Number)` parity used by the template literals: an integral
    /// finite value renders with no decimal point (`String(47) === "47"`); a
    /// fractional value keeps its decimals (`String(47.5) === "47.5"`). No locale
    /// grouping — the web source interpolates these verbatim, never through `Intl`.
    static func jsNumberString(_ value: Double) -> String {
        guard value.isFinite else {
            return value > 0 ? "Infinity" : (value < 0 ? "-Infinity" : "NaN")
        }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }
}
