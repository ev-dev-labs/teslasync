import SwiftUI

// The Command Center building blocks (web `DashboardPage.tsx`): the first-run theme banner,
// the customize-discovery hint, the Tesla-not-connected warning, the onboarding empty state
// (its hero `GlassPanel` + feature `GlassPanel`s), the edit-mode hint, the loading skeleton,
// the populated widget grid + its tiles, the load-error region, and the kiosk overlay. Every
// visible literal resolves from `Localizable.xcstrings` with the web key names; nothing is
// hardcoded. These are native SwiftUI surfaces (materials, `LazyVGrid`, SF Symbols) — never a
// web clone.

// MARK: - Theme first-run banner (web `ThemeFirstRunBanner`)

/// The one-time prompt to surface the theme picker (web `ThemeFirstRunBanner`): an info banner
/// with "Open theme picker" / "Maybe later" actions and a dismiss control.
struct DashboardThemeBanner: View {
    let onOpenPicker: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "paintpalette.fill",
            title: "theme.firstRunTitle",
            message: "theme.firstRunBody",
            onDismiss: onDismiss
        ) {
            HStack(spacing: TSSpacing.sm) {
                TSButton("theme.firstRunOpen", size: .small, action: onOpenPicker)
                TSButton("theme.firstRunLater", variant: .ghost, size: .small, action: onDismiss)
            }
        }
    }
}

// MARK: - Customize hint (web soft `AlertBanner`)

/// The soft "you can customize this dashboard" hint (web hint `AlertBanner`): shown for users
/// still on the seeded default layout, with an "Add widgets" call-to-action and a dismiss.
struct DashboardCustomizeHintBanner: View {
    let onAddWidgets: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "plus.circle.fill",
            title: "dashboard.customizeHint",
            onDismiss: onDismiss
        ) {
            TSButton("dashboard.customizeHintCta", size: .small, action: onAddWidgets)
        }
    }
}

// MARK: - Auth warning (web `auth && !auth.authenticated` banner)

/// The "Tesla account not connected" warning (web auth `AlertBanner`): the warning title plus
/// the inline "Connect your account in [Settings] to start tracking." sentence whose Settings
/// link opens the settings route. Styled to match `TSAlertBanner`'s warning tone.
struct DashboardAuthBanner: View {
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(TSTone.warning.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text("auth.notConnected")
                    .font(Font.TS.bodySm).fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                promptSentence
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(
            TSTone.warning.color.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(TSTone.warning.color.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    /// Web "Connect your account in {Settings} to start tracking." with an inline link.
    private var promptSentence: some View {
        HStack(spacing: TSSpacing.xs) {
            Text("auth.connectPrompt")
                .font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            Button(action: onOpenSettings) {
                Text("auth.settings").font(Font.TS.caption).fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
            Text("auth.toStart")
                .font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
        }
    }
}

// MARK: - Onboarding empty state (web `EmptyOnboarding`)

/// The no-vehicles onboarding (web `EmptyOnboarding`): the hero `GlassPanel` (GlassPanel1) with
/// the connect-or-sync prompt + call-to-action, above the feature-highlight `GlassPanel`s
/// (GlassPanel2). The copy switches on whether the Tesla account is already connected.
struct DashboardOnboarding: View {
    let authenticated: Bool
    let isSyncing: Bool
    let onSync: () -> Void
    let onConnect: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            heroPanel
            featurePanel
        }
    }

    /// Web `EmptyOnboarding` hero `GlassPanel` (parity panel "GlassPanel1").
    private var heroPanel: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                Image(systemName: "bolt.car.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(LocalizedStringKey(DashboardOnboardingCopy.titleKey(authenticated: authenticated)))
                    .font(Font.TS.title).foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Text(LocalizedStringKey(DashboardOnboardingCopy.descriptionKey(authenticated: authenticated)))
                    .font(Font.TS.body).foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 460)
                callToAction
                    .padding(.top, TSSpacing.sm)
            }
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var callToAction: some View {
        if authenticated {
            TSButton(LocalizedStringKey(DashboardOnboardingCopy.ctaKey(authenticated: true)),
                     isLoading: isSyncing, action: onSync)
        } else {
            TSButton(LocalizedStringKey(DashboardOnboardingCopy.ctaKey(authenticated: false)), action: onConnect)
        }
    }

    /// Web `EmptyOnboarding` feature highlights (parity panel "GlassPanel2").
    private var featurePanel: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(DashboardOnboardingFeature.allCases) { feature in
                TSGlassPanel {
                    VStack(spacing: TSSpacing.sm) {
                        Image(systemName: feature.systemImage)
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(feature.tone.color)
                            .accessibilityHidden(true)
                        Text(LocalizedStringKey(feature.labelKey))
                            .font(Font.TS.caption).fontWeight(.medium)
                            .foregroundStyle(Color.TS.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: 640)
    }
}

// MARK: - Edit-mode hint (web edit `dashboard.editHint`)

/// The dashed edit-mode helper (web edit-mode hint card): explains drag/resize/settings.
struct DashboardEditHint: View {
    var body: some View {
        Text("dashboard.editHint")
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(TSSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass.opacity(0.4))
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .foregroundStyle(Color.TS.border)
            )
    }
}

// MARK: - Loading skeleton (web `LoadingSkeleton`)

/// Mirrors the dashboard layout while the garage loads (web `LoadingSkeleton`): a hero block
/// over a four-up tile grid under SwiftUI redaction.
struct DashboardSkeleton: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .fill(Color.TS.surfaceGlass)
                .frame(height: 220)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .fill(Color.TS.surfaceGlass)
                        .frame(height: 110)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .redacted(reason: .placeholder) // parity:allow manifest loading->redacted skeleton, not a stub
        .accessibilityElement()
        .accessibilityLabel(Text("title"))
    }
}

// MARK: - Load-error region (web `error.loadFailed`)

/// The retryable load-failure region (web error `AlertBanner` → here the page's terminal error
/// state): the failure message plus a Retry affordance.
struct DashboardErrorRegion: View {
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            TSErrorDisplay(title: "error.loadFailed", onRetry: onRetry)
        }
        .frame(maxWidth: 460)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }
}
