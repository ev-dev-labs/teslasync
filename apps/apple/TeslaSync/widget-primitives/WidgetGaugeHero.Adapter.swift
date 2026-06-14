//
//  WidgetGaugeHero.Adapter.swift
//  TeslaSync — P4 widget primitive · 0007 · WidgetGaugeHero (Apple)
//
//  The Foundation-only core for the gauge hero — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetGaugeHero.tsx` together with the `RadialGauge` it composes
//  (`components/charts/RadialGauge.tsx`). This file owns the surface identity (the diagnostics slug), the
//  gauge config (``GaugeHeroConfig``) + its semantic tint, the supporting stat (``GaugeHeroStat``), the
//  props (``WidgetGaugeHeroInput``), the view-ready ring (``GaugeRingModel``) and stat (``GaugeStatModel``),
//  the resolved layout (``WidgetGaugeHeroLayout``), the number formatter that ports the web
//  `fmtNumber` + the `Number.isInteger(clamped) ? 0 : globalPrecision` decimals rule, and the pure
//  ``WidgetGaugeHeroProjector`` that ports the web render decision (the `compact ? 70 : 100` size, the
//  `clamp(value, 0, max)` + `clamped / max` arc fraction, and the `!compact && stats.length > 0` stats
//  gate). No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<WidgetGaugeHero>` is a PURE presentational widget primitive (a shared
//  widget building block). It takes its data as plain props (`gauge`, the optional `stats`, `compact`,
//  `children`) and renders, with no fetch, no React-Query cache, and no Promise — so it has NO loading,
//  error, stale, or offline branch (there is nothing to fetch, fail, age, or lose connectivity to; the host
//  widget that owns the query renders those). Inventing such chrome would fabricate states the source does
//  not have, so this surface reproduces only the source's REAL branches — exactly as the sibling
//  presentational primitives WidgetStatGrid (0010), WidgetComparisonCard (0003), and MetricCard (0095) did.
//  The real branches: the always-present gauge ring (the web always renders `<RadialGauge>`), the optional
//  supporting stats row (web `!compact && stats && stats.length > 0`), and the optional accessory slot (web
//  `!compact && children`). There is deliberately NO empty leaf — the gauge ring is always the content, so
//  the surface never renders a blank box even with no stats. A `max <= 0` config is guarded to a zero-fill
//  ring (never a NaN arc) as a native null-safety hardening of the web `clamped / max`.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetGaugeHeroSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetGaugeHero"
}

// MARK: - GaugeTint (web `gauge.color: string`)

/// The gauge's semantic color — the native, theme-aware projection of the web `GaugeHeroConfig.color`
/// string. The web forwards an arbitrary CSS color (e.g. `#3b82f6`) to the ring stroke; porting raw hex is
/// forbidden (no raw color literals), so — exactly as ``StatValueTone`` (0010) maps the web `valueColor?`
/// and MetricCard (0095) maps `neonColorMap[color]` — this enum maps the host's intent to a P1/S9 token so
/// the arc recolors across light / dark / high-contrast. The default is ``accent`` (the web `'#3b82f6'`
/// default tone).
public enum GaugeTint: Sendable, Equatable, CaseIterable {
    case accent
    case success
    case warning
    case danger
    case info
    case battery
    case energy
    case speed
    case regen
    case temperature
    case power
}

// MARK: - GaugeHeroConfig (web `GaugeHeroConfig`)

/// The hero gauge's configuration — the native peer of the web `GaugeHeroConfig` (`value`, `max`, `label`,
/// `unit`, `color`). `value` and `max` are raw numerics (clamped + fractioned by the projector, exactly
/// like `RadialGauge`); `label` and `unit` are caller-supplied, already-localized strings rendered verbatim;
/// `tint` is the semantic color (web `color`, mapped to a token).
public struct GaugeHeroConfig: Sendable, Equatable {
    /// The current reading (web `value`) — clamped to `0...max` before display.
    public let value: Double
    /// The full-scale maximum (web `max`) — the denominator of the arc fraction.
    public let max: Double
    /// The gauge caption rendered below the ring (web `label`).
    public let label: String
    /// The trailing unit affix shown next to the centered value (web `unit`); empty renders no affix.
    public let unit: String
    /// The arc's semantic color (web `color`), defaulting to ``GaugeTint/accent``.
    public let tint: GaugeTint

    public init(value: Double, max: Double, label: String, unit: String = "", tint: GaugeTint = .accent) {
        self.value = value
        self.max = max
        self.label = label
        self.unit = unit
        self.tint = tint
    }
}

// MARK: - GaugeHeroStat (web `GaugeHeroStat`)

/// One supporting stat shown beneath the gauge — the native peer of the web `GaugeHeroStat`. `value` is the
/// already-formatted display string (the web `value: string | number`, formatted by the caller at the
/// display boundary per the SI-cutover unit rules); `unit` is the optional trailing affix (web `unit?`).
public struct GaugeHeroStat: Sendable, Equatable {
    /// The stat label (web `label`) — caller-supplied + already localized, rendered verbatim.
    public let label: String
    /// The already-formatted stat value (web `value`).
    public let value: String
    /// The optional trailing unit affix (web `unit?`); `nil` / empty renders no affix.
    public let unit: String?

    public init(label: String, value: String, unit: String? = nil) {
        self.label = label
        self.value = value
        self.unit = unit
    }
}

// MARK: - WidgetGaugeHeroInput (web props)

/// The component's props — the native peer of `WidgetGaugeHeroProps` (minus `children`, which is a view
/// slot supplied at the SwiftUI layer). A value type so the view, the state-holder, and the pure projection
/// agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply when a reused gauge
/// rebinds.
public struct WidgetGaugeHeroInput: Sendable, Equatable {
    /// The hero gauge configuration (web `gauge`).
    public let gauge: GaugeHeroConfig
    /// The supporting stats (web `stats?`); an empty array renders no stats row.
    public let stats: [GaugeHeroStat]
    /// Whether to render the condensed variant (web `compact`) — a smaller ring, no stats, no accessory.
    public let compact: Bool

    public init(gauge: GaugeHeroConfig, stats: [GaugeHeroStat] = [], compact: Bool = false) {
        self.gauge = gauge
        self.stats = stats
        self.compact = compact
    }
}

// MARK: - GaugeRingModel (view-ready ring — the web `RadialGauge`)

/// The resolved, view-ready ring — the native peer of one `<RadialGauge>` render. Carries the clamped value
/// (web `Math.max(0, Math.min(value, max))`), the `0...1` arc fraction (web `clamped / max`, guarded to 0
/// when `max <= 0`), the already-formatted center value (web `fmtNumber(clamped, decimals)`), the unit
/// affix and caption, the semantic tint, and the geometry (diameter + stroke width). A pure value so the
/// SwiftUI ring is a function of this model alone — no derivation in the view.
public struct GaugeRingModel: Sendable, Equatable {
    /// The displayed reading after clamping to `0...max` (web `clamped`).
    public let clampedValue: Double
    /// The arc fill fraction in `0...1` (web `clamped / max`), guarded against `max <= 0`.
    public let fraction: Double
    /// The already-formatted center value (web `fmtNumber(clamped, decimals)`).
    public let displayValue: String
    /// The trailing unit affix (web `unit`); empty renders no affix.
    public let unit: String
    /// The caption rendered below the ring (web `label`).
    public let label: String
    /// The arc's semantic color (web `color`).
    public let tint: GaugeTint
    /// The ring diameter in points (web `size`: `compact ? 70 : 100`).
    public let diameter: Double
    /// The ring stroke width in points (web `STROKE_WIDTH = 8`).
    public let strokeWidth: Double

    public init(
        clampedValue: Double,
        fraction: Double,
        displayValue: String,
        unit: String,
        label: String,
        tint: GaugeTint,
        diameter: Double,
        strokeWidth: Double
    ) {
        self.clampedValue = clampedValue
        self.fraction = fraction
        self.displayValue = displayValue
        self.unit = unit
        self.label = label
        self.tint = tint
        self.diameter = diameter
        self.strokeWidth = strokeWidth
    }

    /// The whole-percent fill (`0...100`) spoken by VoiceOver as the gauge's accessibility value — the
    /// rounded `fraction * 100`.
    public var percentFilled: Int {
        Int((fraction * 100).rounded())
    }
}

// MARK: - GaugeStatModel (view-ready stat)

/// A resolved, view-ready supporting stat — the stat plus its stable positional identity for the SwiftUI
/// `ForEach` (more robust than the web `key={stat.label}`, which assumes unique labels). A pure passthrough
/// of the ``GaugeHeroStat`` (no derivation in the view).
public struct GaugeStatModel: Sendable, Equatable, Identifiable {
    /// Stable positional identity for `ForEach` (the stat's index in the list).
    public let id: Int
    /// The stat's data (web stat), rendered by the SwiftUI cell.
    public let stat: GaugeHeroStat

    public init(id: Int, stat: GaugeHeroStat) {
        self.id = id
        self.stat = stat
    }
}

// MARK: - WidgetGaugeHeroLayout (resolved render)

/// The resolved render — the view-ready peer of the web component's output. The web always renders the
/// gauge, so this layout always carries a ``GaugeRingModel``; `stats` are the resolved supporting cells
/// (empty when `compact` or when the host supplied none), and `showsAccessories` gates BOTH the stats row
/// and the caller's accessory slot (web `!compact && …`). The view reads `ring` for the gauge, `stats` for
/// the row, and `showsAccessories` for the accessory slot — no layout math lives in the view.
public struct WidgetGaugeHeroLayout: Sendable, Equatable {
    /// The always-present hero ring (web `<RadialGauge>`).
    public let ring: GaugeRingModel
    /// The supporting stats (web `stats.map(...)`); empty hides the row.
    public let stats: [GaugeStatModel]
    /// Whether the condensed variant applies (web `compact`).
    public let isCompact: Bool
    /// Whether the stats row + accessory slot may render (web `!compact`).
    public let showsAccessories: Bool

    public init(
        ring: GaugeRingModel,
        stats: [GaugeStatModel],
        isCompact: Bool,
        showsAccessories: Bool
    ) {
        self.ring = ring
        self.stats = stats
        self.isCompact = isCompact
        self.showsAccessories = showsAccessories
    }
}

// MARK: - GaugeValueFormatter (web `fmtNumber` + decimals rule)

/// The number formatter for the gauge's center value — the Foundation port of the web `RadialGauge`
/// formatting: `decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())` then
/// `fmtNumber(clamped, decimals)` (a locale-aware `toLocaleString` with fixed min/max fraction digits).
/// The locale is injected so the value follows the device locale at runtime (the Apple-idiomatic peer of
/// the web global locale) while tests pin a deterministic locale. Non-finite inputs fall back to `0` (web
/// `safeNumber`).
public enum GaugeValueFormatter {
    /// The default decimal precision when the value is non-integer — the web `_globalPrecision = 2`.
    public static let defaultPrecision = 2

    /// Whether a value is a whole number — the web `Number.isInteger(clamped)`.
    public static func isInteger(_ value: Double) -> Bool {
        value.isFinite && value.rounded(.towardZero) == value
    }

    /// The decimals for a value — the web `Number.isInteger(clamped) ? 0 : globalPrecision`, with the
    /// precision clamped to `0...20` (the web `setGlobalPrecision` bound).
    public static func decimals(forClamped value: Double, precision: Int) -> Int {
        guard !isInteger(value) else { return 0 }
        return Swift.max(0, Swift.min(20, precision))
    }

    /// Formats a value with fixed min/max fraction digits and locale-aware grouping — the web
    /// `fmtNumber(value, decimals)` (`toLocaleString(locale, { minimumFractionDigits, maximumFractionDigits })`).
    /// Non-finite inputs format as `0` (web `safeNumber`).
    public static func format(_ value: Double, decimals: Int, locale: Locale) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        if let formatted = formatter.string(from: NSNumber(value: safe)) {
            return formatted
        }
        return String(format: "%.\(decimals)f", safe)
    }
}

// MARK: - WidgetGaugeHeroProjector (web render body)

/// The pure projection from the props to the view-ready layout — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no fetch,
/// no clock) and derives the rendered gauge. Unit tested across the size table, the clamp + fraction math
/// (incl. the `max <= 0` guard), the decimals rule, the stats gate, and the accessory gate.
public enum WidgetGaugeHeroProjector {
    /// The standard ring diameter (web `size = 100`).
    public static let standardDiameter = 100.0
    /// The condensed ring diameter (web `compact ? 70`).
    public static let compactDiameter = 70.0
    /// The ring stroke width (web `STROKE_WIDTH = 8`).
    public static let strokeWidth = 8.0

    /// The ring diameter — the web `compact ? 70 : 100`.
    public static func diameter(compact: Bool) -> Double {
        compact ? compactDiameter : standardDiameter
    }

    /// Clamps the reading to `0...maximum` — the web `Math.max(0, Math.min(value, max))`.
    public static func clamp(value: Double, maximum: Double) -> Double {
        let upperBounded = Swift.min(value, maximum)
        return Swift.max(0, upperBounded)
    }

    /// The arc fill fraction in `0...1` — the web `clamped / max`, guarded to `0` when `max <= 0` (native
    /// null-safety: the web would divide by zero and produce a NaN arc).
    public static func fraction(value: Double, maximum: Double) -> Double {
        guard maximum > 0 else { return 0 }
        let raw = clamp(value: value, maximum: maximum) / maximum
        return Swift.min(1, Swift.max(0, raw))
    }

    /// Builds the view-ready ring from the gauge config — the native peer of one `<RadialGauge>` render.
    public static func ring(
        _ gauge: GaugeHeroConfig,
        compact: Bool,
        precision: Int,
        locale: Locale
    ) -> GaugeRingModel {
        let clamped = clamp(value: gauge.value, maximum: gauge.max)
        let decimals = GaugeValueFormatter.decimals(forClamped: clamped, precision: precision)
        let display = GaugeValueFormatter.format(clamped, decimals: decimals, locale: locale)
        return GaugeRingModel(
            clampedValue: clamped,
            fraction: fraction(value: gauge.value, maximum: gauge.max),
            displayValue: display,
            unit: gauge.unit,
            label: gauge.label,
            tint: gauge.tint,
            diameter: diameter(compact: compact),
            strokeWidth: strokeWidth
        )
    }

    /// Builds the view-ready supporting stats — the web `!compact && stats && stats.length > 0`:
    /// `compact` suppresses the row entirely, otherwise each stat maps to a positional cell.
    public static func stats(_ input: WidgetGaugeHeroInput) -> [GaugeStatModel] {
        guard !input.compact else { return [] }
        return input.stats.enumerated().map { index, stat in
            GaugeStatModel(id: index, stat: stat)
        }
    }

    /// Resolves the whole render from the props — the native peer of the web component's render. The gauge
    /// ring is always present (the web always renders `<RadialGauge>`); the stats row + accessory slot are
    /// gated by `!compact`.
    public static func resolve(
        _ input: WidgetGaugeHeroInput,
        precision: Int,
        locale: Locale
    ) -> WidgetGaugeHeroLayout {
        WidgetGaugeHeroLayout(
            ring: ring(input.gauge, compact: input.compact, precision: precision, locale: locale),
            stats: stats(input),
            isCompact: input.compact,
            showsAccessories: !input.compact
        )
    }
}
