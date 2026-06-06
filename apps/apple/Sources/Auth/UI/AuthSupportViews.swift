import SwiftUI

/// Branded splash shown for the brief `initializing` tick while the stored
/// session is restored from the Keychain.
struct AuthSplashView: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            Image(systemName: "bolt.car.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TSPageLoader(label: "auth.splash.loading")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.TS.bg)
    }
}

/// Top banner warning that the session is about to expire, with a refresh action.
struct SessionExpiringBanner: View {
    let onRefresh: () -> Void

    var body: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "clock.badge.exclamationmark",
            title: "auth.expiring.title",
            message: "auth.expiring.message"
        ) {
            TSButton("auth.expiring.action", variant: .secondary, size: .small, action: onRefresh)
        }
        .padding(TSSpacing.md)
    }
}

/// Dimmed, modal overlay shown while a silent re-authentication is in flight so
/// the underlying content is not interactable mid-refresh.
struct ReauthenticatingOverlay: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()
            TSSpinner(label: "auth.reauth.inProgress")
                .padding(TSSpacing.xl)
                .background(
                    Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                )
        }
        .accessibilityAddTraits(.isModal)
    }
}
