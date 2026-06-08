//
//  LegacyNotificationsRedirect.Views.swift
//  TeslaSync — P4 feature view · 0187 · LegacyNotificationsRedirect (Apple)
//
//  Presentational subviews for the redirect surface: the accent icon chip, the
//  "resolving" affordance (web `<Navigate>` renders nothing — native shows a real,
//  accessible transition), and the resolved-destination panel with a manual "Continue"
//  fallback. All copy resolves through the P1/S10 facade; all chrome uses P1/S9 tokens.
//

import SwiftUI

// MARK: - SwiftUI string helper (P1/S10) — keeps the Model SwiftUI-free

extension LegacyNotificationsRedirectStrings {
    /// SwiftUI `Text` from the surface catalog table (the views hold no English
    /// literals — only keys + the web-style fallback).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Tab presentation

extension NotificationsRedirectTab {
    /// The SF Symbol shown for the destination tab.
    var systemImage: String {
        switch self {
        case .inbox: "tray.full.fill"
        case .archived: "archivebox.fill"
        case .channels: "square.stack.3d.up.fill"
        }
    }
}

// MARK: - Accent icon chip

/// The redirect's accent icon chip (decorative — the meaning is carried by the title).
struct LegacyNotificationsRedirectIcon: View {
    let systemImage: String

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 40, height: 40)
            .background(
                Color.TS.accent.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.accent.opacity(0.22), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Resolving affordance (first frame, before the location resolves)

/// The transient "performing the redirect" row. The web redirect is instantaneous and
/// invisible; native shows a real, accessible affordance so the surface is never blank.
struct LegacyNotificationsResolvingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView()
                .controlSize(.small)
                .accessibilityHidden(true)
            LegacyNotificationsRedirectStrings.text(
                "legacyNotificationsRedirect.resolving",
                "Taking you to Notifications…"
            )
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Resolved destination panel

/// The resolved-destination body: the destination name + chip, the inbox-default note
/// (web `?? '/notifications/inbox'`), the forwarded-filters note (web preserved params),
/// and a manual "Continue" affordance so the redirect is actionable even when automatic
/// navigation has not been honored.
struct LegacyNotificationsDestinationView: View {
    let redirect: ResolvedRedirect
    let onContinue: () -> Void

    private var destinationName: String {
        LegacyNotificationsRedirectStrings.destinationLabel(for: redirect.tab)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            heading
            if redirect.usedFallback {
                note(
                    key: "legacyNotificationsRedirect.fallbackNote",
                    fallback: "Showing your inbox",
                    systemImage: "tray.full"
                )
            }
            if !redirect.forwardedItems.isEmpty {
                note(
                    key: "legacyNotificationsRedirect.forwardedNote",
                    fallback: "Keeping your current filters",
                    systemImage: "line.3.horizontal.decrease.circle"
                )
            }
            continueButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var heading: some View {
        HStack(spacing: TSSpacing.sm) {
            LegacyNotificationsRedirectStrings.text(
                "legacyNotificationsRedirect.openingPrefix",
                "Opening"
            )
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            destinationChip
            Spacer(minLength: 0)
        }
    }

    private var destinationChip: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: redirect.tab.systemImage)
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: destinationName)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.accent.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: destinationName))
    }

    private func note(key: String, fallback: String, systemImage: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            LegacyNotificationsRedirectStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var continueButton: some View {
        let template = LegacyNotificationsRedirectStrings.string(
            "legacyNotificationsRedirect.continue",
            "Continue to %@"
        )
        let label = String(format: template, destinationName)
        return TSButton(variant: .primary, size: .medium, action: onContinue) {
            Text(verbatim: label)
        }
        .accessibilityLabel(Text(verbatim: label))
    }
}
