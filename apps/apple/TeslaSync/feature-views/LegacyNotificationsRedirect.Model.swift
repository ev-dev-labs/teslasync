//
//  LegacyNotificationsRedirect.Model.swift
//  TeslaSync — P4 feature view · 0187 · LegacyNotificationsRedirect (Apple)
//
//  The seams + observable view-model for the legacy notifications redirect, mirroring
//  web/src/features/notifications/components/LegacyNotificationsRedirect.tsx:
//
//    • P1/S8  state-holder seam : `LegacyNotificationsRedirectSource` is the native
//                                 analogue of `useLocation()` — it pushes the current
//                                 router location; the view never reads HTTP/routing
//                                 symbols directly.
//    • nav seam               : `LegacyNotificationsRedirectRouter` is the analogue of
//                                 `<Navigate to replace />` — the resolved target is
//                                 dispatched exactly once, like the web replace.
//    • P1/S11 telemetry seam   : emits `view.opened` with the surface slug once.
//    • P1/S10 i18n facade      : resolves the native redirect-affordance + a11y copy by
//                                 key (the web source is anonymous — it renders no text —
//                                 so none of these are web-extracted literals).
//
//  Deliberately SwiftUI-free (Foundation + Observation + os only) so the whole state
//  machine is host-free unit-testable alongside the resolver.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 `view.opened`)

/// Stable, non-identifying identity for the surface. The slug is the value emitted
/// with the diagnostics contract and is shared by the view and its tests so the two
/// never drift.
public enum LegacyNotificationsRedirectSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "LegacyNotificationsRedirect"

    /// Reports the surface becoming visible — factored out so it is unit-testable
    /// without a rendering host.
    public static func reportOpen(to telemetry: any LegacyNotificationsRedirectTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the `view.opened` contract. `Sendable` so the view can emit
/// from `.task`/`onAppear` and so a default sink can be an `init` default argument.
public protocol LegacyNotificationsRedirectTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant; no payload, VIN, or location is recorded.
public struct OSLogLegacyNotificationsRedirectTelemetry: LegacyNotificationsRedirectTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Location source seam (P1/S8) — web `useLocation()`

/// The seam the model binds through for the current router location. The production
/// app implements this over the shared P1/S8 navigation state; previews + tests use
/// ``InMemoryLegacyNotificationsRedirectSource``. The view never reads routing
/// symbols directly.
@MainActor
public protocol LegacyNotificationsRedirectSource: AnyObject {
    /// Called with the current location on `start()` and whenever it changes.
    var onUpdate: (@MainActor (LegacyNotificationsLocation) -> Void)? { get set }
    /// Begins observing and emits the current location.
    func start()
    /// Stops observing.
    func stop()
}

// MARK: - Navigation seam — web `<Navigate to replace />`

/// The seam the model dispatches the resolved redirect through, replacing the current
/// entry (web `<Navigate to={to} replace />`). The production app adapts this onto the
/// SwiftUI router selection; previews + tests inject a recorder.
@MainActor
public protocol LegacyNotificationsRedirectRouter: AnyObject {
    /// Navigates to the resolved target, replacing the legacy entry in history.
    func replace(with redirect: ResolvedRedirect)
}

// MARK: - Localization facade (P1/S10) — native affordance copy

/// Resolves the surface's strings by key with an English fallback so the Swift holds
/// no hardcoded literals. Keys live in the "LegacyNotificationsRedirect" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
///
/// The web source renders no text (it is a bare `<Navigate>`), so NONE of these keys
/// are web-extracted — they back the native redirect affordance + accessibility, which
/// the platform requires but the invisible web redirect does not have.
public enum LegacyNotificationsRedirectStrings {
    public static let table = "LegacyNotificationsRedirect"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The localized destination name for a tab (used in headings + a11y).
    public static func destinationLabel(for tab: NotificationsRedirectTab) -> String {
        switch tab {
        case .inbox: string("legacyNotificationsRedirect.destination.inbox", "Inbox")
        case .archived: string("legacyNotificationsRedirect.destination.archived", "Archived")
        case .channels: string("legacyNotificationsRedirect.destination.channels", "Channels")
        }
    }

    /// The spoken accessibility summary for a render phase.
    public static func accessibilityLabel(for phase: LegacyNotificationsRedirectPhase) -> String {
        switch phase {
        case .resolving:
            return string("legacyNotificationsRedirect.a11y.resolving", "Redirecting to Notifications")
        case let .redirecting(redirect):
            let template = string("legacyNotificationsRedirect.a11y.redirecting", "Redirecting to %@")
            return String(format: template, destinationLabel(for: redirect.tab))
        }
    }
}

// MARK: - Render phase

/// The states the redirect surface renders. The web source is synchronous (it reads
/// router state, not a network resource), so there is no loading/error/stale/offline
/// data envelope: `resolving` is the brief native "performing the redirect" affordance
/// (never the invisible web `<Navigate>`), and `redirecting` is the resolved
/// destination with a manual-continue fallback so the surface is never a blank box.
public enum LegacyNotificationsRedirectPhase: Equatable {
    /// The location has not resolved yet (first frame).
    case resolving
    /// The redirect target is resolved and the replace has been dispatched.
    case redirecting(ResolvedRedirect)
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Binds the location source, resolves the
/// redirect (``LegacyNotificationsRedirectResolver``), dispatches the replace exactly
/// once (web `<Navigate replace>` fires once on mount), and emits `view.opened` once.
@MainActor
@Observable
public final class LegacyNotificationsRedirectModel {
    public private(set) var phase: LegacyNotificationsRedirectPhase = .resolving
    /// The resolved destination once known (`nil` on the first frame).
    public private(set) var destination: ResolvedRedirect?

    @ObservationIgnored private let source: any LegacyNotificationsRedirectSource
    @ObservationIgnored private let router: any LegacyNotificationsRedirectRouter
    @ObservationIgnored private let telemetry: any LegacyNotificationsRedirectTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didDispatch = false

    public init(
        source: any LegacyNotificationsRedirectSource,
        router: any LegacyNotificationsRedirectRouter,
        telemetry: any LegacyNotificationsRedirectTelemetry = OSLogLegacyNotificationsRedirectTelemetry()
    ) {
        self.source = source
        self.router = router
        self.telemetry = telemetry
        source.onUpdate = { [weak self] location in self?.apply(location) }
    }

    /// The spoken status of the surface for the current phase.
    public var accessibilitySummary: String {
        LegacyNotificationsRedirectStrings.accessibilityLabel(for: phase)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LegacyNotificationsRedirectSurface.slug)
        source.start()
    }

    /// Stops observing.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-dispatches the resolved redirect — the manual "Continue" affordance for when
    /// automatic navigation could not be honored (e.g. no router wired yet).
    public func redirectNow() {
        guard let destination else { return }
        router.replace(with: destination)
    }

    private func apply(_ location: LegacyNotificationsLocation) {
        let resolved = LegacyNotificationsRedirectResolver.resolve(location)
        destination = resolved
        phase = .redirecting(resolved)
        // web `<Navigate replace>` performs the redirect exactly once on mount.
        guard !didDispatch else { return }
        didDispatch = true
        router.replace(with: resolved)
    }
}

// MARK: - In-memory source + router (previews + tests)

/// In-memory location source for previews + unit tests. Emits its seeded location on
/// `start()` and lets a test push further locations via ``push(_:)``.
@MainActor
public final class InMemoryLegacyNotificationsRedirectSource: LegacyNotificationsRedirectSource {
    public var onUpdate: (@MainActor (LegacyNotificationsLocation) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    private let initial: LegacyNotificationsLocation

    public init(location: LegacyNotificationsLocation) {
        initial = location
    }

    public func start() {
        startCount += 1
        onUpdate?(initial)
    }

    public func stop() {
        stopCount += 1
    }

    /// Pushes a location to the bound model (test / preview affordance).
    public func push(_ location: LegacyNotificationsLocation) {
        onUpdate?(location)
    }
}

/// In-memory router that records the dispatched redirects so the once-only replace
/// contract can be asserted without a real navigation stack.
@MainActor
public final class InMemoryLegacyNotificationsRedirectRouter: LegacyNotificationsRedirectRouter {
    public private(set) var replacements: [ResolvedRedirect] = []

    public init() {}

    public func replace(with redirect: ResolvedRedirect) {
        replacements.append(redirect)
    }

    /// The targets of every recorded replace (convenience for assertions).
    public var targets: [String] {
        replacements.map(\.target)
    }
}

// MARK: - Surface slug accessor

public extension LegacyNotificationsRedirectModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        LegacyNotificationsRedirectSurface.slug
    }
}
