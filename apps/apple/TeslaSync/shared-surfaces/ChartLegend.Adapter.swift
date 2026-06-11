//
//  ChartLegend.Adapter.swift
//  TeslaSync — P4 shared surface · 0068 · ChartLegend (Apple)
//
//  The testable, dependency-light core for the chart legend — the SwiftUI parity of
//  `components/charts/ChartLegend.tsx`. Everything here is pure (Foundation only): one legend entry
//  (the native peer of a Recharts `Legend` payload entry — its stable toggle key, display label, and
//  optional `#rrggbb` swatch), the data-availability + P4 connectivity axes, the empty-collapse
//  policy (the native peer of Recharts rendering nothing for an empty payload), the interactivity
//  axis (the web `resolved == null` → passive legend), the horizontal alignment (web `align`), the
//  surface metadata (diagnostics slug), the `#rrggbb` decoder, the pure hidden-set toggle algebra
//  (the native `useChartHiddenSeries` set logic), and the VoiceOver label builders. No store, no
//  bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web component is a `<Legend>` wrapper. Its toggle source is `useChartHiddenSeries`
//  (a `HiddenSeriesState` or `null`): clicking an entry calls `toggle(key)`; hidden entries render
//  dimmed + struck-through (`aria-pressed = isHidden`); with no state it renders passively (no toggle,
//  no dimming). The legend renders its entry `value` verbatim (no `t()` — the surface is anonymous),
//  so the only localized copy here is the native P4 leaf chrome (loading / empty / error / freshness)
//  and the VoiceOver scaffolding the colour-only web swatch needs. `pickKey` (dataKey → payload
//  dataKey → value) is reproduced by the host supplying each entry's stable `id` (the dataKey) and its
//  display `label` (the value).
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of a web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core + projection have no dependency
/// on a bundle: the production app passes the P1/S10 facade (`ChartLegendStrings.string`), while
/// tests and the isolated harness pass the identity (fallback) resolver.
public typealias ChartLegendResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Legend entry (web Recharts `Legend` payload entry, projected for display)

/// One legend entry as the surface needs it — the display-facing subset of a Recharts legend payload
/// entry. `id` is the stable toggle key (the web `pickKey` result: the series `dataKey`); `label` is
/// the value rendered verbatim (web renders `{value}`); `colorHex` is the optional explicit swatch
/// (web `entry.color`) and `paletteIndex` is the brand-palette fallback when no explicit colour is
/// supplied. The colour is resolved to a `Color` only at the SwiftUI boundary so this stays pure.
public struct ChartLegendItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let colorHex: String?
    public let paletteIndex: Int

    public init(id: String, label: String, colorHex: String? = nil, paletteIndex: Int = 0) {
        self.id = id
        self.label = label
        self.colorHex = colorHex
        self.paletteIndex = paletteIndex
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the legend's series snapshot — the orthogonal connectivity axis the populated
/// legend renders as a freshness chip. `live` shows the entries alone; `stale` adds a refresh
/// affordance and triggers a one-shot auto-refresh; `offline` keeps the last-known entries with an
/// offline marker.
public enum ChartLegendConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Data availability (web parent chart series lifecycle)

/// The resolution state of the series the parent chart resolves before the legend has any entries to
/// render. `loading` shows skeleton chrome; `failed` shows a retry affordance (the `QueryError`
/// peer); `resolved` carries the entries the web `<Legend>` would receive as its payload.
public enum ChartLegendAvailability: Sendable, Equatable {
    case loading
    case failed(String)
    case resolved([ChartLegendItem])
}

// MARK: - Empty-collapse policy (web Recharts empty-payload behaviour)

/// How the surface treats a resolved-but-empty legend. `emptyState` (the P4 default) renders a
/// friendly empty state so the standalone shared surface is never a blank box; `withdraw` reproduces
/// Recharts rendering nothing for an empty payload, for chart-embedded use where an empty legend
/// should occupy no space.
public enum ChartLegendEmptyBehavior: String, Sendable, Equatable, CaseIterable {
    case emptyState
    case withdraw
}

// MARK: - Interactivity (web `resolved == null` → passive)

/// Whether the legend toggles series visibility. `interactive` binds a hidden-series state (the web
/// `useChartHiddenSeries` returning a `HiddenSeriesState`): entries are tappable and hidden ones
/// render dimmed + struck-through. `passive` is the web `resolved == null` branch: entries render as
/// static labels with no toggle and no dimming.
public enum ChartLegendInteractivity: String, Sendable, Equatable, CaseIterable {
    case interactive
    case passive

    public var isInteractive: Bool {
        self == .interactive
    }
}

// MARK: - Alignment (web `align: 'left' | 'center' | 'right'`)

/// The legend's horizontal alignment — the native peer of the web `align` prop. `verticalAlign` and
/// `wrapperStyle` are Recharts layout pass-throughs that position the legend relative to its chart;
/// for a standalone surface those are the embedding view's layout concern, so only `align` is
/// reproduced here as composition.
public enum ChartLegendAlignment: String, Sendable, Equatable, CaseIterable {
    case leading
    case center
    case trailing
}

// MARK: - Input snapshot (coalesced surface inputs)

/// One coalesced snapshot of the surface's inputs — the data availability (parent series fetch), the
/// P4 connectivity axis, the interactivity axis (web toggle-source presence), the empty-collapse
/// policy, the alignment, and the current hidden-series set (the native `useChartHiddenSeries`
/// `hidden`). The projection is a pure function of this; the model owns the authoritative hidden set
/// at runtime and folds it in via ``replacingHidden(_:)``.
public struct ChartLegendInput: Sendable, Equatable {
    public var availability: ChartLegendAvailability
    public var connection: ChartLegendConnection
    public var interactivity: ChartLegendInteractivity
    public var emptyBehavior: ChartLegendEmptyBehavior
    public var alignment: ChartLegendAlignment
    public var hidden: Set<String>

    public init(
        availability: ChartLegendAvailability = .loading,
        connection: ChartLegendConnection = .live,
        interactivity: ChartLegendInteractivity = .interactive,
        emptyBehavior: ChartLegendEmptyBehavior = .emptyState,
        alignment: ChartLegendAlignment = .center,
        hidden: Set<String> = []
    ) {
        self.availability = availability
        self.connection = connection
        self.interactivity = interactivity
        self.emptyBehavior = emptyBehavior
        self.alignment = alignment
        self.hidden = hidden
    }

    /// Returns a copy carrying `hidden` — used by the model to fold its authoritative hidden set over
    /// the source-emitted feed before projecting (the runtime owner of `useChartHiddenSeries`).
    public func replacingHidden(_ hidden: Set<String>) -> ChartLegendInput {
        var copy = self
        copy.hidden = hidden
        return copy
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum ChartLegendMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChartLegend"
}

// MARK: - Hidden-series algebra (web `useChartHiddenSeries` set logic, pure)

/// The pure set logic behind the native `useChartHiddenSeries` — the toggle / set / clear operations
/// the `@MainActor` state-holder delegates to, kept pure + bundle-free so the visibility algebra is
/// unit tested without a view or the main actor. Mirrors the web `HiddenSeriesState` mutations.
public enum ChartLegendHidden {
    /// Flip a key's membership in the hidden set (web `toggle(seriesKey)`).
    public static func toggling(_ hidden: Set<String>, _ key: String) -> Set<String> {
        var next = hidden
        if next.contains(key) {
            next.remove(key)
        } else {
            next.insert(key)
        }
        return next
    }

    /// Force a key hidden or visible (web `setHidden`-style explicit set).
    public static func setting(_ hidden: Set<String>, _ key: String, hidden isHidden: Bool) -> Set<String> {
        var next = hidden
        if isHidden {
            next.insert(key)
        } else {
            next.remove(key)
        }
        return next
    }
}

// MARK: - Colour decoder (`#rrggbb` → sRGB components)

/// Decodes an explicit `#rrggbb` swatch (web `entry.color`) into sRGB components in `0...1`. Pure +
/// bundle-free so colour parity is asserted without rendering a view; the SwiftUI boundary builds a
/// `Color(.sRGB, …)` from the result and falls back to the brand chart palette (then the accent
/// token) when a value is absent or malformed.
public enum ChartLegendPalette {
    public struct Components: Sendable, Equatable {
        public let red: Double
        public let green: Double
        public let blue: Double

        public init(red: Double, green: Double, blue: Double) {
            self.red = red
            self.green = green
            self.blue = blue
        }
    }

    /// Parse a `#rrggbb` (or bare `rrggbb`) hex into sRGB components, or `nil` when absent/malformed.
    public static func components(forHex hex: String?) -> Components? {
        guard var value = hex?.trimmingCharacters(in: .whitespaces), !value.isEmpty else {
            return nil
        }
        if value.hasPrefix("#") {
            value.removeFirst()
        }
        guard value.count == 6, let rgb = UInt32(value, radix: 16) else {
            return nil
        }
        return Components(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The web legend shows the series only as a colour swatch + the
/// value text and conveys hidden state through dimming + `aria-pressed`; the native labels name the
/// series, speak its shown / hidden state as the accessibility value, and (when interactive) carry a
/// toggle hint so a non-sighted user gets the same information and affordance a sighted one does.
public enum ChartLegendAccessibility {
    /// An entry's spoken name — the series label the web renders verbatim.
    public static func entryLabel(name: String) -> String {
        name
    }

    /// An entry's spoken state — the native peer of the web `aria-pressed` (hidden) signal. Returns
    /// the localized "Hidden" / "Shown" string; empty for a passive (non-toggle) entry, which has no
    /// visibility state to announce.
    public static func entryValue(isInteractive: Bool, isHidden: Bool, shown: String, hidden: String) -> String {
        guard isInteractive else {
            return ""
        }
        return isHidden ? hidden : shown
    }
}
