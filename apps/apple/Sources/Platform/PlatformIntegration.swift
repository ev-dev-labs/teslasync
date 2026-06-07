import CoreSpotlight
import SwiftUI

public extension Notification.Name {
    /// Posted when the user asks to refresh live vehicle state (⌘R / Refresh intent /
    /// Vehicle ▸ Refresh). Live surfaces (P7) observe this to re-pull their feeds;
    /// it is a decoupled signal so no menu/intent has to know which page is visible.
    static let teslaSyncRefreshRequested = Notification.Name("io.teslasync.refreshRequested")

    /// Posted when the user asks to print the current view (macOS File ▸ Print / ⌘P).
    /// Printable surfaces (P7) observe this; a decoupled signal so the menu need not
    /// know which page is visible.
    static let teslaSyncPrintRequested = Notification.Name("io.teslasync.printRequested")
}

/// Wires the cross-cutting platform behaviors onto the app's root: route Handoff
/// (advertise + restore), Universal Link + Spotlight continuation, recent-page
/// recording, Spotlight (re)indexing, and draining the out-of-process intent
/// requests when the app foregrounds. All privacy-gated by the live settings.
public struct PlatformIntegrationModifier: ViewModifier {
    @Binding private var selection: AppRoute?
    private let settingsModel: AppSettingsModel
    private let bridge: IntentBridge
    private let recentRoutes: RecentRoutesStore
    private let spotlight: SpotlightIndexer
    private let onRefreshRequested: () -> Void
    private let onCommand: (VehicleCommandRequest) -> Void

    @Environment(\.scenePhase) private var scenePhase

    public init(
        selection: Binding<AppRoute?>,
        settingsModel: AppSettingsModel,
        bridge: IntentBridge = .shared,
        recentRoutes: RecentRoutesStore = RecentRoutesStore(),
        spotlight: SpotlightIndexer = SpotlightIndexer(),
        onRefreshRequested: @escaping () -> Void = {
            NotificationCenter.default.post(name: .teslaSyncRefreshRequested, object: nil)
        },
        onCommand: @escaping (VehicleCommandRequest) -> Void
    ) {
        _selection = selection
        self.settingsModel = settingsModel
        self.bridge = bridge
        self.recentRoutes = recentRoutes
        self.spotlight = spotlight
        self.onRefreshRequested = onRefreshRequested
        self.onCommand = onCommand
    }

    public func body(content: Content) -> some View {
        content
            .advertiseRouteActivity(settingsModel.settings.handoffEnabled ? selection : nil)
            .onContinueRouteActivity { selection = $0 }
            .onContinueUserActivity(CSSearchableItemActionType) { activity in
                if let route = SpotlightIndexer.route(fromSearchableItemActivity: activity) {
                    selection = route
                }
            }
            .onChange(of: selection) { _, route in
                if let route {
                    recentRoutes.record(route, enabled: settingsModel.settings.recordRecentActivity)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { drainPendingIntents() }
            }
            .onChange(of: settingsModel.settings.spotlightIndexingEnabled) { _, enabled in
                Task { await spotlight.reindex(enabled: enabled) }
            }
            .task {
                drainPendingIntents()
                await spotlight.reindex(enabled: settingsModel.settings.spotlightIndexingEnabled)
            }
    }

    /// Applies any requests an out-of-process intent left in the App Group.
    private func drainPendingIntents() {
        if let route = bridge.consumePendingRoute() {
            selection = route
        }
        if bridge.consumeRefreshRequest() {
            onRefreshRequested()
        }
        if let request = bridge.consumePendingCommand() {
            onCommand(request)
        }
    }
}

/// Presents the surfaces the macOS Commands drive: a confirmation for an armed
/// vehicle command, the result banner, the blocked (auth/permission) nudge, and
/// the Help / Keyboard Shortcuts sheets.
public struct CommandActionsPresentationModifier: ViewModifier {
    @Bindable private var actions: AppCommandActions

    public init(actions: AppCommandActions) {
        self.actions = actions
    }

    private var pendingTitle: LocalizedStringKey {
        guard let kind = actions.pendingCommandConfirmation else { return "" }
        return LocalizedStringKey("intent.command.\(kind.rawValue).confirm")
    }

    public func body(content: Content) -> some View {
        content
            .confirmationDialog(
                pendingTitle,
                isPresented: Binding(
                    get: { actions.pendingCommandConfirmation != nil },
                    set: { if !$0 { actions.cancelPendingCommand() } }
                ),
                titleVisibility: .visible
            ) {
                Button("command.confirm.run", role: .destructive) { actions.confirmPendingCommand() }
                Button("action.cancel", role: .cancel) { actions.cancelPendingCommand() }
            }
            .alert(
                "command.outcome.title",
                isPresented: Binding(
                    get: { actions.lastOutcome != nil },
                    set: { if !$0 { actions.lastOutcome = nil } }
                )
            ) {
                Button("action.ok", role: .cancel) { actions.lastOutcome = nil }
            } message: {
                if let outcome = actions.lastOutcome {
                    Text(LocalizedStringKey(outcome.messageKey))
                }
            }
            .alert(
                "command.blocked.title",
                isPresented: Binding(
                    get: { actions.lastBlockedDecision != nil },
                    set: { if !$0 { actions.lastBlockedDecision = nil } }
                )
            ) {
                Button("action.ok", role: .cancel) { actions.lastBlockedDecision = nil }
            } message: {
                Text(blockedMessage)
            }
            .sheet(isPresented: $actions.helpSheetVisible) {
                MenuHelpView(
                    onShowShortcuts: {
                        actions.helpSheetVisible = false
                        actions.shortcutsSheetVisible = true
                    },
                    onClose: { actions.helpSheetVisible = false }
                )
            }
            .sheet(isPresented: $actions.shortcutsSheetVisible) {
                KeyboardShortcutsView(onClose: { actions.shortcutsSheetVisible = false })
            }
    }

    private var blockedMessage: LocalizedStringKey {
        switch actions.lastBlockedDecision {
        case .needsAuthentication: "command.blocked.needsAuth"
        case .notPermitted: "command.blocked.notPermitted"
        case .allowed, .none: "command.blocked.notPermitted"
        }
    }
}

public extension View {
    /// Applies route Handoff/continuity, Spotlight continuation, recents, and
    /// intent draining (see `PlatformIntegrationModifier`).
    func platformIntegration(
        selection: Binding<AppRoute?>,
        settingsModel: AppSettingsModel,
        onCommand: @escaping (VehicleCommandRequest) -> Void
    ) -> some View {
        modifier(PlatformIntegrationModifier(
            selection: selection,
            settingsModel: settingsModel,
            onCommand: onCommand
        ))
    }

    /// Presents the macOS command confirmations, outcomes, and Help sheets.
    func commandActionsPresentation(_ actions: AppCommandActions) -> some View {
        modifier(CommandActionsPresentationModifier(actions: actions))
    }
}
