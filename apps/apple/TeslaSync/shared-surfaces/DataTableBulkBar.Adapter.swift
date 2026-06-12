//
//  DataTableBulkBar.Adapter.swift
//  TeslaSync — P4 shared surface · 0209 · DataTableBulkBar (Apple)
//
//  The Foundation-only core for the table selection toolbar — the SwiftUI parity of
//  `components/ui/DataTableBulkBar.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam, the props value type (``DataTableBulkBarInput``), the view-ready
//  ``DataTableBulkBarProjection``, and the pure ``DataTableBulkBarProjector`` that resolves the early
//  hidden branch (the web `count <= 0` → `return null`), the interpolated "{{count}} selected" copy, and
//  the polite count announcement. No SwiftUI and no `@Observable`, so every rule is unit-testable alone.
//
//  Faithful-parity note: the web `<DataTableBulkBar>` is a PURE presentational primitive. It takes its
//  data as plain props (`count`, `onClear`, `children`, `className`) and renders — there is no fetch, no
//  React-Query cache, and no Promise — so it has NO loading, error, stale, or offline branch (there is
//  nothing to fetch, fail, age, or lose connectivity to; its only "hook" is `useTranslation`). Inventing
//  such chrome would fabricate states the source does not have, so this surface reproduces only the
//  source's REAL branches — exactly as the sibling presentational primitives ActiveFilterChips (0147),
//  InlineCallout (0124), Delta (0081), MetricCard (0095), and Accordion (0203) did. The REAL branches:
//  hidden (`count <= 0`), the bar with its bulk-action slot, the bar without a slot (count + clear is
//  never a blank box), and the polite "{{count}} selected" announcement (the native peer of the web
//  count span's `aria-live="polite"`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum DataTableBulkBarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DataTableBulkBar"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a
/// plain closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias DataTableBulkBarResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - DataTableBulkBarInput (web props, closure-free)

/// The component's props — the native peer of `DataTableBulkBarProps`, minus the `children` view content
/// and the `onClear` closure (held by the view + the state-holder). A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a
/// prop change cheaply when the page rebinds a fresh selection count.
public struct DataTableBulkBarInput: Sendable, Equatable {
    /// The number of selected rows (web `count`). The toolbar is hidden when this is `<= 0`.
    public let count: Int
    /// Whether the page supplied bulk-action content for the slot (web `children != null`).
    public let hasActions: Bool

    public init(count: Int, hasActions: Bool = false) {
        self.count = count
        self.hasActions = hasActions
    }
}

// MARK: - DataTableBulkBarProjection (view-ready)

/// The resolved, view-ready toolbar — everything the SwiftUI body needs as a pure function of the props
/// (no derivation in the view). `isHidden` is the web early `count <= 0` → `return null`; `count` is the
/// selected-row count echoed for the label; `showsActions` is the web `children` slot; `showsClear` is
/// always true (the web bar always renders the "Clear selection" button when visible).
public struct DataTableBulkBarProjection: Sendable, Equatable {
    /// The whole surface renders nothing (web `count <= 0` → `return null`).
    public let isHidden: Bool
    /// The selected-row count shown in the "{{count}} selected" label (web `count`).
    public let count: Int
    /// The bulk-action slot is rendered before the clear button (web `children`).
    public let showsActions: Bool
    /// The "Clear selection" button is rendered (web: always present in the visible bar).
    public let showsClear: Bool

    public init(isHidden: Bool, count: Int, showsActions: Bool, showsClear: Bool) {
        self.isHidden = isHidden
        self.count = count
        self.showsActions = showsActions
        self.showsClear = showsClear
    }
}

// MARK: - DataTableBulkBarProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a page already holds (no
/// fetch, no clock) and derives the rendered toolbar, the interpolated copy (web i18next `{{count}}`),
/// and the padded a11y announcement. Unit tested across the hidden boundary, the slot flag, the
/// interpolation, and the rotating padding.
public enum DataTableBulkBarProjector {
    /// Whether the toolbar is hidden — the verbatim port of the web guard `if (count <= 0) return null`.
    /// Takes a bare count so the rule stays free of any collection-`count` comparison.
    public static func isHidden(count: Int) -> Bool {
        count <= 0
    }

    /// Resolves the whole toolbar from the props — the native peer of the web component's render
    /// decision. `showsClear` is always true for a visible bar (the web always renders the clear button).
    public static func resolve(_ input: DataTableBulkBarInput) -> DataTableBulkBarProjection {
        let hidden = isHidden(count: input.count)
        return DataTableBulkBarProjection(
            isHidden: hidden,
            count: input.count,
            showsActions: input.hasActions,
            showsClear: !hidden
        )
    }

    // MARK: Interpolated copy (web i18next `{{token}}`)

    /// Replaces `{{token}}` markers in a resolved template with the supplied values — the native port of
    /// i18next interpolation, so the per-surface strings keep the web's `{{count}} selected` shape and
    /// stay translator-friendly.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }

    /// The selection-count label (web `t('table.bulkActions.selected', '{{count}} selected', { count })`).
    /// The raw integer is inserted with no grouping separator, matching i18next's default interpolation.
    public static func selectedLabel(template: String, count: Int) -> String {
        interpolate(template, ["count": String(count)])
    }

    // MARK: A11y announcement (web count-span `aria-live="polite"` + rotating dedupe padding)

    /// U+200B ZERO WIDTH SPACE — invisible on screen and not spoken, used to force the assistive
    /// technology to re-read an otherwise identical consecutive announcement, exactly as the web relies
    /// on a polite live region re-firing when its text content changes.
    public static let zeroWidthSpace = "\u{200B}"

    /// The rotating dedupe suffix — `sequence mod 4` zero-width spaces. The modulo keeps the suffix
    /// bounded while still guaranteeing two consecutive announcements differ byte-for-byte.
    public static func announcementPadding(sequence: Int) -> String {
        let count = ((sequence % 4) + 4) % 4
        return String(repeating: zeroWidthSpace, count: count)
    }

    /// The polite live-region text announced while the bar is visible — the spoken peer of the web count
    /// span's `aria-live="polite"` content ("{{count}} selected"), padded for re-announcement.
    public static func selectionAnnouncement(selectedText: String, sequence: Int) -> String {
        selectedText + announcementPadding(sequence: sequence)
    }
}
