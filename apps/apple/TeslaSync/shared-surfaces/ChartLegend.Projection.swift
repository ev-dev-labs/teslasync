//
//  ChartLegend.Projection.swift
//  TeslaSync — P4 shared surface · 0068 · ChartLegend (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved, view-ready state — the
//  native port of the web `ChartLegend` render (the swatch + value entries, the dimmed + struck
//  hidden entries, the passive `resolved == null` branch) plus the P4 leaf contract (loading / error
//  / empty / withdrawn / stale / offline). Localization is applied here (P1/S10, via an injected
//  resolver) so the view is a pure function of the result and every branch is unit tested without a
//  store or SwiftUI.
//

import Foundation

// MARK: - Resolved entry (web legend entry, localized for display + VoiceOver)

/// One view-ready legend entry — the localized projection of a ``ChartLegendItem``: the label
/// (verbatim), the swatch (explicit hex + brand-palette fallback index), the hidden / interactive
/// flags driving the dim + strike + tappability, and the spoken label / value / hint. The view
/// renders this verbatim.
public struct ChartLegendRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let colorHex: String?
    public let paletteIndex: Int
    public let isHidden: Bool
    public let isInteractive: Bool
    public let accessibilityLabel: String
    public let accessibilityValue: String
    public let accessibilityHint: String?

    public init(
        id: String,
        label: String,
        colorHex: String?,
        paletteIndex: Int,
        isHidden: Bool,
        isInteractive: Bool,
        accessibilityLabel: String,
        accessibilityValue: String,
        accessibilityHint: String?
    ) {
        self.id = id
        self.label = label
        self.colorHex = colorHex
        self.paletteIndex = paletteIndex
        self.isHidden = isHidden
        self.isInteractive = isInteractive
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
        self.accessibilityHint = accessibilityHint
    }
}

// MARK: - Resolved freshness chip (P4 connectivity axis)

/// The freshness affordance shown beside the entries when the snapshot is not live — the localized
/// label, the VoiceOver label, and whether it represents the offline (vs stale) tone.
public struct ChartLegendFreshness: Sendable, Equatable {
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
public struct ChartLegendEmpty: Sendable, Equatable {
    public let title: String
    public let message: String

    public init(title: String, message: String) {
        self.title = title
        self.message = message
    }
}

/// The query-failure copy (the `QueryError` peer).
public struct ChartLegendErrorContent: Sendable, Equatable {
    public let message: String
    public let accessibilityLabel: String

    public init(message: String, accessibilityLabel: String) {
        self.message = message
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the rendered body; `legendAccessibilityLabel`
/// names the entry group for VoiceOver; `freshness` + `alignment` decorate the populated legend.
public struct ChartLegendResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Series still resolving (parent chart fetch) → skeleton chrome.
        case loading
        /// Series fetch failed → a `QueryError` peer with retry.
        case error(ChartLegendErrorContent)
        /// Resolved + empty, `.emptyState` policy → friendly empty state.
        case empty(ChartLegendEmpty)
        /// Resolved + empty, `.withdraw` policy → render nothing (Recharts empty-payload peer).
        case withdrawn
        /// Resolved + non-empty → the legend entries.
        case populated([ChartLegendRow])
    }

    public let phase: Phase
    public let legendAccessibilityLabel: String
    public let alignment: ChartLegendAlignment
    public let freshness: ChartLegendFreshness?

    public init(
        phase: Phase,
        legendAccessibilityLabel: String,
        alignment: ChartLegendAlignment = .center,
        freshness: ChartLegendFreshness? = nil
    ) {
        self.phase = phase
        self.legendAccessibilityLabel = legendAccessibilityLabel
        self.alignment = alignment
        self.freshness = freshness
    }

    /// Whether the surface is showing its actual content (populated entries or the friendly empty
    /// state) — the moment the surface is considered "opened" for the P1/S11 `view.opened` event.
    /// Loading is pre-content, `error` is failure chrome, and `withdrawn` is the empty-payload
    /// collapse (the surface was never opened), so none of those count.
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
/// `ChartLegend` render plus the P4 leaf contract. Unit tested across loading / error / empty (both
/// policies) / populated, the interactive vs passive branch, the hidden-entry dim, and the carried
/// connectivity axis.
public enum ChartLegendProjection {
    public static func resolve(
        _ input: ChartLegendInput,
        strings: ChartLegendResolve = ChartLegendStrings.string
    ) -> ChartLegendResolved {
        let groupLabel = strings("chartLegend.a11y.group", "Chart legend")

        switch input.availability {
        case .loading:
            return ChartLegendResolved(
                phase: .loading,
                legendAccessibilityLabel: groupLabel,
                alignment: input.alignment
            )

        case let .failed(message):
            return ChartLegendResolved(
                phase: .error(errorContent(message, strings: strings)),
                legendAccessibilityLabel: groupLabel,
                alignment: input.alignment
            )

        case let .resolved(items):
            guard !items.isEmpty else {
                switch input.emptyBehavior {
                case .withdraw:
                    return ChartLegendResolved(
                        phase: .withdrawn,
                        legendAccessibilityLabel: groupLabel,
                        alignment: input.alignment
                    )
                case .emptyState:
                    return ChartLegendResolved(
                        phase: .empty(empty(strings: strings)),
                        legendAccessibilityLabel: groupLabel,
                        alignment: input.alignment
                    )
                }
            }
            let interactive = input.interactivity.isInteractive
            let rows = items.map { row(for: $0, interactive: interactive, hidden: input.hidden, strings: strings) }
            return ChartLegendResolved(
                phase: .populated(rows),
                legendAccessibilityLabel: groupLabel,
                alignment: input.alignment,
                freshness: freshness(for: input.connection, strings: strings)
            )
        }
    }

    // MARK: Entry (web entry body, localized)

    private static func row(
        for item: ChartLegendItem,
        interactive: Bool,
        hidden: Set<String>,
        strings: ChartLegendResolve
    ) -> ChartLegendRow {
        // Web parity: `resolved?.isHidden(key) ?? false` — a passive legend never dims (there is no
        // toggle source), so the hidden set only applies when interactive.
        let isHidden = interactive && hidden.contains(item.id)
        let value = ChartLegendAccessibility.entryValue(
            isInteractive: interactive,
            isHidden: isHidden,
            shown: strings("chartLegend.entry.shown", "Shown"),
            hidden: strings("chartLegend.entry.hidden", "Hidden")
        )
        let hint = interactive
            ? strings("chartLegend.entry.toggleHint", "Double tap to toggle this series")
            : nil
        return ChartLegendRow(
            id: item.id,
            label: item.label,
            colorHex: item.colorHex,
            paletteIndex: item.paletteIndex,
            isHidden: isHidden,
            isInteractive: interactive,
            accessibilityLabel: ChartLegendAccessibility.entryLabel(name: item.label),
            accessibilityValue: value,
            accessibilityHint: hint
        )
    }

    // MARK: Empty / error chrome

    private static func empty(strings: ChartLegendResolve) -> ChartLegendEmpty {
        ChartLegendEmpty(
            title: strings("chartLegend.empty.title", "No series"),
            message: strings(
                "chartLegend.empty.message",
                "This chart has no series to show in the legend yet."
            )
        )
    }

    private static func errorContent(_ message: String, strings: ChartLegendResolve) -> ChartLegendErrorContent {
        let resolved = message.isEmpty
            ? strings("chartLegend.error.message", "Couldn't load the chart legend.")
            : message
        return ChartLegendErrorContent(
            message: resolved,
            accessibilityLabel: "\(strings("chartLegend.error.title", "Couldn't load the chart legend")): \(resolved)"
        )
    }

    // MARK: Freshness (P4 connectivity axis)

    /// The freshness chip for a connection — `nil` when live (the entries stand alone), else a stale
    /// / offline chip with a refresh hint.
    private static func freshness(
        for connection: ChartLegendConnection,
        strings: ChartLegendResolve
    ) -> ChartLegendFreshness? {
        switch connection {
        case .live:
            nil
        case .stale:
            ChartLegendFreshness(
                label: strings("chartLegend.freshness.stale", "Stale"),
                accessibilityLabel: strings("chartLegend.freshness.staleA11y", "Stale — tap to refresh"),
                isOffline: false
            )
        case .offline:
            ChartLegendFreshness(
                label: strings("chartLegend.freshness.offline", "Offline"),
                accessibilityLabel: strings(
                    "chartLegend.freshness.offlineA11y",
                    "Offline — showing the last known series"
                ),
                isOffline: true
            )
        }
    }
}
