//
//  Pagination.Adapter.swift
//  TeslaSync — P4 shared surface · 0221 · Pagination (Apple)
//
//  The Foundation-only core for the table pagination controls — the SwiftUI parity of
//  `components/ui/Pagination.tsx`. This file owns the surface identity (the diagnostics slug), the i18n facade
//  seam, the i18next `{{token}}` interpolation port, the derived render math (``PaginationProjection`` — the
//  web `totalPages` / `start` / `end` + the four disabled predicates) computed by the pure
//  ``PaginationProjector``, the control metrics (``PaginationLayout`` — native peers of the web Tailwind
//  sizes), the SF Symbol iconography (``PaginationSymbol`` — the native peers of the lucide
//  Chevrons{Left,Right} / Chevron{Left,Right}), and the default page-size options (``PaginationDefaults`` —
//  the web `pageSizeOptions = [25, 50, 100]`). No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//
//  Faithful-parity note: the web `<Pagination>` is a pure PRESENTATIONAL, fully CONTROLLED primitive — it
//  takes plain props (`page`, `pageSize`, `total`, `onPageChange`, `onPageSizeChange?`, `pageSizeOptions?`),
//  derives a little arithmetic, and renders. There is NO fetch, NO React-Query cache, and NO Promise, so it
//  has NO loading / error / stale / offline branch (nothing to fetch, fail, age, or lose connectivity to).
//  Inventing such chrome would fabricate states the source does not have, so this surface reproduces only the
//  source's REAL branches — the same faithful-parity stance the sibling primitives ContextMenu (0206),
//  DataTableColumnMenu (0210), and HelpTooltip (0216) took. The REAL branches are: empty (`total == 0` →
//  "Showing 0–0 of 0" / "1 / 1" with every button disabled — a fully rendered control, never a blank box),
//  single-page (`total <= pageSize` → all four buttons disabled), first page (first/prev disabled), a middle
//  page (all four enabled), the last page (next/last disabled), with the optional page-size selector present
//  or absent (the web `onPageSizeChange &&`), across the default and any caller-supplied `pageSizeOptions`.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum PaginationSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Pagination"
}

// MARK: - Localization facade seam (web `t(key, default)` → P1/S10 key)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade,
/// while tests pass a deterministic resolver.
public typealias PaginationResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - PaginationInterpolation (web i18next `{{token}}`)

/// Replaces `{{token}}` markers in a resolved template with the supplied values — the native port of
/// i18next interpolation, so the per-surface strings keep the web's `Showing {{start}}–{{end}} of {{total}}`,
/// `{{count}} / page`, and `Page {{page}} of {{total}}` shapes and stay translator-friendly. Unknown tokens
/// are left untouched (the i18next default), so a partial value map never corrupts the surrounding copy.
public enum PaginationInterpolation {
    /// Substitutes every `{{key}}` occurrence with its value, leaving any unmatched token intact.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }
}

// MARK: - PaginationDefaults (web `pageSizeOptions = [25, 50, 100]`)

/// The surface's prop defaults — the native peer of the web default parameter `pageSizeOptions = [25, 50,
/// 100]`. Kept as a named constant rather than a scattered literal so the controller and the tests agree on
/// one source of truth.
public enum PaginationDefaults {
    /// The default rows-per-page choices (web `pageSizeOptions = [25, 50, 100]`).
    public static let pageSizeOptions = [25, 50, 100]
}

// MARK: - PaginationSymbol (web lucide chevrons)

/// The SF Symbol names for the four navigation buttons — the native peers of the web lucide glyphs
/// (`ChevronsLeft` / `ChevronLeft` / `ChevronRight` / `ChevronsRight`). The layout-direction-aware
/// `backward` / `forward` family (rather than `left` / `right`) is used so the control mirrors correctly in
/// right-to-left locales; the same names back the sibling `SignalQueryControls` pager.
public enum PaginationSymbol {
    /// First-page glyph (web `<ChevronsLeft>`).
    public static let first = "chevron.backward.2"
    /// Previous-page glyph (web `<ChevronLeft>`).
    public static let previous = "chevron.backward"
    /// Next-page glyph (web `<ChevronRight>`).
    public static let next = "chevron.forward"
    /// Last-page glyph (web `<ChevronsRight>`).
    public static let last = "chevron.forward.2"
}

// MARK: - PaginationLayout (web Tailwind metrics)

/// The surface's precise metrics — the native peers of the web Tailwind utilities on
/// `components/ui/Pagination.tsx`: the `pt-4` top padding, the `gap-1` button-cluster spacing, the `gap-3`
/// inter-group spacing, the `p-1.5` button inset, the `h-4 w-4` glyph, the `px-3` page-indicator inset, the
/// `disabled:opacity-30` dimming, and the page-size selector's `px-2 py-1` inset. Named constants rather than
/// scattered magic numbers, mirroring the sibling surfaces' `…Layout` enums.
public enum PaginationLayout {
    /// Spacing inside the button cluster (web `gap-1`).
    public static let controlSpacing: CGFloat = 4
    /// Spacing between the leading copy group and the trailing button group (web `gap-3`).
    public static let sectionSpacing: CGFloat = 12
    /// Top padding separating the controls from the table above (web `pt-4`).
    public static let topPadding: CGFloat = 16
    /// Inset around each navigation glyph (web `p-1.5`).
    public static let buttonPadding: CGFloat = 6
    /// The navigation glyph side (web `h-4 w-4`); scaled with Dynamic Type by the view.
    public static let iconSide: CGFloat = 16
    /// Horizontal inset around the page indicator (web `px-3`).
    public static let indicatorPadding: CGFloat = 12
    /// Dimming applied to a disabled navigation button (web `disabled:opacity-30`).
    public static let disabledOpacity: CGFloat = 0.3
    /// Horizontal inset of the page-size selector (web `px-2`).
    public static let pageSizeHorizontalPadding: CGFloat = 8
    /// Vertical inset of the page-size selector (web `py-1`).
    public static let pageSizeVerticalPadding: CGFloat = 4
}

// MARK: - PaginationProjection (web derived render math)

/// The resolved render math for one page state — the native peer of the values the web component derives in
/// its body: `totalPages = max(1, ceil(total / pageSize))`, the `start` / `end` of the visible window, and
/// the four button-disabled predicates (`page <= 1` for first/prev, `page >= totalPages` for next/last). A
/// closure-free `Sendable` / `Equatable` value type so the view, the controller, and the projection tests
/// agree on one shape. ``displayStart`` already applies the web `total > 0 ? start : 0` clamp used in the
/// "showing" copy.
public struct PaginationProjection: Sendable, Equatable {
    /// The current 1-based page (web `page`).
    public let page: Int
    /// Rows per page (web `pageSize`).
    public let pageSize: Int
    /// Total row count across all pages (web `total`).
    public let total: Int
    /// The page count — `max(1, ceil(total / pageSize))` (web `totalPages`).
    public let totalPages: Int
    /// The first 1-based row index shown, clamped to 0 when empty (web `total > 0 ? start : 0`).
    public let displayStart: Int
    /// The last row index shown — `min(page * pageSize, total)` (web `end`).
    public let displayEnd: Int
    /// Whether first / previous are enabled — the web `!(page <= 1)`.
    public let canGoToPrevious: Bool
    /// Whether next / last are enabled — the web `!(page >= totalPages)`.
    public let canGoToNext: Bool

    public init(
        page: Int,
        pageSize: Int,
        total: Int,
        totalPages: Int,
        displayStart: Int,
        displayEnd: Int,
        canGoToPrevious: Bool,
        canGoToNext: Bool
    ) {
        self.page = page
        self.pageSize = pageSize
        self.total = total
        self.totalPages = totalPages
        self.displayStart = displayStart
        self.displayEnd = displayEnd
        self.canGoToPrevious = canGoToPrevious
        self.canGoToNext = canGoToNext
    }

    /// Whether the data set is empty (web `total === 0`) — the friendly "Showing 0–0 of 0" branch.
    public var isEmpty: Bool {
        total <= 0
    }

    /// Whether the first-page button is enabled — identical to ``canGoToPrevious`` (web shares the `page <=
    /// 1` guard); exposed under its own name so the view reads naturally.
    public var canGoToFirst: Bool {
        canGoToPrevious
    }

    /// Whether the last-page button is enabled — identical to ``canGoToNext`` (web shares the `page >=
    /// totalPages` guard); exposed under its own name so the view reads naturally.
    public var canGoToLast: Bool {
        canGoToNext
    }

    /// The destination for the first-page button (web `onPageChange(1)`).
    public var firstPage: Int {
        1
    }

    /// The destination for the previous-page button (web `onPageChange(page - 1)`).
    public var previousPage: Int {
        page - 1
    }

    /// The destination for the next-page button (web `onPageChange(page + 1)`).
    public var nextPage: Int {
        page + 1
    }

    /// The destination for the last-page button (web `onPageChange(totalPages)`).
    public var lastPage: Int {
        totalPages
    }
}

// MARK: - PaginationProjector (web body arithmetic)

/// The pure projection rule for the surface — the surface's data adapter in the "inputs → projection" sense
/// the acceptance calls for: it takes the props a caller already holds (no fetch, no clock) and reproduces
/// the component's body arithmetic as a deterministic function. Unit tested across the empty / single-page /
/// first / middle / last branches and the page-size variations.
public enum PaginationProjector {
    /// The page count — the verbatim port of `Math.max(1, Math.ceil(total / pageSize))`, computed with
    /// integer ceiling division. `pageSize` is clamped to at least 1 (the web would yield `Infinity` on a
    /// zero divisor; native integer division would trap), and a negative `total` is treated as empty.
    public static func totalPages(total: Int, pageSize: Int) -> Int {
        let denominator = max(1, pageSize)
        let safeTotal = max(0, total)
        let pages = (safeTotal + denominator - 1) / denominator
        return max(1, pages)
    }

    /// The visible-window bounds — the verbatim port of `start = (page - 1) * pageSize + 1` (shown as 0 when
    /// `total === 0`, the web `total > 0 ? start : 0`) and `end = Math.min(page * pageSize, total)`.
    public static func range(page: Int, pageSize: Int, total: Int) -> (start: Int, end: Int) {
        let rawStart = (page - 1) * pageSize + 1
        let displayStart = total > 0 ? rawStart : 0
        let displayEnd = min(page * pageSize, total)
        return (displayStart, displayEnd)
    }

    /// The full derived render state for one page — combines ``totalPages(total:pageSize:)``,
    /// ``range(page:pageSize:total:)``, and the two disabled predicates (`page > 1`, `page < totalPages`)
    /// into the ``PaginationProjection`` the view binds to.
    public static func project(page: Int, pageSize: Int, total: Int) -> PaginationProjection {
        let pages = totalPages(total: total, pageSize: pageSize)
        let window = range(page: page, pageSize: pageSize, total: total)
        return PaginationProjection(
            page: page,
            pageSize: pageSize,
            total: total,
            totalPages: pages,
            displayStart: window.start,
            displayEnd: window.end,
            canGoToPrevious: page > 1,
            canGoToNext: page < pages
        )
    }
}
