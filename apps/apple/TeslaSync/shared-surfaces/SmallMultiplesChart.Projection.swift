//
//  SmallMultiplesChart.Projection.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved, view-ready state — the
//  native port of the web `SmallMultiplesChart` render (the per-series grid, the per-cell projected +
//  downsampled points, the per-cell `'No data'` fallback, the optional cell drill-in) plus the P4
//  leaf contract (loading / error / empty / withdrawn / stale / offline). The per-cell projection
//  (`SmallMultiplesCells.project`) is applied here, then localization (P1/S10, via an injected
//  resolver) so the view is a pure function of the result and every branch is unit tested without a
//  store or SwiftUI.
//

import Foundation

// MARK: - Resolved cell (web cell, localized for display + VoiceOver)

/// One view-ready cell — the localized projection of a ``SmallMultiplesCell``: the label, the swatch
/// (explicit hex + brand-palette fallback index), the downsampled finite points, the `hasData` flag
/// choosing chart vs fallback, the interactivity flag driving the drill-in button, the localized
/// empty-cell label (web `emptyCellLabel ?? t('smallMultiples.noData')`), and the spoken label /
/// value / hint. The view renders this verbatim.
public struct SmallMultiplesCellRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let colorHex: String?
    public let colorIndex: Int
    public let points: [SmallMultiplesPoint]
    public let hasData: Bool
    public let isInteractive: Bool
    public let emptyLabel: String
    public let accessibilityLabel: String
    public let accessibilityValue: String
    public let accessibilityHint: String?

    public init(
        id: String,
        label: String,
        colorHex: String?,
        colorIndex: Int,
        points: [SmallMultiplesPoint],
        hasData: Bool,
        isInteractive: Bool,
        emptyLabel: String,
        accessibilityLabel: String,
        accessibilityValue: String,
        accessibilityHint: String?
    ) {
        self.id = id
        self.label = label
        self.colorHex = colorHex
        self.colorIndex = colorIndex
        self.points = points
        self.hasData = hasData
        self.isInteractive = isInteractive
        self.emptyLabel = emptyLabel
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
        self.accessibilityHint = accessibilityHint
    }
}

// MARK: - Resolved layout (web responsive grid knobs)

/// The grid layout the populated view applies — the native peer of the web grid props: an optional
/// fixed `columns` (web `repeat(columns, 1fr)`), the adaptive minimum cell width (web `auto-fill
/// minmax(cellMinWidth, 1fr)`), and the per-cell height.
public struct SmallMultiplesLayout: Sendable, Equatable {
    public let columns: Int?
    public let cellMinWidth: Double
    public let cellHeight: Double

    public init(columns: Int?, cellMinWidth: Double, cellHeight: Double) {
        self.columns = columns
        self.cellMinWidth = cellMinWidth
        self.cellHeight = cellHeight
    }

    /// The resolved column count for an available width — the native parity of CSS `auto-fill
    /// minmax(cellMinWidth, 1fr)`: as many `cellMinWidth`-wide columns (plus inter-column spacing) as
    /// fit, at least one; a forced `columns` overrides it. Pure so the packing is unit tested.
    public static func columnCount(
        availableWidth: Double,
        cellMinWidth: Double,
        spacing: Double = 12,
        forced: Int? = nil
    ) -> Int {
        if let forced, forced > 0 {
            return forced
        }
        guard availableWidth > 0, cellMinWidth > 0 else { return 1 }
        let fit = Int(((availableWidth + spacing) / (cellMinWidth + spacing)).rounded(.down))
        return max(1, fit)
    }
}

// MARK: - Resolved freshness chip (P4 connectivity axis)

/// The freshness affordance shown above the grid when the snapshot is not live — the localized label,
/// the VoiceOver label, and whether it represents the offline (vs stale) tone.
public struct SmallMultiplesFreshness: Sendable, Equatable {
    public let label: String
    public let accessibilityLabel: String
    public let isOffline: Bool

    public init(label: String, accessibilityLabel: String, isOffline: Bool) {
        self.label = label
        self.accessibilityLabel = accessibilityLabel
        self.isOffline = isOffline
    }
}

// MARK: - Resolved empty / error chrome

/// The friendly empty-state copy (P4 "never a blank box").
public struct SmallMultiplesEmpty: Sendable, Equatable {
    public let title: String
    public let message: String

    public init(title: String, message: String) {
        self.title = title
        self.message = message
    }
}

/// The query-failure copy (the `QueryError` peer).
public struct SmallMultiplesErrorContent: Sendable, Equatable {
    public let message: String
    public let accessibilityLabel: String

    public init(message: String, accessibilityLabel: String) {
        self.message = message
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the rendered body; `gridAccessibilityLabel` names
/// the cell grid for VoiceOver; `layout` + `freshness` decorate the populated grid.
public struct SmallMultiplesResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Data still resolving (host fetch) → skeleton grid.
        case loading
        /// Data fetch failed → a `QueryError` peer with retry.
        case error(SmallMultiplesErrorContent)
        /// Resolved + no series, `.emptyState` policy → friendly empty state.
        case empty(SmallMultiplesEmpty)
        /// Resolved + no series, `.withdraw` policy → render nothing (web empty-grid peer).
        case withdrawn
        /// Resolved + at least one series → the per-cell grid (cells may individually be empty).
        case populated([SmallMultiplesCellRow])
    }

    public let phase: Phase
    public let gridAccessibilityLabel: String
    public let layout: SmallMultiplesLayout
    public let freshness: SmallMultiplesFreshness?

    public init(
        phase: Phase,
        gridAccessibilityLabel: String,
        layout: SmallMultiplesLayout,
        freshness: SmallMultiplesFreshness? = nil
    ) {
        self.phase = phase
        self.gridAccessibilityLabel = gridAccessibilityLabel
        self.layout = layout
        self.freshness = freshness
    }

    /// Whether the surface is showing its actual content (the cell grid or the friendly empty state) —
    /// the moment the surface is considered "opened" for the P1/S11 `view.opened` event. Loading is
    /// pre-content, `error` is failure chrome, and `withdrawn` is the empty-grid collapse, so none of
    /// those count.
    public var presentsContent: Bool {
        switch phase {
        case .populated, .empty:
            true
        case .loading, .error, .withdrawn:
            false
        }
    }
}

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `SmallMultiplesChart` render plus the P4 leaf contract. Unit tested across loading / error / empty
/// (both policies) / populated, the per-cell projection + downsample, the interactive vs passive
/// drill-in, the per-cell empty label, and the carried connectivity + layout axes.
public enum SmallMultiplesProjection {
    public static func resolve(
        _ input: SmallMultiplesInput,
        strings: SmallMultiplesResolve = SmallMultiplesStrings.string
    ) -> SmallMultiplesResolved {
        let gridLabel = strings("smallMultiples.a11y.grid", "Small multiples chart")
        let layout = SmallMultiplesLayout(
            columns: input.columns,
            cellMinWidth: input.cellMinWidth,
            cellHeight: input.cellHeight
        )

        switch input.availability {
        case .loading:
            return SmallMultiplesResolved(
                phase: .loading,
                gridAccessibilityLabel: gridLabel,
                layout: layout
            )

        case let .failed(message):
            return SmallMultiplesResolved(
                phase: .error(errorContent(message, strings: strings)),
                gridAccessibilityLabel: gridLabel,
                layout: layout
            )

        case let .resolved(data):
            guard !data.series.isEmpty else {
                switch input.emptyBehavior {
                case .withdraw:
                    return SmallMultiplesResolved(
                        phase: .withdrawn,
                        gridAccessibilityLabel: gridLabel,
                        layout: layout
                    )
                case .emptyState:
                    return SmallMultiplesResolved(
                        phase: .empty(empty(strings: strings)),
                        gridAccessibilityLabel: gridLabel,
                        layout: layout
                    )
                }
            }
            let cells = SmallMultiplesCells.project(
                samples: data.samples,
                series: data.series,
                maxPointsPerCell: input.maxPointsPerCell
            )
            let interactive = input.interactivity.isInteractive
            let rows = cells.map { row(for: $0, interactive: interactive, strings: strings) }
            return SmallMultiplesResolved(
                phase: .populated(rows),
                gridAccessibilityLabel: gridLabel,
                layout: layout,
                freshness: freshness(for: input.connection, strings: strings)
            )
        }
    }

    // MARK: Cell (web cell body, localized)

    private static func row(
        for cell: SmallMultiplesCell,
        interactive: Bool,
        strings: SmallMultiplesResolve
    ) -> SmallMultiplesCellRow {
        let noData = strings("smallMultiples.noData", "No data")
        let summaryTemplate = strings("smallMultiples.a11y.summary", "Latest %1$@, low %2$@, high %3$@")
        let values = cell.points.map(\.value)
        let summary = SmallMultiplesAccessibility.summaryLabel(
            template: summaryTemplate,
            latest: SmallMultiplesAxis.numberLabel(values.last ?? .nan),
            minimum: SmallMultiplesAxis.numberLabel(values.min() ?? .nan),
            maximum: SmallMultiplesAxis.numberLabel(values.max() ?? .nan)
        )
        let value = SmallMultiplesAccessibility.cellValue(
            hasData: cell.hasData,
            noData: noData,
            summary: summary
        )
        let hint = SmallMultiplesAccessibility.cellHint(
            isInteractive: interactive,
            openHint: strings("smallMultiples.cell.openHint", "Double tap to open this series")
        )
        return SmallMultiplesCellRow(
            id: cell.id,
            label: cell.label,
            colorHex: cell.colorHex,
            colorIndex: cell.colorIndex,
            points: cell.points,
            hasData: cell.hasData,
            isInteractive: interactive,
            emptyLabel: noData,
            accessibilityLabel: SmallMultiplesAccessibility.cellLabel(name: cell.label),
            accessibilityValue: value,
            accessibilityHint: hint
        )
    }

    // MARK: Empty / error chrome

    private static func empty(strings: SmallMultiplesResolve) -> SmallMultiplesEmpty {
        SmallMultiplesEmpty(
            title: strings("smallMultiples.empty.title", "No series"),
            message: strings(
                "smallMultiples.empty.message",
                "There are no series to chart yet."
            )
        )
    }

    private static func errorContent(
        _ message: String,
        strings: SmallMultiplesResolve
    ) -> SmallMultiplesErrorContent {
        let resolved = message.isEmpty
            ? strings("smallMultiples.error.message", "Couldn't load the chart.")
            : message
        let title = strings("smallMultiples.error.title", "Couldn't load the chart")
        return SmallMultiplesErrorContent(
            message: resolved,
            accessibilityLabel: "\(title): \(resolved)"
        )
    }

    // MARK: Freshness (P4 connectivity axis)

    /// The freshness chip for a connection — `nil` when live (the cells stand alone), else a stale /
    /// offline chip with a refresh hint.
    private static func freshness(
        for connection: SmallMultiplesConnection,
        strings: SmallMultiplesResolve
    ) -> SmallMultiplesFreshness? {
        switch connection {
        case .live:
            nil
        case .stale:
            SmallMultiplesFreshness(
                label: strings("smallMultiples.freshness.stale", "Stale"),
                accessibilityLabel: strings("smallMultiples.freshness.staleA11y", "Stale — tap to refresh"),
                isOffline: false
            )
        case .offline:
            SmallMultiplesFreshness(
                label: strings("smallMultiples.freshness.offline", "Offline"),
                accessibilityLabel: strings(
                    "smallMultiples.freshness.offlineA11y",
                    "Offline — showing the last known data"
                ),
                isOffline: true
            )
        }
    }
}
