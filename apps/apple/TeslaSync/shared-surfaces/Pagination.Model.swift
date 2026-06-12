//
//  Pagination.Model.swift
//  TeslaSync — P4 shared surface · 0221 · Pagination (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  table pagination controls. The web `<Pagination>` is a fully controlled presentational primitive: it holds
//  no internal state, derives a little arithmetic from its props, and reports navigation through the
//  `onPageChange` / `onPageSizeChange` callbacks (the parent owns the page state). The native peer keeps that
//  exact contract: the `@Observable` ``PaginationController`` carries the `page` / `pageSize` / `total` /
//  `pageSizeOptions` inputs (the parent updates them, mirroring React's controlled flow), derives the
//  ``PaginationProjection`` through the pure ``PaginationProjector``, exposes every display + accessibility
//  string through the injected resolver (defaulting to the P1/S10 facade) with i18next interpolation, fires
//  the navigation callbacks (gated by the same disabled predicates the buttons use), and emits the single
//  `view.opened` diagnostics event. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)` routed through keys

/// Resolves the surface's strings by key with the web English fallback, so the views and the state-holder
/// hold no hardcoded prose. Keys live in the "Pagination" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the labels deterministic. Every `t(...)` call in `components/ui/Pagination.tsx` is routed here.
public enum PaginationStrings {
    public static let table = "Pagination"

    /// The default bundle-backed resolver — the production wiring of ``PaginationResolve``.
    public static let resolve: PaginationResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The `<nav>` landmark's accessible name (web `t('a11y.pagination', 'Pagination')`).
    public static let navLabelKey = "a11y.pagination"
    public static let navLabelDefault = "Pagination"

    /// The visible-window summary (web `t('pagination.showing', 'Showing {{start}}–{{end}} of {{total}}')`).
    public static let showingKey = "pagination.showing"
    public static let showingDefault = "Showing {{start}}–{{end}} of {{total}}"

    /// The page-size selector's accessible name (web `t('pagination.pageSize', 'Rows per page')`).
    public static let pageSizeKey = "pagination.pageSize"
    public static let pageSizeDefault = "Rows per page"

    /// One page-size option's label (web `t('pagination.perPage', '{{count}} / page')`).
    public static let perPageKey = "pagination.perPage"
    public static let perPageDefault = "{{count}} / page"

    /// The first-page button's accessible name (web `t('pagination.first', 'First page')`).
    public static let firstKey = "pagination.first"
    public static let firstDefault = "First page"

    /// The previous-page button's accessible name (web `t('pagination.previous', 'Previous page')`).
    public static let previousKey = "pagination.previous"
    public static let previousDefault = "Previous page"

    /// The page indicator's accessible name (web `t('pagination.currentPage', 'Page {{page}} of {{total}}')`).
    public static let currentPageKey = "pagination.currentPage"
    public static let currentPageDefault = "Page {{page}} of {{total}}"

    /// The next-page button's accessible name (web `t('pagination.next', 'Next page')`).
    public static let nextKey = "pagination.next"
    public static let nextDefault = "Next page"

    /// The last-page button's accessible name (web `t('pagination.last', 'Last page')`).
    public static let lastKey = "pagination.last"
    public static let lastDefault = "Last page"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PaginationTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPaginationTelemetry: PaginationTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - PaginationController (P1/S8) — state-holder + derived strings + actions

/// The surface's observable state-holder — the native peer of the web component's controlled props + derived
/// render. It carries the `page` / `pageSize` / `total` / `pageSizeOptions` inputs (the parent mutates them,
/// exactly as a React controlled component is re-rendered with new props), derives the
/// ``PaginationProjection`` on demand through the pure ``PaginationProjector``, exposes every display and
/// accessibility string through the injected resolver (defaulting to the P1/S10 facade) with i18next
/// interpolation, fires the `onPageChange` / `onPageSizeChange` callbacks (gated by the same disabled
/// predicates the buttons enforce, so a programmatic call cannot overshoot), and emits `view.opened` exactly
/// once per instance. ``showsPageSizeSelector`` is the native peer of the web `onPageSizeChange &&` guard.
@MainActor
@Observable
public final class PaginationController {
    /// The current 1-based page (web `page`). Observed so the controls update when the parent advances it.
    public var page: Int
    /// Rows per page (web `pageSize`).
    public var pageSize: Int
    /// Total row count across all pages (web `total`).
    public var total: Int
    /// The rows-per-page choices (web `pageSizeOptions`).
    public let pageSizeOptions: [Int]

    @ObservationIgnored private let onPageChange: (Int) -> Void
    @ObservationIgnored private let onPageSizeChange: ((Int) -> Void)?
    @ObservationIgnored private let resolve: PaginationResolve
    @ObservationIgnored private let telemetry: any PaginationTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    /// Creates the state-holder from the web props. `onPageSizeChange` is optional — when `nil` the page-size
    /// selector is hidden (the web `onPageSizeChange &&`). `resolve` defaults to the P1/S10 facade; tests
    /// inject a deterministic resolver.
    public init(
        page: Int,
        pageSize: Int,
        total: Int,
        pageSizeOptions: [Int] = PaginationDefaults.pageSizeOptions,
        onPageChange: @escaping (Int) -> Void,
        onPageSizeChange: ((Int) -> Void)? = nil,
        resolve: @escaping PaginationResolve = PaginationStrings.resolve,
        telemetry: any PaginationTelemetry = OSLogPaginationTelemetry()
    ) {
        self.page = page
        self.pageSize = pageSize
        self.total = total
        self.pageSizeOptions = pageSizeOptions
        self.onPageChange = onPageChange
        self.onPageSizeChange = onPageSizeChange
        self.resolve = resolve
        self.telemetry = telemetry
    }

    // MARK: derived projection

    /// The derived render math for the current inputs (web body arithmetic), recomputed from the live
    /// `page` / `pageSize` / `total` through the pure projector.
    public var projection: PaginationProjection {
        PaginationProjector.project(page: page, pageSize: pageSize, total: total)
    }

    /// Whether the page-size selector renders — the web `onPageSizeChange &&` guard.
    public var showsPageSizeSelector: Bool {
        onPageSizeChange != nil
    }

    // MARK: derived strings (web `t(...)` + interpolation)

    /// The `<nav>` landmark's accessible name (web `aria-label={t('a11y.pagination', 'Pagination')}`).
    public var navAccessibilityLabel: String {
        resolve(PaginationStrings.navLabelKey, PaginationStrings.navLabelDefault)
    }

    /// The visible-window summary (web `Showing {{start}}–{{end}} of {{total}}`) with the live values
    /// interpolated; `start` is the web `total > 0 ? start : 0` clamp carried by the projection.
    public var showingText: String {
        let proj = projection
        return PaginationInterpolation.interpolate(
            resolve(PaginationStrings.showingKey, PaginationStrings.showingDefault),
            [
                "start": String(proj.displayStart),
                "end": String(proj.displayEnd),
                "total": String(proj.total)
            ]
        )
    }

    /// The page-size selector's accessible name (web `aria-label={t('pagination.pageSize', 'Rows per page')}`).
    public var pageSizeAccessibilityLabel: String {
        resolve(PaginationStrings.pageSizeKey, PaginationStrings.pageSizeDefault)
    }

    /// One page-size option's label (web `{{count}} / page`) with `count` interpolated.
    public func perPageLabel(_ count: Int) -> String {
        PaginationInterpolation.interpolate(
            resolve(PaginationStrings.perPageKey, PaginationStrings.perPageDefault),
            ["count": String(count)]
        )
    }

    /// The visible page-indicator text (web `{page} / {totalPages}`).
    public var pageIndicatorText: String {
        let proj = projection
        return "\(proj.page) / \(proj.totalPages)"
    }

    /// The page indicator's accessible name (web `Page {{page}} of {{total}}`, where `total` carries
    /// `totalPages`) with the live values interpolated.
    public var currentPageAccessibilityLabel: String {
        let proj = projection
        return PaginationInterpolation.interpolate(
            resolve(PaginationStrings.currentPageKey, PaginationStrings.currentPageDefault),
            [
                "page": String(proj.page),
                "total": String(proj.totalPages)
            ]
        )
    }

    /// The first-page button's accessible name (web `t('pagination.first', 'First page')`).
    public var firstAccessibilityLabel: String {
        resolve(PaginationStrings.firstKey, PaginationStrings.firstDefault)
    }

    /// The previous-page button's accessible name (web `t('pagination.previous', 'Previous page')`).
    public var previousAccessibilityLabel: String {
        resolve(PaginationStrings.previousKey, PaginationStrings.previousDefault)
    }

    /// The next-page button's accessible name (web `t('pagination.next', 'Next page')`).
    public var nextAccessibilityLabel: String {
        resolve(PaginationStrings.nextKey, PaginationStrings.nextDefault)
    }

    /// The last-page button's accessible name (web `t('pagination.last', 'Last page')`).
    public var lastAccessibilityLabel: String {
        resolve(PaginationStrings.lastKey, PaginationStrings.lastDefault)
    }

    // MARK: actions (web `onClick` → `onPageChange` / `onPageSizeChange`)

    /// Jumps to the first page — the web `onPageChange(1)`. A no-op while first/prev are disabled (web
    /// `page <= 1`), matching the disabled button.
    public func goToFirst() {
        let proj = projection
        guard proj.canGoToFirst else { return }
        onPageChange(proj.firstPage)
    }

    /// Steps back one page — the web `onPageChange(page - 1)`. A no-op while first/prev are disabled.
    public func goToPrevious() {
        let proj = projection
        guard proj.canGoToPrevious else { return }
        onPageChange(proj.previousPage)
    }

    /// Steps forward one page — the web `onPageChange(page + 1)`. A no-op while next/last are disabled (web
    /// `page >= totalPages`).
    public func goToNext() {
        let proj = projection
        guard proj.canGoToNext else { return }
        onPageChange(proj.nextPage)
    }

    /// Jumps to the last page — the web `onPageChange(totalPages)`. A no-op while next/last are disabled.
    public func goToLast() {
        let proj = projection
        guard proj.canGoToLast else { return }
        onPageChange(proj.lastPage)
    }

    /// Reports a new page size — the web `onPageSizeChange(Number(e.target.value))`. A no-op when no
    /// page-size callback was supplied (the selector is hidden).
    public func selectPageSize(_ size: Int) {
        onPageSizeChange?(size)
    }

    // MARK: lifecycle / telemetry

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear / disappear
    /// churn — the event fires a single time per instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: PaginationSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
