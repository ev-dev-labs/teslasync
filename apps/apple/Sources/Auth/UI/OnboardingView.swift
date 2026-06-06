import SwiftUI

/// First-run onboarding + sign-in surface. Renders the signed-out, in-progress
/// (`authenticating`), and `failed` states — never a blank screen (ADR-011) — and
/// starts the OIDC flow on the shared `AuthCoordinator`.
struct OnboardingView: View {
    let coordinator: AuthCoordinator

    private var isSigningIn: Bool {
        coordinator.state == .authenticating
    }

    var body: some View {
        ScrollView {
            VStack(spacing: TSSpacing.x2xl) {
                hero
                features
                if case let .failed(error) = coordinator.state {
                    TSAlertBanner(
                        tone: .danger,
                        systemImage: "exclamationmark.triangle.fill",
                        title: "auth.error.title",
                        message: LocalizedStringKey(error.localizationKey)
                    )
                }
                signInButton
                Text("auth.onboarding.privacyNote")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg)
    }

    private var hero: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "bolt.car.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text("auth.onboarding.title")
                .font(Font.TS.display)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text("auth.onboarding.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            AuthFeatureRow(
                systemImage: "lock.shield.fill",
                title: "auth.onboarding.feature.secure.title",
                message: "auth.onboarding.feature.secure.message"
            )
            AuthFeatureRow(
                systemImage: "faceid",
                title: "auth.onboarding.feature.biometric.title",
                message: "auth.onboarding.feature.biometric.message"
            )
            AuthFeatureRow(
                systemImage: "hand.raised.fill",
                title: "auth.onboarding.feature.privacy.title",
                message: "auth.onboarding.feature.privacy.message"
            )
        }
    }

    private var signInButton: some View {
        TSButton("auth.onboarding.signInButton", size: .large, isLoading: isSigningIn) {
            Task { await coordinator.signIn() }
        }
        .accessibilityIdentifier("auth.signIn.button")
        .accessibilityHint(Text("auth.onboarding.signInHint"))
    }
}

/// A single value-proposition row on the onboarding surface.
private struct AuthFeatureRow: View {
    let systemImage: String
    let title: LocalizedStringKey
    let message: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(Color.TS.accent)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
