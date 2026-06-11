//
//  InstallPrompt.States.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  The P4 leaf-contract chrome composed by `InstallPrompt` when the surface is not showing the active
//  prompt: the loading skeleton (the prompt shape as shimmer), the empty card (the native parity of
//  the web prompt returning nothing in standalone / dismissed / no-affordance — rendered as a calm,
//  honest card per kind instead of a blank box), and the error tile with a retry affordance. All copy
//  resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (the one-shot availability probe in flight)

/// The initial-probe chrome — a skeleton that keeps the prompt's shape (icon tile + two text lines +
/// an action) while the installability probe resolves. Brief in production (the probe is synchronous,
/// web parity), but a real, rendered state before the first emission.
struct InstallPromptLoadingView: View {
    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            TSSkeleton(width: 40, height: 40, cornerRadius: TSRadius.md)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 140, height: 12)
                TSSkeleton(width: 200, height: 10)
            }
            Spacer(minLength: TSSpacing.sm)
            TSSkeleton(width: 64, height: 28, cornerRadius: TSRadius.md)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: InstallPromptStrings.string(
            "installPrompt.loadingA11y", "Checking install options"
        )))
    }
}

// MARK: - Empty (web standalone / dismissed / no-affordance → render nothing)

/// The empty render — a friendly card, the native parity of the web prompt rendering nothing, improved
/// to never collapse to a blank box (P4 leaf contract). The copy stays honest per kind: a positive
/// confirmation when the app is already installed, a neutral acknowledgement when the prompt was
/// dismissed, and a clear "nothing to install yet" when no affordance is available.
struct InstallPromptEmptyView: View {
    let kind: InstallPromptEmptyKind

    private var titleText: String {
        switch kind {
        case .installed:
            InstallPromptStrings.string("installPrompt.empty.installed.title", "TeslaSync is installed")
        case .dismissed:
            InstallPromptStrings.string("installPrompt.empty.dismissed.title", "Install reminder hidden")
        case .unavailable:
            InstallPromptStrings.string("installPrompt.empty.unavailable.title", "Install isn't available yet")
        }
    }

    private var messageText: String {
        switch kind {
        case .installed:
            InstallPromptStrings.string(
                "installPrompt.empty.installed.message",
                "You're all set — TeslaSync is ready for quick, native access."
            )
        case .dismissed:
            InstallPromptStrings.string(
                "installPrompt.empty.dismissed.message",
                "We won't show the install prompt again for a couple of weeks. You can add TeslaSync any time "
                    + "from the share menu."
            )
        case .unavailable:
            InstallPromptStrings.string(
                "installPrompt.empty.unavailable.message",
                "There's nothing to install on this device right now. The prompt appears when a quick-install "
                    + "option becomes available."
            )
        }
    }

    private var systemImage: String {
        switch kind {
        case .installed: "checkmark.seal"
        case .dismissed: "bell.slash"
        case .unavailable: "square.and.arrow.down"
        }
    }

    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(titleText),
                message: LocalizedStringKey(messageText),
                systemImage: systemImage
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The probe-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct InstallPromptErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: InstallPromptStrings.string(
                    "installPrompt.errorTitle", "Couldn't check install options"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: InstallPromptStrings.string("installPrompt.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: InstallPromptStrings.string(
                    "installPrompt.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
