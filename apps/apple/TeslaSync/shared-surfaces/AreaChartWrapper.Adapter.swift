//
//  AreaChartWrapper.Adapter.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  The testable, dependency-light core for the gradient area chart — the SwiftUI parity of
//  `components/charts/AreaChartWrapper.tsx`. Everything here is pure (Foundation only): the series
//  descriptor (the native peer of one `series` config — its `key`, `label`, `color`), the data row
//  (the web `data[i]` record with its `xKey` value + the per-series numeric values), the projected
//  (index, value) point, the value/label formatters (the native peer of the web `yFormatter` /
//  `xFormatter` props), the P4 connectivity axis, the data availability axis, the empty-collapse
//  policy, the coalesced input snapshot, the surface metadata (diagnostics slug), the `#rrggbb`
//  decoder, the per-series finite-only point projection, and the VoiceOver summary builders. No store,
//  no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web component is reusable + presentational — it takes a `data` matrix, an `xKey`,
//  a list of `series` ({ key, label, color }), an optional `height`, and optional `xFormatter` /
//  `yFormatter`, then renders one gradient-filled `<Area>` per series (web `type="monotone"`,
//  `strokeWidth={2}`, a vertical 0.3→0 opacity gradient fill) over a shared cartesian grid with a
//  hover tooltip. The web component itself has no loading / empty / error chrome (it is purely
//  presentational); this surface adds the P4 leaf states the standalone web component leaves to its
//  host, so it is never a blank box.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of a web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core + projection have no dependency
/// on a bundle: the production app passes the P1/S10 facade (`AreaChartWrapperStrings.string`), while
/// tests and the isolated harness pass the identity (fallback) resolver. The web `AreaChartWrapper`
/// has no `t()` calls of its own (it is anonymous + presentational), so every key here is native P4
/// chrome (loading / empty / error / freshness) or VoiceOver scaffolding.
public typealias AreaChartResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Series descriptor (web `series[i]` — { key, label, color })

/// One series to render as a filled area — the native peer of a web `series[i]` config. `id` is the
/// stable value key the projection reads from each row (web `s.key` / `dataKey`); `label` is the
/// friendly tooltip name (web `s.label`); `colorHex` is the explicit `#rrggbb` stroke / gradient
/// colour (web `s.color`, required there) and `colorIndex` is the brand-palette fallback used when the
/// hex is malformed. The colour resolves to a `Color` only at the SwiftUI boundary so this stays pure.
public struct AreaChartSeries: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let colorHex: String
    public let colorIndex: Int

    public init(id: String, label: String, colorHex: String, colorIndex: Int = 0) {
        self.id = id
        self.label = label
        self.colorHex = colorHex
        self.colorIndex = colorIndex
    }
}

// MARK: - Data row (web `data[i]` — `xKey` value + per-series numbers)

/// One row of the chart matrix — the native peer of a web `data[i]` record: the x-axis label (the
/// already-resolved `data[i][xKey]` value, web `xKey`) plus the series values keyed by series id. Only
/// finite values are charted; the projection filters non-finite / missing values per series so a gap
/// in one series never drops a point from another.
public struct AreaChartRow: Sendable, Equatable {
    public let x: String
    public let values: [String: Double]

    public init(x: String, values: [String: Double]) {
        self.x = x
        self.values = values
    }
}

// MARK: - Projected point (web `<Area>` datum)

/// One projected, finite (x, y) sample for a single series — the web per-series `<Area>` point. `index`
/// is the row's position in the matrix (the evenly-spaced x position, the web array-index x), `value`
/// is the finite y. `id` is the index so SwiftUI's `ForEach` is stable.
public struct AreaChartPoint: Sendable, Equatable, Identifiable {
    public let id: Int
    public let index: Int
    public let value: Double

    public init(index: Int, value: Double) {
        self.index = index
        self.value = value
        id = index
    }
}

// MARK: - Value format (web `yFormatter` prop)

/// The declarative numeric formatter applied to the y-axis ticks + the tooltip values — the native,
/// Equatable peer of the web `yFormatter?: (value: number) => string` prop. The web call sites pass a
/// unit suffix (`(v) => `${v}%``, `(v) => `${v} kWh``); this models that as a `suffix` plus the
/// fraction-digit cap and an optional `abbreviate` (1.2k / 3.4M) for dense axes. Kept a value type so
/// the projection stays pure + testable (a closure could not be `Equatable`).
public struct AreaValueFormat: Sendable, Equatable {
    public var suffix: String
    public var maximumFractionDigits: Int
    public var abbreviate: Bool

    public init(suffix: String = "", maximumFractionDigits: Int = 2, abbreviate: Bool = false) {
        self.suffix = suffix
        self.maximumFractionDigits = maximumFractionDigits
        self.abbreviate = abbreviate
    }

    /// The web default — no suffix, natural decimals, no abbreviation (recharts renders the raw value).
    public static let plain = AreaValueFormat()
}

// MARK: - Label format (web `xFormatter` prop)

/// The declarative formatter applied to the x-axis labels — the native, Equatable peer of the web
/// `xFormatter?: (value: string) => string` prop. The web call sites pass no x formatter (the raw
/// `xKey` value is shown), so the default is verbatim; an optional `maxLength` truncates long category
/// labels with an ellipsis so a dense axis stays legible.
public struct AreaLabelFormat: Sendable, Equatable {
    public var maxLength: Int?

    public init(maxLength: Int? = nil) {
        self.maxLength = maxLength
    }

    /// The web default — the raw `xKey` value shown unchanged.
    public static let verbatim = AreaLabelFormat()
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the chart's data snapshot — the orthogonal connectivity axis the populated chart
/// renders as a freshness chip. `live` shows the chart alone; `stale` adds a refresh affordance and
/// triggers a one-shot auto-refresh; `offline` keeps the last-known chart with an offline marker.
public enum AreaChartConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Data availability (web parent fetch lifecycle)

/// The resolution state of the data the host resolves before the chart has anything to draw.
/// `loading` shows skeleton chrome; `failed` shows a retry affordance (the `QueryError` peer);
/// `resolved` carries the payload the web component would receive as `data` + `series`.
public enum AreaChartAvailability: Sendable, Equatable {
    case loading
    case failed(String)
    case resolved(AreaChartData)
}

// MARK: - Data payload (web `data` + `series` props)

/// The resolved chart payload — the ordered row matrix plus the ordered series descriptors. The native
/// peer of the web `data` + `series` props handed to the presentational component.
public struct AreaChartData: Sendable, Equatable {
    public var rows: [AreaChartRow]
    public var series: [AreaChartSeries]

    public init(rows: [AreaChartRow] = [], series: [AreaChartSeries] = []) {
        self.rows = rows
        self.series = series
    }
}

// MARK: - Empty-collapse policy (web empty-data behaviour)

/// How the surface treats a resolved-but-nothing-to-chart payload (no series, or no finite points in
/// any series). `emptyState` (the P4 default) renders a friendly empty state so the standalone shared
/// surface is never a blank box; `withdraw` reproduces the web component embedded in a host that hides
/// the whole region when there is no data (render nothing).
public enum AreaChartEmptyBehavior: String, Sendable, Equatable, CaseIterable {
    case emptyState
    case withdraw
}

// MARK: - Input snapshot (coalesced surface inputs)

/// One coalesced snapshot of the surface's inputs — the data availability (host fetch), the P4
/// connectivity axis, the empty-collapse policy, the web `height` prop, and the y / x formatters (web
/// `yFormatter` / `xFormatter`). The projection is a pure function of this.
public struct AreaChartInput: Sendable, Equatable {
    public var availability: AreaChartAvailability
    public var connection: AreaChartConnection
    public var emptyBehavior: AreaChartEmptyBehavior
    public var height: Double
    public var valueFormat: AreaValueFormat
    public var xFormat: AreaLabelFormat

    public init(
        availability: AreaChartAvailability = .loading,
        connection: AreaChartConnection = .live,
        emptyBehavior: AreaChartEmptyBehavior = .emptyState,
        height: Double = 300,
        valueFormat: AreaValueFormat = .plain,
        xFormat: AreaLabelFormat = .verbatim
    ) {
        self.availability = availability
        self.connection = connection
        self.emptyBehavior = emptyBehavior
        self.height = height
        self.valueFormat = valueFormat
        self.xFormat = xFormat
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum AreaChartMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AreaChartWrapper"
}

// MARK: - Point projection (web per-series `<Area>` data)

/// The pure per-series point projection — for a series it walks the row matrix once, keeping only the
/// rows where that series has a finite value (the web `<Area>` skips non-finite points), each carrying
/// the row's array index as its evenly-spaced x position. Also builds the formatted x-axis labels for
/// the whole domain. Unit tested without a store or SwiftUI.
public enum AreaChartProjector {
    /// The finite (index, value) points for one series id.
    public static func points(rows: [AreaChartRow], seriesId: String) -> [AreaChartPoint] {
        var out: [AreaChartPoint] = []
        out.reserveCapacity(rows.count)
        for (index, row) in rows.enumerated() {
            if let value = row.values[seriesId], value.isFinite {
                out.append(AreaChartPoint(index: index, value: value))
            }
        }
        return out
    }

    /// The formatted x-axis labels for the whole domain (web `xFormatter` applied to each `xKey`).
    public static func labels(rows: [AreaChartRow], format: AreaLabelFormat) -> [String] {
        rows.map { AreaChartFormat.label($0.x, format: format) }
    }
}

// MARK: - Formatting (web `yFormatter` / `xFormatter`)

/// The pure formatters. `number` is the native parity of the web `yFormatter` (applied to both the
/// y-axis ticks and the tooltip values); `label` is the parity of the web `xFormatter` (applied to the
/// x-axis tick labels). Both are deterministic so the rendered output is asserted without a view.
public enum AreaChartFormat {
    /// The locale used for numeric rendering (matches the web `en-US` default, no grouping separators
    /// so `${v}` parity holds, e.g. `1000` → `"1000"` not `"1,000"`).
    public static let localeIdentifier = "en_US"

    /// Format a y value — natural decimals (or abbreviated k / M) plus the unit suffix. Non-finite
    /// input renders an em dash (never `"nan"`).
    public static func number(_ value: Double, format: AreaValueFormat = .plain) -> String {
        guard value.isFinite else { return "—" }
        let core = format.abbreviate ? abbreviated(value) : decimal(
            value,
            maximumFractionDigits: format.maximumFractionDigits
        )
        return core + format.suffix
    }

    /// Format an x label — verbatim, or truncated with an ellipsis when it exceeds `maxLength`.
    public static func label(_ raw: String, format: AreaLabelFormat = .verbatim) -> String {
        guard let maxLength = format.maxLength, maxLength > 0, raw.count > maxLength else {
            return raw
        }
        let head = raw.prefix(max(1, maxLength - 1))
        return String(head) + "…"
    }

    private static func decimal(_ value: Double, maximumFractionDigits: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = max(0, maximumFractionDigits)
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    private static func abbreviated(_ value: Double) -> String {
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000...:
            return decimal(value / 1_000_000, maximumFractionDigits: 1) + "M"
        case 1000...:
            return decimal(value / 1000, maximumFractionDigits: 1) + "k"
        default:
            return decimal(value, maximumFractionDigits: 2)
        }
    }
}

// MARK: - Colour decoder (`#rrggbb` → sRGB components)

/// Decodes an explicit `#rrggbb` swatch (web series `color`) into sRGB components in `0...1`. Pure +
/// bundle-free so colour parity is asserted without rendering a view; the SwiftUI boundary builds a
/// `Color(.sRGB, …)` from the result and falls back to the brand chart palette when a value is absent
/// or malformed.
public enum AreaChartPalette {
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

    /// Parse a `#rrggbb` (or bare `rrggbb`) hex into sRGB components, or `nil` when absent / malformed.
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

/// Builds the surface's VoiceOver strings from already-localised + already-formatted parts, so the
/// spoken content is asserted without rendering the view. The web chart conveys each series only as a
/// coloured area + a tooltip label; the native summary names each series and speaks its latest / low /
/// high (or the friendly "no data" copy), so a non-sighted user gets the same information a sighted one
/// reads off the line.
public enum AreaChartAccessibility {
    /// A populated series summary from the localized template + already-formatted latest / low / high.
    public static func seriesSummary(
        template: String,
        label: String,
        latest: String,
        low: String,
        high: String
    ) -> String {
        String(format: template, label, latest, low, high)
    }

    /// The "no finite points" series summary from the localized template + the series label.
    public static func seriesEmpty(template: String, label: String) -> String {
        String(format: template, label)
    }

    /// The chart's spoken value — the per-series summaries joined into one phrase.
    public static func chartValue(summaries: [String]) -> String {
        summaries.joined(separator: ". ")
    }
}
