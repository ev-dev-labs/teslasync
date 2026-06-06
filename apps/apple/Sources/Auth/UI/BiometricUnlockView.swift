import SwiftUI

/// The locked-session surface (`locked` state). Prompts for the optional
/// biometric/passcode unlock and offers a recovery path (sign out) so a user is
/// never trapped if biometrics fail.
struct BiometricUnlockView: View {
    let coordinator: AuthCoordinator
    @State private var isUnlocking = false

    var body: some View {
        VStack(spacing: TSSpacing.xl) {
            Image(systemName: coordinator.biometricAvailability.kind.systemImage)
                .font(.system(size: 52))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)

            VStack(spacing: TSSpacing.sm) {
                Text("auth.locked.title")
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("auth.locked.message")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }

            if let error = coordinator.lastError {
                TSAlertBanner(
                    tone: .danger,
                    systemImage: "exclamationmark.triangle.fill",
                    title: "auth.error.title",
                    message: LocalizedStringKey(error.localizationKey)
                )
            }

            VStack(spacing: TSSpacing.sm) {
                TSButton(unlockTitle, size: .large, isLoading: isUnlocking) {
                    Task {
                        isUnlocking = true
                        await coordinator.unlock()
                        isUnlocking = false
                    }
                }
                .accessibilityIdentifier("auth.unlock.button")
                TSButton("auth.locked.useDifferentAccount", variant: .ghost) {
                    Task { await coordinator.signOut() }
                }
            }
        }
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.TS.bg)
    }

    private var unlockTitle: LocalizedStringKey {
        switch coordinator.biometricAvailability.kind {
        case .faceID: "auth.locked.unlock.faceID"
        case .touchID: "auth.locked.unlock.touchID"
        case .opticID: "auth.locked.unlock.opticID"
        case .passcodeOnly, .none: "auth.locked.unlock.passcode"
        }
    }
}

/// The re-authentication surface (`reauthRequired` state) shown after a refresh
/// failed and secrets were cleared. The user signs in again or signs out.
struct ReauthView: View {
    let coordinator: AuthCoordinator
    @State private var isSigningIn = false

    var body: some View {
        VStack(spacing: TSSpacing.xl) {
            Image(systemName: "person.badge.clock.fill")
                .font(.system(size: 52))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)

            VStack(spacing: TSSpacing.sm) {
                Text("auth.reauth.title")
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("auth.reauth.message")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: TSSpacing.sm) {
                TSButton("auth.reauth.button", size: .large, isLoading: isSigningIn) {
                    Task {
                        isSigningIn = true
                        await coordinator.signIn()
                        isSigningIn = false
                    }
                }
                .accessibilityIdentifier("auth.reauth.button")
                TSButton("auth.signOut", variant: .ghost) {
                    Task { await coordinator.signOut() }
                }
            }
        }
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.TS.bg)
    }
}
