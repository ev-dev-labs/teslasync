//
//  Tabs.Model.swift
//  TeslaSync — P4 shared surface · 0227 · Tabs (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  accessible tab strip. The web `<Tabs>` is a fully controlled presentational primitive: it holds no
//  internal data state, derives the WAI-ARIA tablist from its props, and reports activation through
//  `onChange` (the parent owns the active-tab state). The native peer keeps that exact contract: the
//  `@Observable` ``TabsController`` carries the ``TabsInput`` (the parent updates it, mirroring React's
//  controlled flow), derives the ``TabsProjection`` through the pure ``TabsProjector``, owns the `useId()`
//  tablist id, exposes the lone localized string (the empty-state message) through the injected
//  resolver (defaulting to the P1/S10 facade), fires the `onChange` activation callback (gated by the same
//  disabled predicate the tabs enforce, so a programmatic call cannot activate a disabled tab), reproduces
//  the web `handleKeyDown` roving navigation through ``moveFocus(_:from:)``, and emits the single
//  `view.opened` diagnostics event. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10)

/// Resolves the surface's lone string — the empty-state message — by key with an English fallback, so
/// the views and the state-holder hold no hardcoded prose. The key lives in the "Tabs" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; in test / preview bundles
/// `NSLocalizedString` returns the `value:` fallback, keeping the copy deterministic. The web `<Tabs>`
/// routes no `t()` literals (the tab labels + ariaLabel are caller-supplied, already-localized props), so
/// this is the only catalog entry the surface contributes.
public enum TabsStrings {
    public static let table = "Tabs"

    /// The default bundle-backed resolver — the production wiring of ``TabsResolve``.
    public static let resolve: TabsResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-branch message shown when there are no tabs (no web equivalent — the native "never a
    /// blank box" copy, the only string the surface localizes).
    public static let emptyKey = "tabs.empty"
    public static let emptyDefault = "No tabs available"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol TabsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTabsTelemetry: TabsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - TabsController (P1/S8) — state-holder + derived projection + actions

/// The surface's observable state-holder — the native peer of the web component's controlled props +
/// derived render. It carries the ``TabsInput`` (the parent mutates it via ``update(_:)``, exactly as a
/// React controlled component is re-rendered with new props), derives the ``TabsProjection`` on demand
/// through the pure ``TabsProjector``, owns the render-stable `useId()` tablist id, resolves the lone
/// empty-state string through the injected resolver (defaulting to the P1/S10 facade), fires `onChange`
/// for an activation (gated by the disabled predicate, so a programmatic call cannot overshoot), drives the
/// web `handleKeyDown` roving navigation, and emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class TabsController {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the strip re-renders when the tabs / active tab / aria-label change.
    public private(set) var input: TabsInput

    /// The render-stable tablist id (web `useId()`), generated once per instance and carried into the
    /// element ids so a consumer can wire its `role="tabpanel"` back to the matching tab.
    @ObservationIgnored public let tablistID: String

    @ObservationIgnored private let onChange: (String) -> Void
    @ObservationIgnored private let resolve: TabsResolve
    @ObservationIgnored private let telemetry: any TabsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    /// Creates the state-holder from the web props. `onChange` is the web activation callback; `tablistID`
    /// defaults to a fresh `useId()`-style id; `resolve` defaults to the P1/S10 facade (tests inject a
    /// deterministic resolver); `telemetry` defaults to the OSLog sink.
    public init(
        input: TabsInput,
        onChange: @escaping (String) -> Void,
        tablistID: String = TabsIdentifiers.generate(),
        resolve: @escaping TabsResolve = TabsStrings.resolve,
        telemetry: any TabsTelemetry = OSLogTabsTelemetry()
    ) {
        self.input = input
        self.onChange = onChange
        self.tablistID = tablistID
        self.resolve = resolve
        self.telemetry = telemetry
    }

    // MARK: derived projection / strings

    /// The resolved, view-ready model (web render output), recomputed from the live input through the pure
    /// projector with the localized empty-state label folded in.
    public var projection: TabsProjection {
        TabsProjector.project(input, tablistID: tablistID, emptyLabel: emptyLabel)
    }

    /// The localized empty-branch message (web has none — the native "never a blank box" copy).
    public var emptyLabel: String {
        resolve(TabsStrings.emptyKey, TabsStrings.emptyDefault)
    }

    /// The panel element id for `key` (web `aria-controls`), so a host can wire its `role="tabpanel"` back
    /// to the tab via a matching `accessibilityIdentifier`.
    public func panelID(forKey key: String) -> String {
        TabsIdentifiers.panel(tablistID, key: key)
    }

    /// The tab element id for `key` (web `id`).
    public func tabElementID(forKey key: String) -> String {
        TabsIdentifiers.tab(tablistID, key: key)
    }

    // MARK: actions (web `onClick` / `handleKeyDown` → `onChange`)

    /// Activates a tab — the web `onClick={() => onChange(tab.key)}`. The web button is `disabled` for a
    /// disabled tab (so its click never fires) and an unknown key cannot be clicked, so this reports only
    /// for enabled, present tabs; re-activating the already-active tab still reports (web parity, since the
    /// web re-fires `onChange`).
    public func select(_ key: String) {
        guard input.enabledKeys.contains(key) else { return }
        onChange(key)
    }

    /// Moves roving focus + activates — the web `handleKeyDown` → `moveFocus`. Computes the next enabled key
    /// (wrap + skip-disabled for arrows, first / last for Home / End) and, when there is one, reports it
    /// through `onChange` (web automatic activation) and returns it so the view moves focus. A no-op
    /// (returns `nil`) when there is nothing to move to (no enabled tabs, or an arrow from a non-enabled
    /// key), exactly as the web early returns.
    @discardableResult
    public func moveFocus(_ direction: TabsKeyMove, from currentKey: String) -> String? {
        guard let nextKey = TabsNavigator.nextKey(
            from: currentKey,
            move: direction,
            enabledKeys: input.enabledKeys
        ) else {
            return nil
        }
        onChange(nextKey)
        return nextKey
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// input actually changes, so an idempotent rebind does not churn observation.
    public func update(_ input: TabsInput) {
        guard input != self.input else { return }
        self.input = input
    }

    // MARK: lifecycle / telemetry

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear / disappear
    /// churn — the event fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: TabsSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
