//
//  BreadcrumbOverridesContext.Model.swift
//  TeslaSync — P4 shared surface · 0166 · BreadcrumbOverridesContext (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  breadcrumb-overrides bridge. Two observable holders live here:
//
//    • BreadcrumbOverridesStore — the native peer of the web provider's `registrations` state. Where
//      the web keeps a `Map<number, BreadcrumbOverrideMap>` in `useState` and merges it on read, the
//      native store is an `@Observable` dictionary keyed by registration id. SwiftUI's observation
//      tracking replaces React's re-render: any view that reads `merged` re-renders when a registration
//      changes — and only then, because `register` skips the write when the content is unchanged (the
//      parity of comparing the JSON `serialised` string) and `unregister` is a no-op for an unknown id
//      (web `if (!prev.has(id)) return prev`). Ids are handed out monotonically (web module `nextId++`).
//
//    • BreadcrumbOverridesState — the per-provider value bound by `BreadcrumbOverridesProvider`, the
//      native peer of the web context value `{ overrides, register, unregister }`. It exposes the
//      merged map, allocates ids + registers/unregisters page overrides over the store, resolves the
//      trail for a route, and emits `view.opened` once. No networking lives in the view; the store is
//      the only seam and it is purely in-process (the web overrides live in React state, never on the
//      wire).
//
//  The i18n facade resolves the surface's strings by key with the English fallback so the Swift
//  sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. The web source is an anonymous, transparent provider — it carries no user-facing
/// copy of its own — so the shipped entries back the trail renderer's accessibility wording (the
/// `<nav aria-label>` + the leading Home link's label, web `a11y.breadcrumb` / `a11y.breadcrumbHome`)
/// and the sample / inspector copy the DEBUG previews + the view-composition tests render. Keys live in
/// the "BreadcrumbOverridesContext" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the projection deterministic.
public enum BreadcrumbOverridesStrings {
    public static let table = "BreadcrumbOverridesContext"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `Text`-friendly overload for SwiftUI call sites.
    public static func text(_ key: String, _ fallback: String) -> String {
        string(key, fallback)
    }

    /// The trail builder's i18n closure — resolves a route's label from its i18n key + English
    /// fallback (web `t(meta.i18nKey, meta.defaultLabel)`). Routes through the same facade so route
    /// labels localize alongside the rest of the catalog.
    public static let localize: BreadcrumbOverridesLocalize = { key, fallback in
        string(key, fallback)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol BreadcrumbOverridesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogBreadcrumbOverridesTelemetry: BreadcrumbOverridesTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - BreadcrumbOverridesStore (P1/S8) — web provider `registrations` state

/// The breadcrumb-overrides store keyed by registration id — the native peer of the web provider's
/// `registrations` `Map<number, BreadcrumbOverrideMap>`. An `@Observable` dictionary stands in for the
/// React state: SwiftUI observation is the subscription, `register` skips an unchanged write (no
/// spurious invalidation, the parity of the `serialised` compare) and `unregister` no-ops an unknown id
/// (web `if (!prev.has(id))`). `merged` collapses every registration into one map exactly as the
/// provider's `overrides` memo does.
///
/// `shared` is the process-wide instance — the parity of the single Layout-level provider; previews +
/// tests inject a fresh instance instead so they never touch global state.
@MainActor
@Observable
public final class BreadcrumbOverridesStore {
    /// The process-wide store (web single Layout `<BreadcrumbOverridesProvider>`).
    public static let shared = BreadcrumbOverridesStore()

    /// The registrations keyed by id. A missing id means "that page registered nothing".
    public private(set) var registrations: [Int: BreadcrumbOverrideMap] = [:]

    @ObservationIgnored private var idCounter = 0

    public init() {}

    /// Allocates a fresh, monotonically increasing registration id — web module `nextId++` (starts at
    /// 1). The ascending order is what makes a later registration win the merge (see ``merged``).
    public func nextRegistrationID() -> Int {
        idCounter += 1
        return idCounter
    }

    /// Registers (or replaces) a page's override map under an id — web `register(id, map)`. Empty
    /// labels are dropped on store (web `if (v)`), and an unchanged registration is skipped so no
    /// observer is invalidated spuriously (the parity of the `serialised === prev` guard).
    public func register(id: Int, map: BreadcrumbOverrideMap) {
        let sanitized = BreadcrumbOverridesReducer.sanitize(map)
        if let existing = registrations[id], BreadcrumbOverridesReducer.areEquivalent(existing, sanitized) {
            return
        }
        registrations[id] = sanitized
    }

    /// Removes a page's registration — web `unregister(id)`. No-op (no invalidation) for an unknown id
    /// (web `if (!prev.has(id)) return prev`).
    public func unregister(id: Int) {
        guard registrations[id] != nil else { return }
        registrations.removeValue(forKey: id)
    }

    /// The merged override map across every registration — web provider `overrides` memo (later
    /// registration wins per route key).
    public var merged: BreadcrumbOverrideMap {
        BreadcrumbOverridesReducer.merge(registrations)
    }

    /// The merged label for a single route pattern, if any — web `overrides[pattern]`.
    public func override(for pattern: String) -> String? {
        merged[pattern]
    }

    /// The resolved trail for a route using the merged overrides — web `useBreadcrumbs(overrides)`.
    public func resolvedTrail(
        table: BreadcrumbOverridesRouteTable,
        path: String,
        localize: @escaping BreadcrumbOverridesLocalize = BreadcrumbOverridesStrings.localize
    ) -> BreadcrumbOverridesTrailResolved {
        BreadcrumbOverridesProjection.resolve(table: table, path: path, overrides: merged, localize: localize)
    }

    /// Fully clears the store — a test / preview helper. No-op (no invalidation) when already empty.
    public func reset() {
        guard !registrations.isEmpty else { return }
        registrations = [:]
    }
}

// MARK: - BreadcrumbOverridesState (P1/S8) — web context value `{ overrides, register, unregister }`

/// The per-provider value — the native peer of the web context value `{ overrides, register,
/// unregister }`. It pins one store, exposes the merged overrides, allocates ids + registers /
/// unregisters page override maps, resolves the trail for a route, and emits `view.opened` once.
/// Reading `overrides` inside a view body registers an observation dependency on the store, so a
/// consumer redraws when a page registers or unregisters its labels (the native parity of the
/// React context re-render).
@MainActor
@Observable
public final class BreadcrumbOverridesState {
    @ObservationIgnored private let store: BreadcrumbOverridesStore
    @ObservationIgnored private let telemetry: any BreadcrumbOverridesTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        store: BreadcrumbOverridesStore = .shared,
        telemetry: any BreadcrumbOverridesTelemetry = OSLogBreadcrumbOverridesTelemetry()
    ) {
        self.store = store
        self.telemetry = telemetry
    }

    /// The merged override map (web context `overrides`). `{}` when no page has registered anything.
    public var overrides: BreadcrumbOverrideMap {
        store.merged
    }

    /// Registers a page's override map under a freshly allocated id and returns it — the ergonomic
    /// spelling of web `const id = nextId++; register(id, map)`. Pass the id to ``unregister(id:)`` on
    /// teardown. A `nil` / empty map registers nothing and returns `nil` (web omits the effect body).
    @discardableResult
    public func registerOverrides(_ map: BreadcrumbOverrideMap?) -> Int? {
        guard let map, !BreadcrumbOverridesReducer.sanitize(map).isEmpty else { return nil }
        let id = store.nextRegistrationID()
        store.register(id: id, map: map)
        return id
    }

    /// Registers (or replaces) an override map under a caller-owned id — web `register(id, map)`.
    public func register(id: Int, map: BreadcrumbOverrideMap) {
        store.register(id: id, map: map)
    }

    /// Removes a page's registration — web `unregister(id)`.
    public func unregister(id: Int) {
        store.unregister(id: id)
    }

    /// The resolved trail for a route using the merged overrides — web
    /// `useBreadcrumbs(useBreadcrumbOverrides())`.
    public func resolvedTrail(
        table: BreadcrumbOverridesRouteTable,
        path: String,
        localize: @escaping BreadcrumbOverridesLocalize = BreadcrumbOverridesStrings.localize
    ) -> BreadcrumbOverridesTrailResolved {
        store.resolvedTrail(table: table, path: path, localize: localize)
    }

    /// Begins providing the context and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear / disappear churn — the event fires a single time per provider instance, never again on a
    /// later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: BreadcrumbOverridesSurface.slug)
        }
    }

    /// Ends the provider. Does not clear the store: the Layout-level provider lives for the whole app
    /// session, and per-page registrations are cleaned up by their own `unregister` on unmount (the
    /// parity of the web effect's cleanup), so tearing down a transient provider must not drop another
    /// page's labels.
    public func stop() {
        started = false
    }
}
