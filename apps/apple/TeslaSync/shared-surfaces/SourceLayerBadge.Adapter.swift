//
//  SourceLayerBadge.Adapter.swift
//  TeslaSync — P4 shared surface · 0105 · SourceLayerBadge (Apple)
//
//  The testable, dependency-light core for the source-layer badge — the SwiftUI parity of
//  `components/data-display/SourceLayerBadge.tsx`. Everything here is pure (Foundation only): the
//  source-layer truth table (the verbatim port of the web `STYLE` map keyed by `(source ?? 'unknown')
//  .toLowerCase()`), the age-label builder (the verbatim port of the web `formatAge`, routed through
//  the i18n facade), the tooltip composer (the port of the web `desc (age: …)` string), the fetch
//  lifecycle, the surface metadata (diagnostics slug), and the VoiceOver label builder. No store, no
//  bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web surface is a debugger-only badge that names where a signal value came from —
//  `l1` (in-process SignalStore, freshest), `l2` (Redis cross-pod cache), `log` (signal_log replay),
//  `stale` (Redis value past the freshness window), and the `unknown` fallback (the "—" glyph) for a
//  null / unrecognized source. An optional `ageMs` surfaces in the tooltip. The badge is intentionally
//  tiny (a glyph + tooltip) so it fits in dense table cells. All names are prefixed `SourceLayerBadge`
//  so the surface stays self-contained in the single app module (the bare `SignalSourceLayer` already
//  belongs to the SnapshotInspector surface).
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity resolver. The web
/// source only routes the layer descriptions and the "age" word through `t()` (the L1 / L2 / LOG /
/// STALE / — glyphs are hardcoded); native code holds no English literals, so the glyphs are lifted
/// into keys here with the verbatim web text as the fallback.
public typealias SourceLayerBadgeResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Source layer (verbatim port of the web `STYLE` keys)

/// The provenance band of a signal value — the native mirror of the web `SignalSource` union the
/// badge renders. `l1` is the in-process SignalStore (freshest), `l2` is the Redis cross-pod cache
/// (legacy, freshness unknown), `log` is a signal_log replay (durable history), `stale` is a
/// Redis-backed value past the 2-minute freshness window, and `unknown` is the null / unrecognized
/// fallback (the web `STYLE.unknown`, the "—" glyph).
public enum SourceLayerBadgeKind: String, Sendable, Equatable, CaseIterable {
    case l1
    case l2
    case log
    case stale
    case unknown

    /// Resolves a raw source string to a layer — the verbatim port of the web
    /// `key = (source ?? 'unknown').toLowerCase(); STYLE[key] ?? STYLE.unknown`. A `nil`, empty, or
    /// unrecognized value folds to ``unknown`` (the web fallback), and the match is case-insensitive
    /// (web `.toLowerCase()`), so `"L1"` and `"l1"` both resolve to ``l1``.
    public init(source: String?) {
        let key = (source ?? "unknown").lowercased()
        self = SourceLayerBadgeKind(rawValue: key) ?? .unknown
    }

    /// The i18n key for the badge glyph (web `STYLE[key].label`, lifted into a key for native parity).
    public var labelKey: String {
        "sourceLayer.\(rawValue).label"
    }

    /// The web `STYLE[key].label` glyph, used as the i18n fallback: L1 / L2 / LOG / STALE / —.
    public var labelFallback: String {
        switch self {
        case .l1: "L1"
        case .l2: "L2"
        case .log: "LOG"
        case .stale: "STALE"
        case .unknown: "—"
        }
    }

    /// The i18n key for the layer description (the verbatim web `STYLE[key].descKey`).
    public var descriptionKey: String {
        "sourceLayer.\(rawValue).desc"
    }

    /// The web `STYLE[key].descFallback`, used as the i18n fallback — the long-form tooltip text.
    public var descriptionFallback: String {
        switch self {
        case .l1: "Read from the in-process SignalStore (hot path, freshest)."
        case .l2: "Read from Redis cross-pod cache (legacy entry; freshness unknown)."
        case .log: "Replayed from signal_log (durable history)."
        case .stale: "Redis-backed value older than the 2-minute freshness window."
        case .unknown: "Source layer unknown."
        }
    }

    /// The localized glyph for the layer (web `style.label`), via the resolver.
    public func label(_ strings: SourceLayerBadgeResolve) -> String {
        strings(labelKey, labelFallback)
    }

    /// The localized description for the layer (web `t(style.descKey, style.descFallback)`).
    public func description(_ strings: SourceLayerBadgeResolve) -> String {
        strings(descriptionKey, descriptionFallback)
    }
}

// MARK: - Fetch lifecycle (P4 leaf contract around the web presentational badge)

/// The resolution state of the source feed backing the badge — the native shape of the host's fetch
/// lifecycle around the web `source` / `ageMs` props. `loading` shows the neutral skeleton chip,
/// `failed` shows the retry chip, and `resolved` lets the source decide the layer (a resolved but
/// `nil` source is the "unknown"/empty readout, the "—" glyph, never a blank box).
public enum SourceLayerBadgeFetchStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case resolved
    case failed
}

// MARK: - Age label (verbatim port of the web `formatAge`, i18n-routed)

/// The age-label builder — the verbatim port of the web `formatAge(ms)`:
///   `nil`/non-finite → nil; `< 1000` → "{round(ms)} ms"; `< 60_000` → "{(ms/1000).toFixed(1)} s";
///   `< 3_600_000` → "{round(ms/60_000)} min"; `< 86_400_000` → "{(ms/3_600_000).toFixed(1)} h";
///   else "{(ms/86_400_000).toFixed(1)} d".
/// Every unit literal resolves through the i18n facade with the web string as the fallback; the
/// numeric value is inserted with a `%@` token and formatted with a fixed `.` decimal so the build is
/// locale- and width-safe.
public enum SourceLayerBadgeAgeFormatter {
    public static func label(ms: Double?, strings: SourceLayerBadgeResolve) -> String? {
        guard let ms, ms.isFinite else { return nil }
        if ms < 1000 {
            return String(format: strings("sourceLayer.age.ms", "%@ ms"), integer(ms))
        }
        if ms < 60000 {
            return String(format: strings("sourceLayer.age.seconds", "%@ s"), oneDecimal(ms / 1000))
        }
        if ms < 3_600_000 {
            return String(format: strings("sourceLayer.age.minutes", "%@ min"), integer(ms / 60000))
        }
        if ms < 86_400_000 {
            return String(format: strings("sourceLayer.age.hours", "%@ h"), oneDecimal(ms / 3_600_000))
        }
        return String(format: strings("sourceLayer.age.days", "%@ d"), oneDecimal(ms / 86_400_000))
    }

    /// The web `Math.round(value)` rendered as a string (round half away from zero matches JS for the
    /// non-negative ages the badge surfaces).
    private static func integer(_ value: Double) -> String {
        "\(Int(value.rounded()))"
    }

    /// The web `value.toFixed(1)` — a fixed one-decimal, `.`-separated string (locale-independent).
    private static func oneDecimal(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}

// MARK: - Tooltip (verbatim port of the web `desc (age: …)` composer)

/// The tooltip composer — the verbatim port of the web
/// `ageText ? `${desc} (${t('sourceLayer.age','age')}: ${ageText})` : desc`. The age word resolves
/// through the i18n facade (web `t('sourceLayer.age', 'age')`).
public enum SourceLayerBadgeTooltipBuilder {
    public static func tooltip(description: String, ageText: String?, ageLabel: String) -> String {
        guard let ageText else { return description }
        return "\(description) (\(ageLabel): \(ageText))"
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum SourceLayerBadgeMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SourceLayerBadge"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver string from already-localized parts, so the spoken content is
/// asserted without rendering the view. The badge voices its tooltip (the layer description plus the
/// optional age — the web `title`), suffixed with the offline note when the snapshot is offline so a
/// non-sighted user learns the badge reflects the last-known value.
public enum SourceLayerBadgeAccessibility {
    public static func label(tooltip: String, offlineNote: String?) -> String {
        guard let offlineNote else { return tooltip }
        return "\(tooltip), \(offlineNote)"
    }
}
