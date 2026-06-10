//
//  TeslaAccountSection.Model.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  The P1/S8 state-holder seams the view binds through (the auth-status feed, the four mutations, and
//  the URL opener) and the observable view-model — the SwiftUI parity of
//  web/src/features/settings/components/TeslaAccountSection.tsx. The model subscribes to the status
//  seam, recomputes the resolved projection, owns the four mutations + the disconnect confirm + the
//  toast, emits `view.opened` once, fires the recovery callback on the unauthenticated → authenticated
//  edge (web `notifyTeslaAuthRecovered`), and auto-refreshes once when the feed goes stale. The value
//  types + facades live in TeslaAccountSection.Types.swift; previews/tests drive the seams from
//  TeslaAccountSection.Sources.swift. No networking lives in the view.
//

import Foundation
import Observation

// MARK: - State-holder seams (P1/S8 layer)

/// The auth-status feed (web `useAuthStatus` + the pill events). Production implements this over the
/// shared auth-status holder composed with the page-level clock + the live-state holder + the
/// `tesla-auth-expired/-recovered` signal; previews/tests use `InMemoryTeslaAccountStatusSource`. The
/// view never talks to the network.
@MainActor
public protocol TeslaAccountStatusSource: AnyObject {
    var onUpdate: (@MainActor (TeslaAccountStatusInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The mutation seam (web `useAuthURL` / `useRefreshAuth` / `useSyncVehicles` / `useDisconnectAuth`).
/// `authURL` resolves the Tesla OAuth URL to open; `refreshToken` runs the token refresh; `syncVehicles`
/// returns the synced vehicle count; `disconnect` revokes the account. `invalidateCaches` flushes the
/// dependent cached queries after a refresh / disconnect (web `qc.invalidateQueries()`).
@MainActor
public protocol TeslaAccountActions: AnyObject {
    func authURL() async throws -> URL
    func refreshToken() async throws
    func syncVehicles() async throws -> Int
    func disconnect() async throws
    func invalidateCaches()
}

/// The URL-opener seam (web `window.location.href = data.auth_url`). Production opens the Tesla OAuth
/// URL via the platform opener (`UIApplication`/`NSWorkspace`); tests inject a spy.
@MainActor
public protocol TeslaAccountURLOpening: AnyObject {
    func open(_ url: URL)
}

// MARK: - View-model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to the auth-status seam, recomputes the resolved
/// projection, exposes the render `phase` + the resolved presentation + the `connection` axis, owns
/// the four mutations + the disconnect confirm + the toast, emits `view.opened` once on first start,
/// fires the recovery callback on the unauthenticated → authenticated edge (web
/// `notifyTeslaAuthRecovered`), and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class TeslaAccountModel {
    public private(set) var resolved: TeslaAccountResolved =
        TeslaAccountProjection.resolve(TeslaAccountStatusInput(isLoading: true))
    public private(set) var connection: TeslaAccountConnection = .live

    /// In-flight flags for the four actions (web `mut.isPending`).
    public private(set) var isConnecting = false
    public private(set) var isRefreshing = false
    public private(set) var isSyncing = false
    public private(set) var isDisconnecting = false

    /// The synced vehicle count from the last successful sync (web `syncMut.isSuccess &&
    /// syncMut.data.synced`), or `nil` when no sync has succeeded since the surface opened / a new
    /// sync is in flight.
    public private(set) var syncedCount: Int?

    /// Whether the disconnect confirmation sheet is presented (web `useConfirm` dialog).
    public private(set) var disconnectPresented = false

    /// The active toast, or `nil` (web `toast`).
    public private(set) var toast: TeslaAccountToast?

    public var phase: TeslaAccountResolved.Phase {
        resolved.phase
    }

    /// The resolved status content for the content phases (empty / data); `nil` while loading or in
    /// the error state.
    public var presentation: TeslaAccountPresentation? {
        switch resolved.phase {
        case let .data(value), let .empty(value):
            value
        default:
            nil
        }
    }

    @ObservationIgnored private let source: any TeslaAccountStatusSource
    @ObservationIgnored private let actions: any TeslaAccountActions
    @ObservationIgnored private let opener: any TeslaAccountURLOpening
    @ObservationIgnored private let telemetry: any TeslaAccountTelemetry
    @ObservationIgnored private let localize: TeslaAccountLocalize
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private let onAuthRecovered: @MainActor () -> Void
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var prevAuthenticated: Bool?

    public init(
        source: any TeslaAccountStatusSource,
        actions: any TeslaAccountActions,
        opener: any TeslaAccountURLOpening = SystemTeslaAccountURLOpener(),
        telemetry: any TeslaAccountTelemetry = OSLogTeslaAccountTelemetry(),
        localize: @escaping TeslaAccountLocalize = TeslaAccountStrings.string,
        locale: Locale = .current,
        timeZone: TimeZone = .current,
        onAuthRecovered: @escaping @MainActor () -> Void = {}
    ) {
        self.source = source
        self.actions = actions
        self.opener = opener
        self.telemetry = telemetry
        self.localize = localize
        self.locale = locale
        self.timeZone = timeZone
        self.onAuthRecovered = onAuthRecovered
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Lifecycle

    /// Begins observing the upstream feed and emits the `view.opened` event once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        emitOpenOnce()
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream auth-status snapshot (header refresh button + error retry +
    /// connectivity-banner retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Connect (web `useAuthURL` → `window.location.href`)

    /// Requests the Tesla OAuth URL and hands it to the opener (web `handleLogin`). Wired to both the
    /// "Connect Tesla Account" and "Re-authorize" buttons. A failure is surfaced as an error toast
    /// (the P4 leaf error affordance; the web leaves this path silent).
    public func connect() async {
        guard !isConnecting else { return }
        isConnecting = true
        defer { isConnecting = false }
        do {
            let url = try await actions.authURL()
            opener.open(url)
        } catch let error as TeslaAccountError {
            postError(
                titleKey: "toast.tesla.authURLFailed",
                titleFallback: "Couldn’t start Tesla sign-in",
                error: error
            )
        } catch {
            postError(
                titleKey: "toast.tesla.authURLFailed",
                titleFallback: "Couldn’t start Tesla sign-in",
                error: .failed(message: error.localizedDescription)
            )
        }
    }

    // MARK: Refresh token (web `useRefreshAuth`)

    /// Runs the token refresh (web Refresh Token button): toasts success, flushes caches, toasts any
    /// failure with the error detail.
    public func refreshToken() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            try await actions.refreshToken()
            actions.invalidateCaches()
            toast = TeslaAccountToast(
                kind: .success,
                title: localize("toast.tokenRefreshed", "Token refreshed")
            )
        } catch let error as TeslaAccountError {
            postError(titleKey: "toast.tokenRefreshFailed", titleFallback: "Token refresh failed", error: error)
        } catch {
            postError(
                titleKey: "toast.tokenRefreshFailed",
                titleFallback: "Token refresh failed",
                error: .failed(message: error.localizedDescription)
            )
        }
    }

    // MARK: Sync vehicles (web `useSyncVehicles`)

    /// Runs the vehicle sync (web Sync Vehicles button): records the synced count for the success line
    /// (web `syncMut.isSuccess`) — no success toast, matching the web — and toasts any failure.
    public func syncVehicles() async {
        guard !isSyncing else { return }
        isSyncing = true
        syncedCount = nil
        defer { isSyncing = false }
        do {
            let count = try await actions.syncVehicles()
            syncedCount = max(0, count)
        } catch let error as TeslaAccountError {
            postError(titleKey: "toast.syncFailed", titleFallback: "Vehicle sync failed", error: error)
        } catch {
            postError(
                titleKey: "toast.syncFailed",
                titleFallback: "Vehicle sync failed",
                error: .failed(message: error.localizedDescription)
            )
        }
    }

    // MARK: Disconnect (web `useConfirm` → `useDisconnectAuth`)

    /// Opens the disconnect confirmation sheet (web `confirmDisconnect`).
    public func requestDisconnect() {
        disconnectPresented = true
    }

    /// Dismisses the disconnect confirmation without disconnecting (web `onCancel`). Ignored while the
    /// disconnect is in flight so the sheet stays up until it settles.
    public func cancelDisconnect() {
        guard !isDisconnecting else { return }
        disconnectPresented = false
    }

    /// Confirms the disconnect (web confirm → `disconnectMut.mutate`): runs the mutation, flushes
    /// caches + toasts success, toasts any failure with the error detail. The sheet stays up (loading)
    /// until the mutation settles.
    public func confirmDisconnect() async {
        guard !isDisconnecting else { return }
        isDisconnecting = true
        defer {
            isDisconnecting = false
            disconnectPresented = false
        }
        do {
            try await actions.disconnect()
            actions.invalidateCaches()
            toast = TeslaAccountToast(
                kind: .success,
                title: localize("toast.disconnected", "Tesla account disconnected")
            )
        } catch let error as TeslaAccountError {
            postError(titleKey: "toast.disconnectFailed", titleFallback: "Disconnect failed", error: error)
        } catch {
            postError(
                titleKey: "toast.disconnectFailed",
                titleFallback: "Disconnect failed",
                error: .failed(message: error.localizedDescription)
            )
        }
    }

    // MARK: Toast

    /// Clears the active toast (called by the view once its auto-dismiss elapses).
    public func dismissToast() {
        toast = nil
    }

    // MARK: Apply (status snapshot)

    private func apply(_ input: TeslaAccountStatusInput) {
        resolved = TeslaAccountProjection.resolve(
            input,
            localize: localize,
            locale: locale,
            timeZone: timeZone
        )
        connection = input.connection
        handleRecoveryEdge(input)
        emitOpenOnce()
        handleAutoRefresh(for: input.connection)
    }

    /// Fires the recovery callback only on the unauthenticated → authenticated edge (web
    /// `notifyTeslaAuthRecovered`), once per recovery, and only once the auth status has actually
    /// resolved (web `if (!auth) return`).
    private func handleRecoveryEdge(_ input: TeslaAccountStatusInput) {
        guard let authed = input.authenticated else { return }
        if prevAuthenticated == false, authed {
            onAuthRecovered()
        }
        prevAuthenticated = authed
    }

    private func emitOpenOnce() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: TeslaAccountDiagnostics.surface)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: TeslaAccountConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }

    private func postError(titleKey: String, titleFallback: String, error: TeslaAccountError) {
        let detail: String = switch error {
        case .offline:
            localize(
                "toast.tesla.offline",
                "You appear to be offline. Check your connection and try again."
            )
        case let .failed(message):
            message
        }
        toast = TeslaAccountToast(kind: .error, title: localize(titleKey, titleFallback), detail: detail)
    }
}
