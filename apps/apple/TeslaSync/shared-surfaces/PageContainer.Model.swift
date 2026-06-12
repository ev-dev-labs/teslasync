//
//  PageContainer.Model.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the clock seam, the i18n facade
//  (P1/S10), and the pure projection for the PageContainer shared surface. The view binds through
//  `PageContainerModel`; no networking lives in the view. A source emits the coalesced inputs (the
//  page's title / subtitle, its `loading` / `error` / `empty` lifecycle, the copy-link toggle + the
//  shareable deep link, and the resolved freshness query — the worst-of a page's `useQuery` fan-out);
//  the model derives the render `phase` + the header + the freshness chip readout over them against an
//  injected clock, emits `view.opened` once, recomputes the relative-age label on a 30s tick (the web
//  `DataFreshness` `setInterval`), and fires a one-shot refresh when the freshness ages into the stale
//  band (the P4 leaf "stale → auto-refresh" contract).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PageContainerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPageContainerTelemetry: PageContainerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Clock seam

/// The "now" source the freshness projection ages timestamps against — injected so tests advance time
/// deterministically instead of waiting on a wall clock. Defaults to the system clock.
public typealias PageContainerClock = @Sendable () -> Date

// MARK: - Input snapshot (the page's props + freshness)

/// One coalesced snapshot of the surface's inputs — the page title / subtitle, the body lifecycle
/// (`isLoading`, an `errorMessage`, `isEmpty` + its optional override copy), the copy-link toggle +
/// the shareable deep link (the native parity of the web `window.location.href`), and the resolved
/// freshness query (the worst-of the page's `useQuery` fan-out, `nil` when no chip applies). The
/// render is derived purely from this value. Breadcrumb label overrides are NOT carried here — they
/// flow through the existing `.setBreadcrumbOverrides(_:)` modifier (the web `useSetBreadcrumbOverrides`
/// bridge) which the surface attaches to the shared `BreadcrumbOverridesStore`.
public struct PageContainerInput: Sendable, Equatable {
    public var title: String
    public var subtitle: String?
    public var isLoading: Bool
    public var errorMessage: String?
    public var isEmpty: Bool
    public var emptyMessage: String?
    public var copyLink: Bool
    public var shareLink: String?
    public var query: PageContainerQuery?

    public init(
        title: String = "",
        subtitle: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        isEmpty: Bool = false,
        emptyMessage: String? = nil,
        copyLink: Bool = false,
        shareLink: String? = nil,
        query: PageContainerQuery? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.isEmpty = isEmpty
        self.emptyMessage = emptyMessage
        self.copyLink = copyLink
        self.shareLink = shareLink
        self.query = query
    }
}

// MARK: - Resolved header (web title / subtitle / trailing-cluster gating)

/// The resolved header payload — the page title, the optional subtitle, and whether the copy-link
/// affordance is offered (web `copyLink`). The view renders these verbatim; whether the WHOLE trailing
/// cluster shows is `showCopyLink || freshness != nil || hasActions`, the native parity of the web
/// `(actions || copyLink || resolvedQuery)` guard.
public struct PageContainerHeader: Sendable, Equatable {
    public let title: String
    public let subtitle: String?
    public let showCopyLink: Bool

    public init(title: String, subtitle: String?, showCopyLink: Bool) {
        self.title = title
        self.subtitle = subtitle
        self.showCopyLink = showCopyLink
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the header, the body `phase` (web `loading → error → empty →
/// children` branch order), and the freshness chip readout (`nil` when no `query` was supplied). The
/// `.error` and `.empty` phases carry their already-resolved copy so the view is a pure function of
/// this value.
public struct PageContainerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch (web `loading`) → the centred spinner.
        case loading
        /// The page's fetch failed (web `error`) → the tinted error tile carrying `error.message`.
        case error(String)
        /// Data resolved, nothing to show (web `empty`) → the friendly empty state carrying the copy.
        case empty(String)
        /// Healthy (web default branch) → the children, guarded by the page error boundary.
        case content
    }

    public let header: PageContainerHeader
    public let phase: Phase
    public let freshness: PageContainerFreshnessReadout?

    public init(
        header: PageContainerHeader,
        phase: Phase,
        freshness: PageContainerFreshnessReadout?
    ) {
        self.header = header
        self.phase = phase
        self.freshness = freshness
    }

    /// The freshness band when a chip is presenting, else `nil` — a convenience the model uses to
    /// detect the fresh→stale transition that arms the one-shot auto-refresh.
    public var freshnessStatus: PageContainerFreshnessStatus? {
        freshness?.status
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. The body branch order mirrors
/// the web component exactly — `loading` first, then `error` (a non-empty message), then `empty`
/// (resolving the default `No {title} found.` copy when no override is supplied), else `content`. The
/// freshness readout is derived independently from the resolved query (web `DataFreshnessAuto`), so it
/// is surfaced regardless of the body phase, exactly as the web chip lives in the header above the
/// body. Unit tested across every branch.
public enum PageContainerProjection {
    public static func resolve(
        input: PageContainerInput,
        now: Date,
        strings: PageContainerResolve
    ) -> PageContainerResolved {
        let header = PageContainerHeader(
            title: input.title,
            subtitle: input.subtitle,
            showCopyLink: input.copyLink
        )

        let phase: PageContainerResolved.Phase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if input.isEmpty {
            .empty(PageContainerEmptyMessage.resolve(
                explicit: input.emptyMessage,
                title: input.title,
                strings: strings
            ))
        } else {
            .content
        }

        let freshness = input.query.map {
            PageContainerFreshnessReadout.resolve(query: $0, now: now, strings: strings)
        }

        return PageContainerResolved(header: header, phase: phase, freshness: freshness)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `PageContainerSource`, recomputes the
/// resolved projection against an injected clock, exposes the render `phase` + the header + the
/// freshness readout, copies the page's deep link through the clipboard seam (web `CopyLinkButton`),
/// emits `view.opened` once, re-derives the relative-age label on each 30s tick, and auto-refreshes
/// once when the freshness transitions into the stale band. No networking lives here — the data is
/// owned upstream.
@MainActor
@Observable
public final class PageContainerModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Lives on the model so the generic
    /// `PageContainer` view and the tests share one constant.
    public static let surfaceSlug = "PageContainer"

    public private(set) var resolved: PageContainerResolved

    public var phase: PageContainerResolved.Phase {
        resolved.phase
    }

    public var header: PageContainerHeader {
        resolved.header
    }

    public var freshness: PageContainerFreshnessReadout? {
        resolved.freshness
    }

    /// Whether the copy-link button performs a copy when tapped — `true` only when the host supplied a
    /// non-empty deep link (web `window.location.href`). The button still renders whenever `copyLink`
    /// is set (web parity); this only gates whether a tap actually writes the pasteboard.
    public var canCopyLink: Bool {
        guard let link = lastInput.shareLink else { return false }
        return !link.isEmpty
    }

    @ObservationIgnored private let source: any PageContainerSource
    @ObservationIgnored private let telemetry: any PageContainerTelemetry
    @ObservationIgnored private let clipboard: any PageContainerClipboard
    @ObservationIgnored private let clock: PageContainerClock
    @ObservationIgnored private let strings: PageContainerResolve
    @ObservationIgnored private var lastInput = PageContainerInput()
    @ObservationIgnored private var lastStatus: PageContainerFreshnessStatus?
    @ObservationIgnored private var started = false

    public init(
        source: any PageContainerSource,
        telemetry: any PageContainerTelemetry = OSLogPageContainerTelemetry(),
        clipboard: any PageContainerClipboard = SystemPageContainerClipboard(),
        clock: @escaping PageContainerClock = { Date() },
        strings: @escaping PageContainerResolve = PageContainerStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.clipboard = clipboard
        self.clock = clock
        self.strings = strings
        resolved = PageContainerProjection.resolve(input: PageContainerInput(), now: clock(), strings: strings)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed. Re-arms the one-shot `view.opened` for the next `start`.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (the freshness chip / error-tile retry + the stale
    /// auto-refresh). The native parity of the web `query.refetch()`.
    public func refresh() {
        source.refresh()
    }

    /// Re-derives the relative-age label from the last snapshot against the current clock — the native
    /// port of the web `DataFreshness` 30s `setInterval` re-render. Driven by the view's periodic
    /// task. Re-evaluates (and may arm) the stale auto-refresh as the datum ages across the threshold.
    public func tick() {
        recompute()
    }

    /// Copies the page's shareable deep link to the pasteboard (web `CopyLinkButton`). Returns whether
    /// the copy happened so the button can flip to its transient "Copied" state. A `nil` / empty link
    /// is a no-op that returns `false`.
    @discardableResult
    public func copyLink() -> Bool {
        guard let link = lastInput.shareLink, !link.isEmpty else { return false }
        return clipboard.copy(link)
    }

    private func apply(_ input: PageContainerInput) {
        lastInput = input
        recompute()
    }

    private func recompute() {
        resolved = PageContainerProjection.resolve(input: lastInput, now: clock(), strings: strings)
        let newStatus = resolved.freshnessStatus
        let wasStale = lastStatus == .stale
        lastStatus = newStatus
        // Fresh → stale transition arms a single auto-refresh (the P4 leaf contract): ask the host to
        // re-fetch the moment the datum crosses the stale threshold. `lastStatus` is updated before the
        // refresh so the re-emit it triggers cannot re-arm it; the arm re-enables once the datum leaves
        // the stale band (back to fresh, or on to offline).
        if newStatus == .stale, !wasStale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's chrome strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "PageContainer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings. The freshness + copy-link copy reuses the web consumers' own keys
/// (`freshness.*`, `common.copyLink.*`) for catalog parity.
public enum PageContainerStrings {
    public static let table = "PageContainer"

    public static let string: PageContainerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
