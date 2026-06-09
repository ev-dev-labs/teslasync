//
//  VersionInfoWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0111 · VersionInfoWidget (Apple)
//
//  Pure, Foundation-only adapter: the cached DTO inputs (web useVersionInfo /
//  useCaptureStats), the `vitals` projection (1:1 port of the web
//  VersionInfoWidget.tsx body — defensive optional reads, truncatedSha, the
//  kvItems / statItems memos, formatBytes), the fmtNumber/fmtInt formatters, the
//  P1/S10 i18n facade, and the testable VoiceOver summary. No SwiftUI → it is
//  host-compilable and EXECUTED by the gate harness.
//

import Foundation

// MARK: - Cached DTO inputs (web `version.data` / `capture.data`)

/// The `/system/version` payload the widget renders, mirroring the web
/// `useVersionInfo` result. Only `chartVersion`/`goVersion`/`os`/`arch` are
/// strictly typed upstream; `buildDate`/`gitCommit`/`uptime` are read
/// defensively off the same object (web `(versionData as { … }).field`), so they
/// are optional here and fall through to the em dash when the server omits them.
public struct VersionInfoData: Sendable, Equatable {
    public var chartVersion: String?
    public var goVersion: String?
    public var buildDate: String?
    public var gitCommit: String?
    public var uptime: String?
    public var osName: String?
    public var arch: String?

    public init(
        chartVersion: String? = nil,
        goVersion: String? = nil,
        buildDate: String? = nil,
        gitCommit: String? = nil,
        uptime: String? = nil,
        osName: String? = nil,
        arch: String? = nil
    ) {
        self.chartVersion = chartVersion
        self.goVersion = goVersion
        self.buildDate = buildDate
        self.gitCommit = gitCommit
        self.uptime = uptime
        self.osName = osName
        self.arch = arch
    }
}

/// The telemetry-capture counters the widget reads, mirroring the web
/// `useCaptureStats` object (read defensively as numbers that default to 0).
public struct VersionCaptureStats: Sendable, Equatable {
    public var signalsPerSec: Double?
    public var messagesToday: Double?
    public var bytesProcessed: Double?
    public var avgLatencyMs: Double?

    public init(
        signalsPerSec: Double? = nil,
        messagesToday: Double? = nil,
        bytesProcessed: Double? = nil,
        avgLatencyMs: Double? = nil
    ) {
        self.signalsPerSec = signalsPerSec
        self.messagesToday = messagesToday
        self.bytesProcessed = bytesProcessed
        self.avgLatencyMs = avgLatencyMs
    }
}

/// One coalesced snapshot of the two independent web queries. The widget's "has
/// data" gate mirrors the web `hasData = version.data != null`, so the snapshot
/// is renderable only when `version` is present.
public struct VersionInfoSnapshot: Sendable, Equatable {
    public var version: VersionInfoData?
    public var capture: VersionCaptureStats?

    public init(version: VersionInfoData? = nil, capture: VersionCaptureStats? = nil) {
        self.version = version
        self.capture = capture
    }
}

// MARK: - Projected items (web `kvItems` / `statItems` memos)

/// One key/value row in the standard layout (web `KVList` item). `labelKey` +
/// `defaultLabel` resolve through the P1/S10 facade at the view; `value` is
/// pre-resolved. `isMono`/`isBold` carry the web `font-mono`/`font-bold` accents.
public struct VersionInfoKVItem: Sendable, Equatable, Identifiable {
    public var labelKey: String
    public var defaultLabel: String
    public var value: String
    public var isMono: Bool
    public var isBold: Bool

    public var id: String {
        labelKey
    }

    public init(labelKey: String, defaultLabel: String, value: String, isMono: Bool = false, isBold: Bool = false) {
        self.labelKey = labelKey
        self.defaultLabel = defaultLabel
        self.value = value
        self.isMono = isMono
        self.isBold = isBold
    }
}

/// One tile in the bottom stat grid (web `StatGridItem`). `value` is pre-formatted.
public struct VersionInfoStatItem: Sendable, Equatable, Identifiable {
    public var labelKey: String
    public var defaultLabel: String
    public var value: String

    public var id: String {
        labelKey
    }

    public init(labelKey: String, defaultLabel: String, value: String) {
        self.labelKey = labelKey
        self.defaultLabel = defaultLabel
        self.value = value
    }
}

/// The fully-derived view state — a 1:1 projection of the web component body's
/// defensive reads (`chart_version ?? '—'`, …), `truncatedSha`, and the capture
/// counters (each `?? 0`).
public struct VersionInfoVitals: Sendable, Equatable {
    public var chartVersion: String
    public var goVersion: String
    public var buildDate: String
    public var gitCommit: String?
    public var truncatedSha: String
    public var uptime: String
    public var osName: String
    public var arch: String
    public var signalsPerSec: Double
    public var messagesToday: Double
    public var bytesProcessed: Double
    public var avgLatency: Double
}

// MARK: - Projection (port of the web component body)

/// Pure adapter: cached `VersionInfoSnapshot` → `VersionInfoVitals` + the
/// `kvItems` / `statItems` builders. Reproduces the web defensive reads, the
/// `truncatedSha = gitSha?.slice(0, 7) ?? '—'`, and the `isWide` stat expansion.
public enum VersionInfoProjection {
    public static func vitals(from snapshot: VersionInfoSnapshot) -> VersionInfoVitals {
        let version = snapshot.version
        let capture = snapshot.capture
        let gitCommit = version?.gitCommit

        return VersionInfoVitals(
            chartVersion: nonEmpty(version?.chartVersion) ?? VersionInfoFormat.emDash,
            goVersion: nonEmpty(version?.goVersion) ?? VersionInfoFormat.emDash,
            buildDate: nonEmpty(version?.buildDate) ?? VersionInfoFormat.emDash,
            gitCommit: gitCommit,
            truncatedSha: truncatedSha(gitCommit),
            uptime: nonEmpty(version?.uptime) ?? VersionInfoFormat.emDash,
            osName: nonEmpty(version?.osName) ?? VersionInfoFormat.emDash,
            arch: nonEmpty(version?.arch) ?? VersionInfoFormat.emDash,
            signalsPerSec: capture?.signalsPerSec ?? 0,
            messagesToday: capture?.messagesToday ?? 0,
            bytesProcessed: capture?.bytesProcessed ?? 0,
            avgLatency: capture?.avgLatencyMs ?? 0
        )
    }

    /// The five web `kvItems` rows (Version[bold] / Build Date / Git SHA[mono] /
    /// Go Version / Uptime).
    public static func kvItems(from vitals: VersionInfoVitals) -> [VersionInfoKVItem] {
        [
            VersionInfoKVItem(
                labelKey: "widget.versionInfo.version", defaultLabel: "Version",
                value: vitals.chartVersion, isBold: true
            ),
            VersionInfoKVItem(
                labelKey: "widget.versionInfo.buildDate", defaultLabel: "Build Date",
                value: vitals.buildDate
            ),
            VersionInfoKVItem(
                labelKey: "widget.versionInfo.gitSha", defaultLabel: "Git SHA",
                value: vitals.truncatedSha, isMono: true
            ),
            VersionInfoKVItem(
                labelKey: "widget.versionInfo.goVersion", defaultLabel: "Go Version",
                value: vitals.goVersion
            ),
            VersionInfoKVItem(
                labelKey: "widget.versionInfo.uptime", defaultLabel: "Uptime",
                value: vitals.uptime
            )
        ]
    }

    /// The web `statItems` memo: two tiles always, plus Bytes Processed + Avg
    /// Latency when `isWide` (the web `if (isWide) items.push(...)`).
    public static func statItems(
        from vitals: VersionInfoVitals,
        isWide: Bool,
        locale: Locale = .current
    ) -> [VersionInfoStatItem] {
        var items: [VersionInfoStatItem] = [
            VersionInfoStatItem(
                labelKey: "widget.versionInfo.signalsPerSec", defaultLabel: "Signals/sec",
                value: VersionInfoFormat.number(vitals.signalsPerSec, decimals: 1, locale: locale)
            ),
            VersionInfoStatItem(
                labelKey: "widget.versionInfo.messagesToday", defaultLabel: "Messages Today",
                value: VersionInfoFormat.int(vitals.messagesToday, locale: locale)
            )
        ]
        if isWide {
            items.append(
                VersionInfoStatItem(
                    labelKey: "widget.versionInfo.bytesProcessed", defaultLabel: "Bytes Processed",
                    value: VersionInfoFormat.bytes(vitals.bytesProcessed, locale: locale)
                )
            )
            items.append(
                VersionInfoStatItem(
                    labelKey: "widget.versionInfo.avgLatency", defaultLabel: "Avg Latency",
                    value: VersionInfoFormat.latency(vitals.avgLatency, locale: locale)
                )
            )
        }
        return items
    }

    /// Web `truncatedSha = gitSha?.slice(0, 7) ?? '—'`: the first 7 chars of the
    /// commit hash, or the em dash when the server omits it.
    public static func truncatedSha(_ gitCommit: String?) -> String {
        guard let gitCommit else { return VersionInfoFormat.emDash }
        return String(gitCommit.prefix(7))
    }

    /// Treats an empty/whitespace string as absent so a blank API value falls
    /// through to the em dash rather than rendering an empty cell.
    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return value
    }
}

// MARK: - Formatters (port of lib/numberFormat.ts + the local formatBytes)

/// Locale-aware number formatting that matches the web `fmtNumber` / `fmtInt`
/// output, plus the widget's `formatBytes` byte-scaler and the capture-stat cells.
public enum VersionInfoFormat {
    /// Shared "no value" glyph (web `'—'`).
    public static let emDash = "—"

    /// Locale-aware fixed-precision decimal (web `fmtNumber(v, decimals)`).
    /// Non-finite values resolve to 0, mirroring the web `safeNumber`.
    public static func number(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(safe)
    }

    /// Locale-aware grouped integer (web `fmtInt` = `fmtNumber(v, 0)`).
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// The `signalsPerSec` / `avgLatency` cell with the " ms" suffix (web
    /// `${fmtNumber(avgLatency, 1)} ms`).
    public static func latency(_ value: Double, locale: Locale = .current) -> String {
        "\(number(value, decimals: 1, locale: locale)) ms"
    }

    /// Port of the widget's `formatBytes`: B (fmtInt) → KB/MB (1 dp) → GB (2 dp),
    /// switching at each 1024 boundary.
    public static func bytes(_ value: Double, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        let kib = 1024.0
        let mib = kib * 1024
        let gib = mib * 1024
        if safe < kib { return "\(int(safe, locale: locale)) B" }
        if safe < mib { return "\(number(safe / kib, decimals: 1, locale: locale)) KB" }
        if safe < gib { return "\(number(safe / mib, decimals: 1, locale: locale)) MB" }
        return "\(number(safe / gib, decimals: 2, locale: locale)) GB"
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback (no
/// hardcoded literals). Keys live in the per-surface "VersionInfoWidget" table,
/// folded into the app `Localizable.xcstrings` at integration time. The SwiftUI
/// `text(_:_:)` convenience is added in `VersionInfoWidget.Model.swift`.
public enum VersionInfoStrings {
    public static let table = "VersionInfoWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the content. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum VersionInfoAccessibility {
    public static func summary(from vitals: VersionInfoVitals, isWide: Bool, locale: Locale = .current) -> String {
        var parts: [String] = [VersionInfoStrings.string("widget.versionInfo.title", "Version Info")]

        for item in VersionInfoProjection.kvItems(from: vitals) {
            parts.append("\(VersionInfoStrings.string(item.labelKey, item.defaultLabel)): \(item.value)")
        }

        if isWide {
            parts.append("\(VersionInfoStrings.string("widget.versionInfo.os", "OS")): \(vitals.osName)")
            parts.append("\(VersionInfoStrings.string("widget.versionInfo.arch", "Arch")): \(vitals.arch)")
        }

        for item in VersionInfoProjection.statItems(from: vitals, isWide: isWide, locale: locale) {
            parts.append("\(VersionInfoStrings.string(item.labelKey, item.defaultLabel)): \(item.value)")
        }

        return parts.joined(separator: ". ")
    }
}
