import SwiftUI

/// The authentication gate at the app's root. Renders exactly one surface per
/// auth state — splash, onboarding/sign-in, biometric unlock, re-auth, or the
/// authenticated `AppShell` — so the user always sees a real screen (ADR-011).
/// The shared `AuthCoordinator` is owned by the app and observed here.
public struct RootView: View {
    private let coordinator: AuthCoordinator
    @Binding private var selection: AppRoute?

    public init(coordinator: AuthCoordinator, selection: Binding<AppRoute?>) {
        self.coordinator = coordinator
        _selection = selection
    }

    public var body: some View {
        content
            .teslaSyncTheme()
            .task { await coordinator.start() }
            .animation(.smooth, value: coordinator.state)
    }

    @ViewBuilder
    private var content: some View {
        switch coordinator.state {
        case .initializing:
            AuthSplashView()
        case .signedOut, .authenticating, .failed:
            OnboardingView(coordinator: coordinator)
        case .locked:
            BiometricUnlockView(coordinator: coordinator)
        case .reauthRequired:
            ReauthView(coordinator: coordinator)
        case .authenticated, .reauthenticating:
            authenticatedShell
        }
    }

    private var authenticatedShell: some View {
        AppShell(selection: $selection)
            .overlay(alignment: .top) {
                if coordinator.isSessionExpiringSoon {
                    SessionExpiringBanner {
                        Task { _ = try? await coordinator.validAccessToken() }
                    }
                }
            }
            .overlay {
                if coordinator.state == .reauthenticating {
                    ReauthenticatingOverlay()
                }
            }
    }
}
