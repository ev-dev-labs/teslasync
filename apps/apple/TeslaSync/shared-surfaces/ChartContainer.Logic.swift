//
//  ChartContainer.Logic.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The pure decision core for the chart-framing surface — the verbatim port of the web
//  `ChartContainer` booleans and helpers: the localisation seam (web `t(key, default)`), the
//  writing-direction label anchor (`useChartLabelAnchor` / `textAnchorForDir`), the accessible
//  fallback-table cell model (`ChartDataRow` / `ChartDataColumn` + the `null → —` cell rule), the
//  export-menu / fallback-table / annotation gating booleans, the hidden-preference storage key, the
//  add/remove validation, and the VoiceOver string builders. Foundation-only so every web branch is
//  asserted without rendering.
//

import Foundation

// MARK: - Localisation seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: production passes the
/// P1/S10 facade, tests pass the identity resolver.
public typealias ChartContainerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Writing direction + label anchor (web `useChartLabelAnchor` / `textAnchorForDir`)

/// The writing direction of the active locale — the native port of the web `Direction` (`getLangDir`
/// result). Drives the annotation-label anchor flip so reference labels sit on the readable side in
/// both LTR and RTL.
public enum ChartContainerDirection: String, Sendable, Equatable {
    case ltr
    case rtl

    /// ISO-639-1 primary subtags that render right-to-left (web `RTL_LANGS`: ar, he, fa, ur).
    private static let rtlPrimary: Set<String> = ["ar", "he", "fa", "ur"]

    /// Resolves the direction for an i18next-style language tag — lowercased + split on `-` so region
    /// subtags resolve to their primary (web `getLangDir`). Empty / nil falls back to `.ltr`.
    public static func resolve(_ lang: String?) -> ChartContainerDirection {
        guard let lang, !lang.isEmpty else { return .ltr }
        let primary = lang.lowercased().split(separator: "-").first.map(String.init) ?? ""
        return rtlPrimary.contains(primary) ? .rtl : .ltr
    }
}

/// A horizontal text anchor for a chart axis label — the native port of the web Recharts
/// `'start' | 'middle' | 'end'` anchor (`textAnchorForDir`).
public enum ChartContainerTextAnchor: String, Sendable, Equatable {
    case start
    case middle
    case end
}

/// Resolves the annotation-label anchor — the verbatim port of `textAnchorForDir`: the x axis is
/// always centred; the y axis flips to `start` in RTL and `end` in LTR so the label hugs the
/// readable edge.
public enum ChartContainerLabelAnchor {
    public static func anchor(
        axis: ChartContainerAxis,
        direction: ChartContainerDirection
    ) -> ChartContainerTextAnchor {
        switch axis {
        case .x: .middle
        case .y: direction == .rtl ? .start : .end
        }
    }
}

/// The chart axis a label is attached to (web `textAnchorForDir` `axis` argument).
public enum ChartContainerAxis: String, Sendable, Equatable {
    case x
    case y
}

// MARK: - Fallback-table cell model (web `ChartDataRow` / `ChartDataColumn`)

/// One cell value for the accessible fallback table — the native port of the web row value
/// (`string | number | null | undefined`). `missing` is the null/undefined case the table renders
/// as the em-dash marker.
public enum ChartContainerCell: Sendable, Equatable {
    case text(String)
    case number(Double)
    case missing
}

/// A fallback-table column definition — the native port of the web `ChartDataColumn`: the row key,
/// the pre-localised header, and an optional unit-aware formatter that runs once per cell.
public struct ChartContainerDataColumn: Sendable, Identifiable {
    public let key: String
    public let label: String
    public let format: (@Sendable (ChartContainerCell) -> String)?

    public var id: String {
        key
    }

    public init(key: String, label: String, format: (@Sendable (ChartContainerCell) -> String)? = nil) {
        self.key = key
        self.label = label
        self.format = format
    }
}

/// A fallback-table row — a column-key → cell map (web `ChartDataRow`).
public typealias ChartContainerDataRow = [String: ChartContainerCell]

// MARK: - Pure decision logic (web `ChartContainer` booleans)

/// The pure decision logic ported from the web `ChartContainer`. Each function is a direct
/// translation of a web boolean / helper so the view stays a pure function of these and every branch
/// is unit tested without rendering.
public enum ChartContainerLogic {
    /// The `localStorage` key prefix the web uses to persist the per-chart hidden-annotations toggle.
    public static let hiddenStoragePrefix = "teslasync-annotations-hidden:"

    /// Web `HIDDEN_STORAGE_PREFIX + key` — the persisted hidden-annotations preference key.
    public static func hiddenStorageKey(_ annotationKey: String) -> String {
        hiddenStoragePrefix + annotationKey
    }

    /// Web `showExportMenu = exportable && !loading && !empty` — the image actions only make sense
    /// once the chart has rendered with data.
    public static func showExportMenu(exportable: Bool, loading: Bool, empty: Bool) -> Bool {
        exportable && !loading && !empty
    }

    /// Web `hasFallbackTable = !!(data && data.length && dataColumns && dataColumns.length)`.
    public static func hasFallbackTable(rowCount: Int, columnCount: Int) -> Bool {
        rowCount > 0 && columnCount > 0
    }

    /// Web `visibleAnnotations = enabled && !hidden ? fetched : []` — the visible list collapses to
    /// empty whenever the overlay is toggled off, so reference overlays naturally disappear.
    public static func visibleAnnotations(
        enabled: Bool,
        hidden: Bool,
        fetched: [ChartContainerAnnotation]
    ) -> [ChartContainerAnnotation] {
        enabled && !hidden ? fetched : []
    }

    /// Web `showMarkerRow = enabled && !hidden && visibleAnnotations.length > 0`.
    public static func showMarkerRow(enabled: Bool, hidden: Bool, visibleCount: Int) -> Bool {
        enabled && !hidden && visibleCount > 0
    }

    /// Web add-annotation guard: the popover only commits when an `occurredAt` timestamp is present
    /// (`if (!occurredAt) return`) and the label is non-empty.
    public static func isValidNewAnnotation(label: String, occurredAt: String) -> Bool {
        !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !occurredAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Web remove guard: `const n = Number(id); if (!Number.isFinite(n) || n <= 0) return`. A
    /// non-numeric or non-positive id is rejected.
    public static func isRemovableID(_ id: String) -> Bool {
        guard let numeric = Int64(id) else { return false }
        return numeric > 0
    }

    /// Web cell rendering: `format ? format(raw) : raw == null ? '—' : String(raw)`.
    public static func cellText(_ cell: ChartContainerCell, format: ((ChartContainerCell) -> String)?) -> String {
        if let format { return format(cell) }
        switch cell {
        case let .text(value): return value
        case let .number(value): return Self.defaultNumberText(value)
        case .missing: return "—"
        }
    }

    /// Default numeric stringification (web `String(raw)`): integral values render without a
    /// trailing `.0`, everything else uses its shortest round-trippable form.
    static func defaultNumberText(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}

// MARK: - CSV serialisation (web `objectsToCSV` / "Download data as CSV")

/// Serialises the fallback-table data to CSV — the native port of the web `objectsToCSV`. The header
/// is the column labels; each row reads the cell through the same `format ?? (null → —)` rule the
/// visible table uses, so the export reads in the units the chart shows. Fields containing a comma,
/// quote, or newline are double-quoted with embedded quotes doubled (RFC 4180).
public enum ChartContainerCsv {
    public static func serialize(columns: [ChartContainerDataColumn], rows: [ChartContainerDataRow]) -> String {
        guard !columns.isEmpty else { return "" }
        var lines: [String] = []
        lines.append(columns.map { escape($0.label) }.joined(separator: ","))
        for row in rows {
            let cells = columns.map { column -> String in
                escape(ChartContainerLogic.cellText(row[column.key] ?? .missing, format: column.format))
            }
            lines.append(cells.joined(separator: ","))
        }
        return lines.joined(separator: "\n")
    }

    static func escape(_ field: String) -> String {
        guard field.contains(",") || field.contains("\"") || field.contains("\n") else { return field }
        return "\"\(field.replacingOccurrences(of: "\"", with: "\"\""))\""
    }
}

// MARK: - Accessibility (testable seam — web figure / figcaption strings)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering. Mirrors the web figure `role="img" aria-label`, the figcaption table
/// caption, and the bare summary fallback.
public enum ChartContainerAccessibility {
    /// The chart figure's accessible name — the web `ariaLabel`, suffixed with the freshness note
    /// when the snapshot is not live so a non-sighted user learns the chart reflects older data.
    public static func figureLabel(ariaLabel: String, freshnessNote: String, isLive: Bool) -> String {
        isLive ? ariaLabel : "\(ariaLabel), \(freshnessNote)"
    }

    /// The fallback-table caption — web `t('chart.a11y.fallbackTableLabel', '{{title}} — data table')`.
    public static func fallbackTableLabel(template: String, title: String) -> String {
        interpolateTitle(template, title: title, fallback: "\(title) — data table")
    }

    /// The bare summary — web `t('chart.a11y.summary', 'Chart: {{title}}')`.
    public static func summary(template: String, title: String) -> String {
        interpolateTitle(template, title: title, fallback: "Chart: \(title)")
    }

    /// Substitutes the i18next `{{title}}` token; if the resolved template lacks the token the
    /// English fallback (already interpolated) is used so the spoken string is never a raw template.
    static func interpolateTitle(_ template: String, title: String, fallback: String) -> String {
        guard template.contains("{{title}}") else { return fallback }
        return template.replacingOccurrences(of: "{{title}}", with: title)
    }
}
