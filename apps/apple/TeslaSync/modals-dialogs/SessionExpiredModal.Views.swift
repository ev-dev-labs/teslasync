//
//  SessionExpiredModal.Views.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  The populated content for `SessionExpiredModal`: the hard block shown when the session has
//  expired (web Modal body) — an optional cached-verdict banner, the lock disc, the "Session
//  expired" title + reassuring body, the full-width "Sign in again" action (web `navigateToReauth`),
//  and an offline note when re-auth can't reach the IdP. All copy resolves through the P1/S10
//  facade; all chrome is token-driven (P1/S9). The block is non-dismissible — there is no close
//  affordance, mirroring the web's Esc/backdrop no-op.
//

import SwiftUI

// MARK: - Hard block (web non-dismissible Modal body)

/// The expired-session block: the web `space-y-4 text-center` column — lock disc, title, body, and
/// the full-width primary "Sign in again" button. A connectivity banner + offline note are layered
/// in for the stale / offline reads so the user understands a cached verdict drove the block.
struct SessionExpiredBlock: View {
    let connection: SessionConnection
    let onSignIn: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            if connection != .live {
                SessionExpiredConnectivityBanner(connection: connection)
            }
            iconDisc
            VStack(spacing: TSSpacing.xs) {
                SessionExpiredStrings.text("session.expired.title", "Session expired")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                SessionExpiredStrings.text(
                    "session.expired.body",
                    "For your security, your session has timed out. Sign in again to pick up where you left off."
                )
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            }
            signInButton
            if connection == .offline {
                offlineNote
            }
        }
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
    }

    /// The rose lock disc (web `rounded-full bg-rose-300/15` + `Lock text-rose-300`).
    private var iconDisc: some View {
        Image(systemName: "lock.fill")
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(Color.TS.statusDanger)
            .frame(width: 48, height: 48)
            .background(Color.TS.statusDanger.opacity(0.15), in: Circle())
            .accessibilityHidden(true)
    }

    /// The full-width primary action (web `<Button variant="primary" className="w-full">`).
    private var signInButton: some View {
        TSButton(variant: .primary, size: .large, action: onSignIn) {
            Text(verbatim: SessionExpiredStrings.string("session.expired.signIn", "Sign in again"))
                .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(SessionExpiredStrings.text("session.expired.signIn", "Sign in again"))
    }

    /// The offline caveat shown when re-auth can't reach the IdP — re-auth needs connectivity.
    private var offlineNote: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            SessionExpiredStrings.text(
                "session.expired.offlineBlock",
                "You're offline. Reconnect to sign in again."
            )
            .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension SessionExpiredStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so resolved copy is never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
