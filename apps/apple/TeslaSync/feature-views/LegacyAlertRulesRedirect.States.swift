//
//  LegacyAlertRulesRedirect.States.swift
//  TeslaSync — P4 feature view · 0184 · LegacyAlertRulesRedirect (Apple)
//
//  The phase-driven chrome for the legacy Alert Rules redirect: the in-progress "Redirecting…" state
//  (the web pre-navigation render), the no-inbound-location empty state with a safe parent fallback
//  (defensive — the web source would still navigate), and the resolve-failure state with a retry
//  affordance (web `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade. Never a blank panel.
//

import SwiftUI

// MARK: - Redirecting (the web pre-navigation render)

/// The in-progress state shown while the inbound location resolves and the redirect dispatches: a
/// spinner, the "Redirecting to Alert Rules…" label, and the destination breadcrumb. Never a blank box.
struct LegacyAlertRulesRedirectProgress: View {
    let breadcrumb: AlertRulesRedirectBreadcrumb

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityHidden(true)
                LegacyAlertRulesRedirectStrings.text(
                    "legacyAlertRulesRedirect.redirecting",
                    "Redirecting to Alert Rules…"
                )
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: 0)
            }
            LegacyAlertRulesRedirectBreadcrumbRow(breadcrumb: breadcrumb)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            LegacyAlertRulesRedirectStrings.text(
                "legacyAlertRulesRedirect.redirecting",
                "Redirecting to Alert Rules…"
            )
        )
    }
}

// MARK: - Empty (no inbound location — safe parent fallback)

/// The no-inbound-location state: a friendly explanation plus a "Go to Notifications" action that routes
/// to the target's safe parent, so the surface is never a dead end. Never a blank box.
struct LegacyAlertRulesRedirectEmptyState: View {
    let onGoToParent: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "bell.badge.slash")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            LegacyAlertRulesRedirectStrings.text(
                "legacyAlertRulesRedirect.emptyTitle",
                "Alert Rules is unavailable"
            )
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            LegacyAlertRulesRedirectStrings.text(
                "legacyAlertRulesRedirect.emptyMessage",
                "We couldn't read where to send you. Open Notifications to continue."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            LegacyAlertRulesRedirectActionButton(
                titleKey: "legacyAlertRulesRedirect.goToParent",
                titleFallback: "Go to Notifications",
                systemImage: "bell.fill",
                action: onGoToParent
            )
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Error (resolve failure — web `QueryError`)

/// The resolve-failure state with a retry affordance (web `QueryError`). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct LegacyAlertRulesRedirectErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            LegacyAlertRulesRedirectStrings.text(
                "legacyAlertRulesRedirect.errorTitle",
                "Couldn't open Alert Rules"
            )
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            LegacyAlertRulesRedirectActionButton(
                titleKey: "legacyAlertRulesRedirect.retry",
                titleFallback: "Retry",
                systemImage: "arrow.clockwise",
                action: onRetry
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Shared pill action button

/// The capsule action button shared by the empty / error / confirmation states: a leading glyph + the
/// localized title, with a spoken label. Token-driven; copy via the P1/S10 facade.
struct LegacyAlertRulesRedirectActionButton: View {
    let titleKey: String
    let titleFallback: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                LegacyAlertRulesRedirectStrings.text(titleKey, titleFallback)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LegacyAlertRulesRedirectStrings.text(titleKey, titleFallback))
        .accessibilityAddTraits(.isButton)
    }
}
