//
//  NavigationGuardProvider.swift
//  TeslaSync — P4 shared surface · 0128 · NavigationGuardProvider (Apple)
//
//  The SwiftUI surface — the public API of the in-app unsaved-changes navigation guard, the parity of
//  the web `components/feedback/NavigationGuardProvider.tsx`. This file holds the @Observable
//  coordinator (P1/S8 state holder — the registry, the in-flight continuation re-use, the
//  `confirmIfDirty` / `confirmBack` API, and the silence honoring) and the `NavigationGuardProvider`
//  view that injects the context (Seams) and renders its children plus the confirm presenter (Views).
//  No router, no networking — the host nav layer awaits the coordinator.
//
//  States (every one renders — no hidden surface; see `NavigationGuardConfirmSurface`):
//    • idle       — nothing to confirm; the live provider is transparent (web renders `null`).
//    • confirming — a guard is dirty and the warning prompt is up (the real interactive state).
//    • loading / error / stale / offline — the P4 leaf contract for the standalone presenter.
//

import Observation
import SwiftUI

// MARK: - Coordinator (P1/S8 state holder)

/// The provider's observable view-model — the native parity of the web `NavigationGuardProvider`
/// component state. Owns the guard registry (web `guards.current`), re-uses an in-flight confirm across
/// racing callers (web `pendingPromiseRef`), honors the "Don't ask again" silence (web
/// `<ConfirmDialog>` `silenceKey`), publishes the resolved render state the presenter binds, and emits
/// the once-only `view.opened` diagnostics event. The view does no I/O; the host nav layer awaits
/// `confirmIfDirty()` / `confirmBack()`.
@MainActor
@Observable
public final class NavigationGuardCoordinator: NavigationGuardContext {
    /// The resolved render state (web render branches + P4 leaf contract).
    public private(set) var state: NavigationGuardResolution = .idle(connection: .live)
    /// The "Don't ask again" opt-out, bound to the confirm card's toggle (web `dontAskAgain` state).
    public private(set) var dontAskAgain = false

    @ObservationIgnored private var registry = NavigationGuardRegistry()
    @ObservationIgnored private var pending: [CheckedContinuation<Bool, Never>] = []
    @ObservationIgnored private var connection: NavigationGuardConnection = .live
    @ObservationIgnored private let silence: any NavigationGuardSilence
    @ObservationIgnored private let telemetry: any NavigationGuardTelemetry
    @ObservationIgnored private let localize: NavigationGuardResolve
    @ObservationIgnored private let silenceKey: String
    @ObservationIgnored private var started = false

    public init(
        silence: any NavigationGuardSilence = UserDefaultsNavigationGuardSilence(),
        telemetry: any NavigationGuardTelemetry = OSLogNavigationGuardTelemetry(),
        localize: @escaping NavigationGuardResolve = NavigationGuardStrings.string,
        silenceKey: String = "unsaved-navigation"
    ) {
        self.silence = silence
        self.telemetry = telemetry
        self.localize = localize
        self.silenceKey = silenceKey
    }

    // MARK: Lifecycle

    /// Begins the surface and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NavigationGuardSurface.slug)
    }

    /// Tears down — clears the started flag so a re-mount re-emits `view.opened`.
    public func stop() {
        started = false
    }

    // MARK: Context (web `register` / `confirmIfDirty`)

    @discardableResult
    public func register(_ entry: NavigationGuardEntry) -> NavigationGuardRegistrationToken {
        registry.set(entry)
        let id = entry.id
        return NavigationGuardRegistrationToken { [weak self] in
            self?.unregister(id: id)
        }
    }

    /// Unregister a guard by id (web cleanup `guards.delete`).
    public func unregister(id: String) {
        registry.remove(id: id)
    }

    public func confirmIfDirty() async -> Bool {
        await requestConfirmation()
    }

    /// The browser-back parity (web `popstate` handler): same registry, same prompt, same in-flight
    /// re-use — a dirty guard intercepts the back and routes to the confirm prompt.
    public func confirmBack() async -> Bool {
        await requestConfirmation()
    }

    // MARK: Confirm resolution (web `handleConfirm` / `handleCancel`)

    /// Discard the unsaved work and proceed (web "Discard changes" → `resolve(true)`): persists the
    /// silence choice when the opt-out is ticked, then resolves every awaiting caller with `true`.
    public func confirmDiscard() {
        resolve(true)
    }

    /// Keep editing (web "Keep editing" / Escape / backdrop → `resolve(false)`): dismiss the prompt and
    /// resolve every awaiting caller with `false`.
    public func keepEditing() {
        resolve(false)
    }

    /// Toggle the "Don't ask again" opt-out (web silence checkbox).
    public func setDontAskAgain(_ value: Bool) {
        dontAskAgain = value
    }

    /// Update the freshness of the silence-allowlist feed (web stale/offline). Drives the freshness
    /// chip on a live prompt.
    public func setConnection(_ next: NavigationGuardConnection) {
        connection = next
        if case let .confirming(request) = state, request.connection != next {
            state = .confirming(NavigationGuardConfirmRequest(
                copy: request.copy,
                showsSilenceToggle: request.showsSilenceToggle,
                connection: next
            ))
        } else if case .idle = state {
            state = .idle(connection: next)
        }
    }

    /// The number of callers awaiting the in-flight prompt (test seam for the re-use assertion).
    var pendingCount: Int {
        pending.count
    }

    // MARK: Private

    private func requestConfirmation() async -> Bool {
        if !pending.isEmpty {
            return await withCheckedContinuation { enqueue($0) }
        }
        let dirty = registry.firstDirty()
        let outcome = NavigationGuardDecision.resolve(
            hasDirtyGuard: dirty != nil,
            dirtyMessage: dirty?.message(),
            isSilenced: silence.isSilenced(silenceKey)
        )
        switch outcome {
        case .proceed:
            return true
        case let .prompt(customMessage):
            dontAskAgain = false
            let copy = NavigationGuardConfirmContent.build(customMessage: customMessage, localize: localize)
            state = .confirming(NavigationGuardConfirmRequest(
                copy: copy,
                showsSilenceToggle: NavigationGuardDecision.silenceHonored(silenceKey: silenceKey),
                connection: connection
            ))
            return await withCheckedContinuation { enqueue($0) }
        }
    }

    private func enqueue(_ continuation: CheckedContinuation<Bool, Never>) {
        pending.append(continuation)
    }

    private func resolve(_ ok: Bool) {
        let waiters = pending
        pending = []
        if ok, dontAskAgain, !silenceKey.isEmpty {
            silence.silence(silenceKey)
        }
        dontAskAgain = false
        state = .idle(connection: connection)
        for waiter in waiters {
            waiter.resume(returning: ok)
        }
    }
}

// MARK: - NavigationGuardProvider (the shared surface)

/// The app-wide navigation guard — the SwiftUI parity of the web `<NavigationGuardProvider>`. Wrap the
/// app root in one provider; descendants register their dirty-form guards via
/// `.navigationGuard(id:isDirty:message:)` and the host nav layer awaits `confirmIfDirty()` before
/// leaving. The provider renders its children transparently and overlays the warning confirm prompt
/// only when a guarded navigation hits a dirty guard.
public struct NavigationGuardProvider<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        NavigationGuardSurface.slug
    }

    @State private var coordinator: NavigationGuardCoordinator
    private let content: Content

    /// Production initializer — the parity of `<NavigationGuardProvider>`. Seams default to the
    /// `UserDefaults` silence allowlist + the redaction-safe diagnostics sink + the P1/S10 facade.
    public init(
        silence: any NavigationGuardSilence = UserDefaultsNavigationGuardSilence(),
        telemetry: any NavigationGuardTelemetry = OSLogNavigationGuardTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        _coordinator = State(initialValue: NavigationGuardCoordinator(
            silence: silence,
            telemetry: telemetry
        ))
        self.content = content()
    }

    /// Coordinator-injecting initializer — used by previews + tests that drive in-memory seams and
    /// assert against the bound coordinator.
    public init(coordinator: NavigationGuardCoordinator, @ViewBuilder content: () -> Content) {
        _coordinator = State(initialValue: coordinator)
        self.content = content()
    }

    public var body: some View {
        content
            .environment(\.navigationGuard, coordinator)
            .overlay {
                confirmOverlay
            }
            .onAppear { coordinator.start() }
            .onDisappear { coordinator.stop() }
    }

    /// The pending confirm prompt — shown only while `confirming` (web renders `null` otherwise).
    @ViewBuilder
    private var confirmOverlay: some View {
        if let request = coordinator.state.request {
            NavigationGuardScrim(
                onBackdrop: { coordinator.keepEditing() },
                card: {
                    NavigationGuardConfirmCard(
                        request: request,
                        dontAskAgain: coordinator.dontAskAgain,
                        onToggleSilence: { coordinator.setDontAskAgain($0) },
                        onDiscard: { coordinator.confirmDiscard() },
                        onKeepEditing: { coordinator.keepEditing() },
                        onRefresh: { coordinator.setConnection(.live) }
                    )
                }
            )
        }
    }
}

// MARK: - Registration modifier (web `useNavigationGuard`)

public extension View {
    /// Register this view's dirty-form state with the ambient ``NavigationGuardProvider`` — the native
    /// parity of the web `useNavigationGuard(isDirty, message)` hook. The guard is (re)registered when
    /// `isDirty` / `message` change and unregistered when the view disappears (web `useEffect`
    /// cleanup). Outside a provider this is inert (web `NOOP_CTX`).
    func navigationGuard(
        id: String,
        isDirty: Bool,
        message: String? = nil
    ) -> some View {
        modifier(NavigationGuardRegistrationModifier(id: id, isDirty: isDirty, message: message))
    }
}

private struct NavigationGuardRegistrationModifier: ViewModifier {
    let id: String
    let isDirty: Bool
    let message: String?

    @Environment(\.navigationGuard) private var context
    @State private var token: NavigationGuardRegistrationToken?

    func body(content: Content) -> some View {
        content
            .onAppear { reregister() }
            .onChange(of: isDirty) { reregister() }
            .onChange(of: message) { reregister() }
            .onDisappear {
                token?.cancel()
                token = nil
            }
    }

    private func reregister() {
        let dirty = isDirty
        let snapshot = message
        let entry = NavigationGuardEntry(id: id, isDirty: { dirty }, message: { snapshot })
        token?.cancel()
        token = context?.register(entry)
    }
}
