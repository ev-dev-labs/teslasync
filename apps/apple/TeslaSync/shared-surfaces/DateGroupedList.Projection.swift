//
//  DateGroupedList.Projection.swift
//  TeslaSync — P4 shared surface · 0080 · DateGroupedList (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved, view-ready state — the
//  native port of the web `DateGroupedList` render (the per-group divider header with its optional
//  relative label + optional caller summary, and the empty-`groups` branch). Localization is applied
//  here (P1/S10, via an injected resolver) so the view is a pure function of the result and every
//  branch is unit tested without a store or SwiftUI. The generic item payload is intentionally absent
//  — it flows through the view's row builder (the web `renderItem` parity); the projection reasons
//  only over the header metadata + the per-group item count.
//

import Foundation

// MARK: - Resolved header (web divider row, localized for display + VoiceOver)

/// One view-ready divider header — the localized projection of a ``DateGroupedListGroupHeader``: the
/// primary date label, the optional relative-time label, the optional pre-formatted summary (each
/// rendered verbatim, as the web does), and the combined VoiceOver section label. The view renders
/// these fields directly; `dateKey` matches the header back to its generic group for the row builder.
public struct DateGroupedListResolvedHeader: Sendable, Equatable, Identifiable {
    public let dateKey: String
    public let dateLabel: String
    public let relativeLabel: String?
    public let summary: String?
    public let accessibilityLabel: String

    public var id: String {
        dateKey
    }

    public init(
        dateKey: String,
        dateLabel: String,
        relativeLabel: String?,
        summary: String?,
        accessibilityLabel: String
    ) {
        self.dateKey = dateKey
        self.dateLabel = dateLabel
        self.relativeLabel = relativeLabel
        self.summary = summary
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved empty chrome (P4 "never a blank box")

/// The friendly empty-state copy shown when `groups` is empty — the P4 upgrade of the web blank
/// container, so the standalone shared surface is never a bare box.
public struct DateGroupedListEmpty: Sendable, Equatable {
    public let title: String
    public let message: String

    public init(title: String, message: String) {
        self.title = title
        self.message = message
    }
}

// MARK: - Resolved view-state (web render branches)

/// The resolved, view-ready state. `phase` selects the rendered body: the friendly empty state when
/// there are no groups (web blank container), else the ordered divider headers the view pairs with
/// its generic groups to render items.
public struct DateGroupedListResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// No groups → the friendly empty state (P4 "never a blank box"; web renders a blank div).
        case empty(DateGroupedListEmpty)
        /// One or more groups → the ordered, localized divider headers.
        case populated([DateGroupedListResolvedHeader])
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }

    /// The surface always presents content (the populated list or the friendly empty state) — there
    /// is no pre-content loading gate because the web source has no fetch — so the first appearance
    /// is the `view.opened` moment (P1/S11).
    public var presentsContent: Bool {
        true
    }

    /// The number of resolved groups (0 in the empty phase) — a convenience for tests + previews.
    public var groupCount: Int {
        switch phase {
        case .empty: 0
        case let .populated(headers): headers.count
        }
    }
}

// MARK: - Projection (web component body)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `DateGroupedList` render. Unit tested across the empty branch and the populated branch (header
/// mapping, the optional relative / summary fields, and the spoken section label with its item-count
/// fallback).
public enum DateGroupedListProjection {
    public static func resolve(
        _ input: DateGroupedListInput,
        strings: DateGroupedListResolve = DateGroupedListStrings.string
    ) -> DateGroupedListResolved {
        guard !input.headers.isEmpty else {
            return DateGroupedListResolved(phase: .empty(emptyContent(strings: strings)))
        }
        let headers = input.headers.map { resolvedHeader(for: $0, strings: strings) }
        return DateGroupedListResolved(phase: .populated(headers))
    }

    // MARK: Header (web divider row, localized)

    private static func resolvedHeader(
        for header: DateGroupedListGroupHeader,
        strings: DateGroupedListResolve
    ) -> DateGroupedListResolvedHeader {
        // The spoken summary falls back to a localized item count when the caller passes none, so a
        // VoiceOver user always hears the group size even though the sighted layout shows only the
        // rule. The visible `summary` stays verbatim (nil when absent — the web omits the span).
        let spokenSummary = header.summary ?? itemCountText(header.itemCount, strings: strings)
        return DateGroupedListResolvedHeader(
            dateKey: header.dateKey,
            dateLabel: header.dateLabel,
            relativeLabel: header.relativeLabel,
            summary: header.summary,
            accessibilityLabel: DateGroupedListAccessibility.sectionLabel(
                dateLabel: header.dateLabel,
                relativeLabel: header.relativeLabel,
                summary: spokenSummary
            )
        )
    }

    /// The localized "{n} item(s)" spoken fallback — singular / plural by count so VoiceOver never
    /// announces a grammatically wrong "1 items".
    private static func itemCountText(_ count: Int, strings: DateGroupedListResolve) -> String {
        let format = count == 1
            ? strings("dategroupedlist.a11y.itemCount.one", "%lld item")
            : strings("dategroupedlist.a11y.itemCount.other", "%lld items")
        return String(format: format, count)
    }

    // MARK: Empty chrome (P4 leaf state)

    private static func emptyContent(strings: DateGroupedListResolve) -> DateGroupedListEmpty {
        DateGroupedListEmpty(
            title: strings("dategroupedlist.empty.title", "Nothing here yet"),
            message: strings(
                "dategroupedlist.empty.message",
                "Items will appear here, grouped by day, as they're recorded."
            )
        )
    }
}
