//
//  AnnotationList.Projection.swift
//  TeslaSync — P4 shared surface · 0063 · AnnotationList (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved, view-ready state — the
//  native port of the web `AnnotationList` render (the title, the per-category rows, the empty
//  `null` collapse) plus the P4 leaf contract (loading / error / stale / offline). Localization is
//  applied here (P1/S10, via an injected resolver) so the view is a pure function of the result and
//  every branch is unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Resolved row (web row, localized for display + VoiceOver)

/// One view-ready row — the localized projection of an ``AnnotationListItem``: the label, the
/// optional description, the timestamp, the category colour swatch + spoken name, and the combined
/// accessibility + remove labels. The view renders this verbatim.
public struct AnnotationListRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let description: String?
    public let timestamp: String
    public let colorHex: String
    public let categoryName: String
    public let accessibilityLabel: String
    public let removeAccessibilityLabel: String

    public init(
        id: String,
        label: String,
        description: String?,
        timestamp: String,
        colorHex: String,
        categoryName: String,
        accessibilityLabel: String,
        removeAccessibilityLabel: String
    ) {
        self.id = id
        self.label = label
        self.description = description
        self.timestamp = timestamp
        self.colorHex = colorHex
        self.categoryName = categoryName
        self.accessibilityLabel = accessibilityLabel
        self.removeAccessibilityLabel = removeAccessibilityLabel
    }
}

// MARK: - Resolved freshness chip (P4 connectivity axis)

/// The freshness affordance shown beside the title when the snapshot is not live — the localized
/// label, the VoiceOver label, and whether it represents the offline (vs stale) tone.
public struct AnnotationListFreshness: Sendable, Equatable {
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
public struct AnnotationListEmpty: Sendable, Equatable {
    public let title: String
    public let message: String

    public init(title: String, message: String) {
        self.title = title
        self.message = message
    }
}

/// The query-failure copy (the `QueryError` peer).
public struct AnnotationListErrorContent: Sendable, Equatable {
    public let message: String
    public let accessibilityLabel: String

    public init(message: String, accessibilityLabel: String) {
        self.message = message
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the rendered body; `title` + `freshness` decorate
/// the populated list header.
public struct AnnotationListResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Data still resolving (web parent fetch) → skeleton chrome.
        case loading
        /// Data fetch failed → a `QueryError` peer with retry.
        case error(AnnotationListErrorContent)
        /// Resolved + empty, `.emptyState` policy → friendly empty state.
        case empty(AnnotationListEmpty)
        /// Resolved + empty, `.withdraw` policy → render nothing (faithful web `null`).
        case withdrawn
        /// Resolved + non-empty → the title + rows.
        case populated([AnnotationListRow])
    }

    public let phase: Phase
    public let title: String
    public let freshness: AnnotationListFreshness?

    public init(phase: Phase, title: String, freshness: AnnotationListFreshness? = nil) {
        self.phase = phase
        self.title = title
        self.freshness = freshness
    }

    /// Whether the surface is showing its actual content (populated rows or the friendly empty
    /// state) — the moment the surface is considered "opened" for the P1/S11 `view.opened` event.
    /// Loading is pre-content, `error` is failure chrome, and `withdrawn` is the web `null` (the
    /// surface was never opened), so none of those count.
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
/// `AnnotationList` render plus the P4 leaf contract. Unit tested across loading / error / empty
/// (both policies) / populated and the carried connectivity axis.
public enum AnnotationListProjection {
    public static func resolve(
        _ input: AnnotationListInput,
        strings: AnnotationListResolve = AnnotationListStrings.string
    ) -> AnnotationListResolved {
        let title = strings("annotation.listTitle", "Annotations")

        switch input.availability {
        case .loading:
            return AnnotationListResolved(phase: .loading, title: title)

        case let .failed(message):
            return AnnotationListResolved(phase: .error(errorContent(message, strings: strings)), title: title)

        case let .resolved(items):
            guard !items.isEmpty else {
                switch input.emptyBehavior {
                case .withdraw:
                    return AnnotationListResolved(phase: .withdrawn, title: title)
                case .emptyState:
                    return AnnotationListResolved(phase: .empty(empty(strings: strings)), title: title)
                }
            }
            let rows = items.map { row(for: $0, strings: strings) }
            return AnnotationListResolved(
                phase: .populated(rows),
                title: title,
                freshness: freshness(for: input.connection, strings: strings)
            )
        }
    }

    // MARK: Row (web row body, localized)

    private static func row(for item: AnnotationListItem, strings: AnnotationListResolve) -> AnnotationListRow {
        let categoryName = strings(item.category.labelKey, item.category.labelFallback)
        let removeBase = strings("annotation.remove", "Remove annotation")
        return AnnotationListRow(
            id: item.id,
            label: item.label,
            description: item.description,
            timestamp: item.timestamp,
            colorHex: item.category.colorHex,
            categoryName: categoryName,
            accessibilityLabel: AnnotationListAccessibility.rowLabel(
                category: categoryName,
                label: item.label,
                description: item.description,
                timestamp: item.timestamp
            ),
            removeAccessibilityLabel: AnnotationListAccessibility.removeLabel(base: removeBase, label: item.label)
        )
    }

    // MARK: Empty / error chrome

    private static func empty(strings: AnnotationListResolve) -> AnnotationListEmpty {
        AnnotationListEmpty(
            title: strings("annotation.empty.title", "No annotations"),
            message: strings(
                "annotation.empty.message",
                "Add an annotation to mark milestones, maintenance, or notes on this chart."
            )
        )
    }

    private static func errorContent(_ message: String, strings: AnnotationListResolve) -> AnnotationListErrorContent {
        let resolved = message.isEmpty
            ? strings("annotation.error.message", "Couldn't load annotations.")
            : message
        return AnnotationListErrorContent(
            message: resolved,
            accessibilityLabel: "\(strings("annotation.error.title", "Couldn't load annotations")): \(resolved)"
        )
    }

    // MARK: Freshness (P4 connectivity axis)

    /// The freshness chip for a connection — `nil` when live (the rows stand alone), else a stale /
    /// offline chip with a refresh hint.
    private static func freshness(
        for connection: AnnotationListConnection,
        strings: AnnotationListResolve
    ) -> AnnotationListFreshness? {
        switch connection {
        case .live:
            nil
        case .stale:
            AnnotationListFreshness(
                label: strings("annotation.freshness.stale", "Stale"),
                accessibilityLabel: strings("annotation.freshness.staleA11y", "Stale — tap to refresh"),
                isOffline: false
            )
        case .offline:
            AnnotationListFreshness(
                label: strings("annotation.freshness.offline", "Offline"),
                accessibilityLabel: strings(
                    "annotation.freshness.offlineA11y",
                    "Offline — showing the last known annotations"
                ),
                isOffline: true
            )
        }
    }
}
