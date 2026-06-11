//
//  DateGroupedList.Adapter.swift
//  TeslaSync — P4 shared surface · 0080 · DateGroupedList (Apple)
//
//  The testable, dependency-light core for the date-grouped list — the SwiftUI parity of
//  `components/data-display/DateGroupedList.tsx`. Everything here is pure (Foundation + CoreGraphics
//  for the spacing tokens): the generic group value (the native port of the web
//  `DateGroupedListGroup<T>`), its non-generic header projection (the divider-row metadata the model
//  reasons over without touching the generic item payload), the coalesced input snapshot, the
//  surface metadata (diagnostics slug + the web spacing defaults + the divider separator glyph), the
//  localization seam, and the VoiceOver section-label builder. No store, no bundle, no rendered view,
//  so each piece is unit tested in isolation.
//
//  Parity note: the web component is a pure, generic presentational list — it takes already-prepared
//  `groups` plus a `renderItem` render-prop and holds no unit/format/fetch logic (the domain summary,
//  e.g. "2 drives · 6.2 mi", is pre-formatted by the caller). This core reproduces that data contract
//  exactly: the item payload flows through the view's row builder (the `renderItem` parity), while the
//  divider-header metadata is projected here so the localized text + the VoiceOver label are asserted
//  without rendering SwiftUI. Because the web source has no `useQuery`/fetch, there is no loading /
//  error / stale / offline axis to reproduce; the one genuine non-populated branch is an empty
//  `groups`, which the web renders as a blank container and the native surface upgrades to a friendly
//  empty state (P4 "never a blank box").
//

import CoreGraphics
import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of a `t(key, fallback)` call.
/// Kept as a plain closure so the pure core + projection have no dependency on a bundle: the
/// production app passes the P1/S10 facade (`DateGroupedListStrings.string`), while tests and the
/// isolated harness pass the identity (fallback) resolver. The web source resolves no strings (it is
/// anonymous and the caller pre-formats every label); the only keys are the native empty-state copy
/// and the VoiceOver item-count fallback.
public typealias DateGroupedListResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Group header (non-generic projection of `DateGroupedListGroup<T>`)

/// One group's divider-row metadata — the non-generic, item-free projection of a
/// ``DateGroupedListGroup``. Carries the verbatim web fields (`dateKey`, `dateLabel`, the optional
/// `relativeLabel`, the optional pre-formatted `summary`) plus the item count, so the model + the
/// pure projection reason over the header (localization, the spoken section label, the empty
/// decision) without ever touching the generic `Item` payload — that flows through the view's row
/// builder, the parity of the web `renderItem` render-prop.
public struct DateGroupedListGroupHeader: Sendable, Equatable, Identifiable {
    public let dateKey: String
    public let dateLabel: String
    public let relativeLabel: String?
    public let summary: String?
    public let itemCount: Int

    /// `dateKey` is the web React key — sortable + unique per group — so it doubles as the SwiftUI
    /// `Identifiable` id used to match a resolved header back to its generic group.
    public var id: String {
        dateKey
    }

    public init(
        dateKey: String,
        dateLabel: String,
        itemCount: Int,
        relativeLabel: String? = nil,
        summary: String? = nil
    ) {
        self.dateKey = dateKey
        self.dateLabel = dateLabel
        self.itemCount = itemCount
        self.relativeLabel = relativeLabel
        self.summary = summary
    }
}

// MARK: - Group (web `DateGroupedListGroup<T>`)

/// One group of items keyed by day — the native parity of the web `DateGroupedListGroup<T>` interface
/// (`dateKey`, `dateLabel`, optional `relativeLabel`, optional `summary`, `items`). Generic over the
/// item type so the surface stays domain-agnostic exactly like the web component; the view renders
/// each `item` through its row builder (the `renderItem` parity). `summary` is a pre-formatted string
/// (the web `ReactNode` is, by the source's own contract, the caller's already-formatted aggregation
/// such as "2 drives · 6.2 mi", kept free of unit/format logic here).
public struct DateGroupedListGroup<Item>: Identifiable {
    public let dateKey: String
    public let dateLabel: String
    public let relativeLabel: String?
    public let summary: String?
    public let items: [Item]

    public var id: String {
        dateKey
    }

    public init(
        dateKey: String,
        dateLabel: String,
        items: [Item],
        relativeLabel: String? = nil,
        summary: String? = nil
    ) {
        self.dateKey = dateKey
        self.dateLabel = dateLabel
        self.items = items
        self.relativeLabel = relativeLabel
        self.summary = summary
    }

    /// The non-generic header projection fed to the model + the pure projection — the item payload is
    /// dropped (only its count is carried) so the header reasoning never depends on the `Item` type.
    public var header: DateGroupedListGroupHeader {
        DateGroupedListGroupHeader(
            dateKey: dateKey,
            dateLabel: dateLabel,
            itemCount: items.count,
            relativeLabel: relativeLabel,
            summary: summary
        )
    }
}

/// `DateGroupedListGroup` is `Sendable` whenever its item payload is — the data holder adds no mutable
/// state of its own, so a group of `Sendable` items can safely cross actor boundaries.
extension DateGroupedListGroup: Sendable where Item: Sendable {}

// MARK: - Input snapshot (coalesced surface inputs)

/// One coalesced snapshot of the surface's inputs — the ordered group headers the projection turns
/// into the resolved view-state. The view derives this from its generic `groups` (dropping the item
/// payload) so the `@Observable` model + the pure projection stay non-generic and unit-testable. An
/// empty `headers` array is the surface's one genuine non-populated branch (web blank container →
/// native empty state).
public struct DateGroupedListInput: Sendable, Equatable {
    public var headers: [DateGroupedListGroupHeader]

    public init(headers: [DateGroupedListGroupHeader] = []) {
        self.headers = headers
    }
}

// MARK: - Surface metadata (diagnostics slug + web layout defaults)

/// The static identity + layout constants of the surface. The diagnostics slug is the P1/S11
/// `view.opened` constant; the spacing defaults are the verbatim web prop defaults (`space-y-3` =
/// 12pt between items, `space-y-6` = 24pt between groups) sourced from the P1/S9 spacing scale; the
/// separator is the divider middot the web renders before the relative label (`· 3 days ago`) — a
/// typographic glyph, not localized copy.
public enum DateGroupedListMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DateGroupedList"

    /// Spacing between successive items inside a group — the web `itemSpacing` default `space-y-3`
    /// (0.75rem → 12pt), mapped to the P1/S9 `TSSpacing.md` token.
    public static let defaultItemSpacing: CGFloat = TSSpacing.md

    /// Spacing between successive groups — the web `groupSpacing` default `space-y-6` (1.5rem →
    /// 24pt), mapped to the P1/S9 `TSSpacing.x2xl` token.
    public static let defaultGroupSpacing: CGFloat = TSSpacing.x2xl

    /// The divider separator glyph rendered before the relative label (web `· {relativeLabel}`). A
    /// middot (U+00B7), kept as a constant rather than an inline literal.
    public static let relativeSeparator = "\u{00B7}"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localized parts, so the spoken content is
/// asserted without rendering the view. The sighted divider header reads `{dateLabel} · {relative}`
/// on the left and `{summary}` on the right, separated by a decorative rule; the spoken section label
/// folds those parts into one comma-joined phrase (the middot is decorative and dropped) so a
/// non-sighted user hears the date, the relative time, and the group summary as a single heading.
public enum DateGroupedListAccessibility {
    /// The section's spoken heading: the date label, then the relative time and the summary when each
    /// is present, comma-joined. Empty / nil parts are dropped so there are no dangling separators.
    public static func sectionLabel(
        dateLabel: String,
        relativeLabel: String?,
        summary: String?
    ) -> String {
        var parts = [dateLabel]
        if let relativeLabel, !relativeLabel.isEmpty {
            parts.append(relativeLabel)
        }
        if let summary, !summary.isEmpty {
            parts.append(summary)
        }
        return parts.joined(separator: ", ")
    }
}
