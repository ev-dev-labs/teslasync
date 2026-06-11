//
//  SmallMultiplesChart.Adapter.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  The testable, dependency-light core for the small-multiples grid — the SwiftUI parity of
//  `components/charts/SmallMultiplesChart.tsx`. Everything here is pure (Foundation only): the series
//  descriptor (the native peer of one `series` key + its label + colour), the time-aligned sample row
//  (the web `data` row), the projected per-cell point + cell, the P4 connectivity axis, the data
//  availability axis, the empty-collapse policy, the interactivity axis (web `onCellClick` present →
//  drill-in), the coalesced input snapshot, the surface metadata (diagnostics slug), the `#rrggbb`
//  decoder, the verbatim port of the web perf core (per-cell finite-only projection + `strideSample`
//  downsampling), the axis/number formatters, and the VoiceOver label builders. No store, no bundle,
//  no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web component is reusable + presentational — it takes a `data` matrix + a list of
//  `series` keys and renders one mini `LineChart` per key, each with its own y-scale so disparate
//  magnitudes don't flatten one another. Its three perf layers are reproduced here: (1) per-cell
//  projection keeps only rows where the series has a finite value; (2) `strideSample` caps each cell
//  at `maxPointsPerCell` preserving first + last; (3) the web `useInView` lazy-mount maps to the
//  native `LazyVGrid` (off-screen cells are not built). The cross-cell `syncId` crosshair and the
//  per-cell `'No data'` fallback are reproduced in the views; the surface adds the P4 leaf states
//  the standalone web component leaves to its host.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of a web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core + projection have no dependency
/// on a bundle: the production app passes the P1/S10 facade (`SmallMultiplesStrings.string`), while
/// tests and the isolated harness pass the identity (fallback) resolver.
public typealias SmallMultiplesResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Series descriptor (web `series` key + label + colour)

/// One series to render as a cell — the native peer of a web `series[i]` key. `id` is the stable key
/// the projection keys each row on (web `sig`); `label` is the friendly display name (web
/// `seriesLabel(sig) ?? sig`); `colorHex` is an optional explicit `#rrggbb` swatch and `colorIndex`
/// is the brand-palette fallback (web `CHART_COLORS[colorIndex[sig] ?? i]`). The colour is resolved
/// to a `Color` only at the SwiftUI boundary so this stays pure.
public struct SmallMultiplesSeries: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let colorHex: String?
    public let colorIndex: Int

    public init(id: String, label: String, colorHex: String? = nil, colorIndex: Int = 0) {
        self.id = id
        self.label = label
        self.colorHex = colorHex
        self.colorIndex = colorIndex
    }
}

// MARK: - Sample row (web `data` row — timestamp + arbitrary series values)

/// One time-aligned row — the native peer of a web `data[i]` row: an x-axis `date` (web `timestamp`)
/// and the series values keyed by series id. Only finite values matter; the projection filters
/// non-finite / missing values per cell exactly as the web `isFinitePoint` guard does.
public struct SmallMultiplesSample: Sendable, Equatable {
    public let date: Date
    public let values: [String: Double]

    public init(date: Date, values: [String: Double]) {
        self.date = date
        self.values = values
    }
}

// MARK: - Projected point + cell (web per-cell projection result)

/// One projected, finite (x, y) sample for a single cell — the web `{ [xKey]: ts, [sig]: v }` row.
public struct SmallMultiplesPoint: Sendable, Equatable, Identifiable {
    public let id: String
    public let date: Date
    public let value: Double

    public init(date: Date, value: Double) {
        self.date = date
        self.value = value
        id = String(date.timeIntervalSinceReferenceDate)
    }
}

/// One projected cell — a series' downsampled finite points plus the `hasData` flag the web cell uses
/// to choose between the chart and the `'No data'` fallback. Carries the colour + label so the
/// view renders it verbatim.
public struct SmallMultiplesCell: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let colorHex: String?
    public let colorIndex: Int
    public let points: [SmallMultiplesPoint]
    public let hasData: Bool

    public init(
        id: String,
        label: String,
        colorHex: String?,
        colorIndex: Int,
        points: [SmallMultiplesPoint],
        hasData: Bool
    ) {
        self.id = id
        self.label = label
        self.colorHex = colorHex
        self.colorIndex = colorIndex
        self.points = points
        self.hasData = hasData
    }
}

// MARK: - Data payload (web `data` + `series` props)

/// The resolved chart payload — the time-aligned sample matrix plus the ordered series descriptors.
/// The native peer of the web `data` + `series` props handed to the presentational component.
public struct SmallMultiplesData: Sendable, Equatable {
    public var samples: [SmallMultiplesSample]
    public var series: [SmallMultiplesSeries]

    public init(samples: [SmallMultiplesSample] = [], series: [SmallMultiplesSeries] = []) {
        self.samples = samples
        self.series = series
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the chart's data snapshot — the orthogonal connectivity axis the populated grid
/// renders as a freshness chip. `live` shows the cells alone; `stale` adds a refresh affordance and
/// triggers a one-shot auto-refresh; `offline` keeps the last-known cells with an offline marker.
public enum SmallMultiplesConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Data availability (web parent fetch lifecycle)

/// The resolution state of the data the host resolves before the grid has anything to chart.
/// `loading` shows skeleton chrome; `failed` shows a retry affordance (the `QueryError` peer);
/// `resolved` carries the payload the web component would receive as `data` + `series`.
public enum SmallMultiplesAvailability: Sendable, Equatable {
    case loading
    case failed(String)
    case resolved(SmallMultiplesData)
}

// MARK: - Empty-collapse policy (web empty-series behaviour)

/// How the surface treats a resolved-but-series-less payload. `emptyState` (the P4 default) renders a
/// friendly empty state so the standalone shared surface is never a blank box; `withdraw` reproduces
/// the web component rendering an empty grid (nothing) when `series` is empty, for chart-embedded use.
public enum SmallMultiplesEmptyBehavior: String, Sendable, Equatable, CaseIterable {
    case emptyState
    case withdraw
}

// MARK: - Interactivity (web `onCellClick` presence)

/// Whether cells drill in. `interactive` is the web `onCellClick` present branch: each cell is a
/// button that opens its series. `passive` is the web `onCellClick == undefined` branch: cells are
/// static, non-tappable groups.
public enum SmallMultiplesInteractivity: String, Sendable, Equatable, CaseIterable {
    case interactive
    case passive

    public var isInteractive: Bool {
        self == .interactive
    }
}

// MARK: - Input snapshot (coalesced surface inputs)

/// One coalesced snapshot of the surface's inputs — the data availability (host fetch), the P4
/// connectivity axis, the interactivity axis (web `onCellClick` presence), the empty-collapse policy,
/// and the web layout knobs (`maxPointsPerCell`, `cellHeight`, `cellMinWidth`, optional fixed
/// `columns`). The projection is a pure function of this.
public struct SmallMultiplesInput: Sendable, Equatable {
    public var availability: SmallMultiplesAvailability
    public var connection: SmallMultiplesConnection
    public var interactivity: SmallMultiplesInteractivity
    public var emptyBehavior: SmallMultiplesEmptyBehavior
    public var maxPointsPerCell: Int
    public var cellHeight: Double
    public var cellMinWidth: Double
    public var columns: Int?

    public init(
        availability: SmallMultiplesAvailability = .loading,
        connection: SmallMultiplesConnection = .live,
        interactivity: SmallMultiplesInteractivity = .interactive,
        emptyBehavior: SmallMultiplesEmptyBehavior = .emptyState,
        maxPointsPerCell: Int = 400,
        cellHeight: Double = 120,
        cellMinWidth: Double = 280,
        columns: Int? = nil
    ) {
        self.availability = availability
        self.connection = connection
        self.interactivity = interactivity
        self.emptyBehavior = emptyBehavior
        self.maxPointsPerCell = maxPointsPerCell
        self.cellHeight = cellHeight
        self.cellMinWidth = cellMinWidth
        self.columns = columns
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum SmallMultiplesMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SmallMultiplesChart"
}

// MARK: - Downsampling (verbatim port of the web `strideSample`)

/// The pure stride-downsampler — the verbatim native port of the web `strideSample`: caps a series at
/// `cap` points, always preserving the first and last. Kept generic + pure so the perf core is unit
/// tested without a view. `cap <= 0` yields an empty array; a series already within `cap` is returned
/// untouched (web identity branch).
public enum SmallMultiplesSampler {
    public static func strideSample<Element>(_ rows: [Element], cap: Int) -> [Element] {
        guard cap > 0 else { return [] }
        guard rows.count > cap else { return rows }
        // Web: stride = ceil(len / cap). Step from 0; the loop already keeps index 0 (first).
        let stride = Int((Double(rows.count) / Double(cap)).rounded(.up))
        var out: [Element] = []
        var index = 0
        while index < rows.count {
            out.append(rows[index])
            index += stride
        }
        // Web: always append the final row when the stride loop skipped it.
        let lastIndex = rows.count - 1
        if lastIndex % stride != 0 {
            out.append(rows[lastIndex])
        }
        return out
    }
}

// MARK: - Per-cell projection (web `cellProjections` useMemo)

/// The pure per-cell projection — the native port of the web `cellProjections` memo and the single
/// biggest perf win in the component. For each series it walks the sample matrix once, keeps only the
/// rows where that series has a finite value (web `isFinitePoint`), then stride-downsamples to
/// `maxPointsPerCell`. Unit tested across the finite filter, the downsample cap, and the `hasData`
/// flag, so the projection is asserted without a store or SwiftUI.
public enum SmallMultiplesCells {
    public static func project(
        samples: [SmallMultiplesSample],
        series: [SmallMultiplesSeries],
        maxPointsPerCell: Int
    ) -> [SmallMultiplesCell] {
        let cap = max(1, maxPointsPerCell)
        return series.map { descriptor in
            var points: [SmallMultiplesPoint] = []
            points.reserveCapacity(samples.count)
            for sample in samples {
                if let value = sample.values[descriptor.id], value.isFinite {
                    points.append(SmallMultiplesPoint(date: sample.date, value: value))
                }
            }
            let capped = SmallMultiplesSampler.strideSample(points, cap: cap)
            return SmallMultiplesCell(
                id: descriptor.id,
                label: descriptor.label,
                colorHex: descriptor.colorHex,
                colorIndex: descriptor.colorIndex,
                points: capped,
                hasData: !capped.isEmpty
            )
        }
    }
}

// MARK: - Colour decoder (`#rrggbb` → sRGB components)

/// Decodes an explicit `#rrggbb` swatch (web series `color`) into sRGB components in `0...1`. Pure +
/// bundle-free so colour parity is asserted without rendering a view; the SwiftUI boundary builds a
/// `Color(.sRGB, …)` from the result and falls back to the brand chart palette when a value is absent
/// or malformed.
public enum SmallMultiplesPalette {
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

// MARK: - Axis formatting (web `formatTime` tick + y-axis label)

/// The pure axis/number formatters. `timeLabel` is the native parity of the web `useDateFormat`
/// `formatTime` x-axis `tickFormatter` (locale + timezone-aware hour:minute); `numberLabel` is the
/// abbreviated y-axis / summary number, rendering an em dash for non-finite input (never "nan"). Both
/// are deterministic so the rendered output is asserted without a view.
public enum SmallMultiplesAxis {
    /// Web `numberFormat` default locale.
    public static let defaultLocaleIdentifier = "en_US"

    /// Locale + timezone-aware hour:minute label — the parity of `formatTime` (`hour: '2-digit',
    /// minute: '2-digit'`). Returns an em dash for a non-finite date (the web `'—'` guard).
    public static func timeLabel(
        _ date: Date,
        locale: Locale = Locale(identifier: defaultLocaleIdentifier),
        timeZone: TimeZone = .current
    ) -> String {
        guard date.timeIntervalSinceReferenceDate.isFinite else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Abbreviated numeric label (1.2k / 3.4M) for the per-cell y-axis ticks + VoiceOver summary.
    /// Non-finite input renders an em dash.
    public static func numberLabel(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000...:
            return String(format: "%.1fM", value / 1_000_000)
        case 1000...:
            return String(format: "%.1fk", value / 1000)
        case 0 ..< 1 where magnitude > 0:
            return String(format: "%.2f", value)
        default:
            return String(format: "%.0f", value)
        }
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised + already-formatted parts, so the
/// spoken content is asserted without rendering the view. The web cell conveys its series only as a
/// colour swatch + a label and (for sighted users) the line itself; the native labels name the
/// series, speak either the friendly "no data" copy or a concise latest/low/high summary as the
/// accessibility value, and (when interactive) carry an open hint so a non-sighted user gets the same
/// information and drill-in affordance a sighted one does.
public enum SmallMultiplesAccessibility {
    /// A cell's spoken name — the series label the web renders verbatim.
    public static func cellLabel(name: String) -> String {
        name
    }

    /// Composes the populated-cell summary from the localized template + the already-formatted latest
    /// / low / high numbers (web cell has no spoken summary; this is native VoiceOver scaffolding).
    public static func summaryLabel(
        template: String,
        latest: String,
        minimum: String,
        maximum: String
    ) -> String {
        String(format: template, latest, minimum, maximum)
    }

    /// A cell's spoken value — the localized "no data" copy when the series has no finite points, else
    /// the already-composed latest / low / high summary.
    public static func cellValue(hasData: Bool, noData: String, summary: String) -> String {
        hasData ? summary : noData
    }

    /// A cell's drill-in hint — the localized open hint when interactive (web `onCellClick`), else nil
    /// (a passive cell has no affordance to announce).
    public static func cellHint(isInteractive: Bool, openHint: String) -> String? {
        isInteractive ? openHint : nil
    }
}
