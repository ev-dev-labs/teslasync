//
//  PrivacySection.Chrome.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  The surface's state + feedback chrome, split out of the control views: the
//  consent-policy status banner (the P4 states contract — error / stale / offline), the
//  destructive clear-confirmation sheet (web `ConfirmDialog` + its silence checkbox), the
//  auto-dismissing success toast (web `useToast().success`), and the loading skeleton.
//  All consume the P1/S10 facade + the shared P1/S9 tokens; no networking, no Tailwind.
//

import SwiftUI

// MARK: - Status banner (the P4 states contract: error / stale / offline)

/// The consent-policy status banner shown above the controls when the policy is failed,
/// offline, or stale. The cached `requireConsent` flag stays applied beneath it; a retry
/// affordance is offered for the failed + stale cases.
struct PrivacyStatusBannerView: View {
    let banner: PrivacyStatusBanner
    let onRetry: () -> Void

    private var tone: Color {
        switch banner.tone {
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        case .stale: Color.TS.statusWarning
        }
    }

    private var systemImage: String {
        switch banner.tone {
        case .error: "exclamationmark.triangle.fill"
        case .offline: "wifi.slash"
        case .stale: "arrow.triangle.2.circlepath"
        }
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: banner.message(PrivacyStrings.string))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            if banner.showsRetry {
                Button(action: onRetry) {
                    PrivacyStrings.text("privacy.status.retry", "Retry")
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(PrivacyStrings.text("privacy.status.retry", "Retry"))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Clear confirmation (web `ConfirmDialog` + silence checkbox)

/// The destructive clear-confirmation sheet — the native parity of the web warning
/// `ConfirmDialog`: a warning callout with the title + message, the "Don't ask again"
/// toggle (web silence checkbox), and the cancel / clear buttons.
struct PrivacyClearConfirmation: View {
    @Binding var dontAskAgain: Bool
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    PrivacyStrings.text("recentPages.clearConfirmTitle", "Clear recent pages?")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    PrivacyStrings.text(
                        "recentPages.clearConfirmBody",
                        "This will wipe the list immediately. The dashboard widget and palette Recent section "
                            + "will be empty until you visit new pages."
                    )
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.statusWarning.opacity(0.10),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusWarning.opacity(0.25), lineWidth: 1)
            )

            Toggle(isOn: $dontAskAgain) {
                PrivacyStrings.text("confirm.silence.checkbox", "Don't ask again for this action")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .toggleStyle(.switch)
            .tint(Color.TS.accent)

            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                PrivacyActionButton(
                    title: PrivacyStrings.string("common.cancel", "Cancel"),
                    variant: .secondary,
                    action: onCancel
                )
                PrivacyActionButton(
                    title: PrivacyStrings.string("recentPages.clearConfirmCta", "Clear pages"),
                    variant: .destructive,
                    action: onConfirm
                )
            }
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minWidth: 320)
        .background(Color.TS.surface)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Toast (web `useToast().success`)

/// The auto-dismissing success toast — a checkmark + the facade-resolved message, posted
/// after a clear or a consent change. Honors Reduce Motion for its transition.
struct PrivacyToastView: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.statusSuccess.opacity(0.3), lineWidth: 1))
        .shadow(color: Color.black.opacity(0.18), radius: 12, y: 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Loading skeleton

/// A single redacted shimmer bar — a surface-local skeleton primitive that respects
/// Reduce Motion (no shimmer animation when enabled).
struct PrivacyShimmerBar: View {
    var width: CGFloat?
    var height: CGFloat = 12
    var cornerRadius: CGFloat = TSRadius.sm
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmer = false

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Color.TS.border.opacity(0.30))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [.clear, Color.TS.surface.opacity(0.7), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 0.4)
                        .offset(x: shimmer ? geo.size.width : -geo.size.width * 0.4)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { shimmer = true }
            }
            .accessibilityHidden(true)
    }
}

/// The initial-load skeleton chrome — a redacted header plus two redacted control panels
/// matching the loaded layout so the transition is stable.
struct PrivacySkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                PrivacyShimmerBar(width: 40, height: 40, cornerRadius: TSRadius.md)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    PrivacyShimmerBar(width: 120, height: 16)
                    PrivacyShimmerBar(height: 10)
                }
            }
            ForEach(0 ..< 2, id: \.self) { _ in
                rowSkeleton
            }
        }
        .accessibilityElement()
        .accessibilityLabel(PrivacyStrings.text("privacy.loading", "Loading privacy settings"))
    }

    private var rowSkeleton: some View {
        PrivacyRowPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                PrivacyShimmerBar(width: 160, height: 14)
                PrivacyShimmerBar(height: 10)
                PrivacyShimmerBar(width: 200, height: 28, cornerRadius: TSRadius.md)
                    .padding(.top, TSSpacing.xs)
            }
        }
    }
}
