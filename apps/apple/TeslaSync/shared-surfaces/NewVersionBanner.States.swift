//
//  NewVersionBanner.States.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  The P4 leaf-contract chrome composed by ``NewVersionBanner`` when the surface is not showing the
//  available-version banner: the loading skeleton (the banner shape while the boot probe of
//  `/system/version` is in flight), the up-to-date empty state (the friendly native parity of the web
//  banner returning `null` when no new version is available, never a blank box), and the error tile
//  with a retry affordance (the boot probe failed — web swallows this to `null`, surfaced here). All
//  copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (boot probe in flight)

/// The boot-probe chrome — a skeleton banner that keeps the surface's shape (icon + a text line + an
/// action) while the first `/system/version` probe resolves the baseline.
struct NewVersionBannerLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            TSSkeleton(height: 12)
            TSSkeleton(width: 72, height: 28, cornerRadius: TSRadius.sm)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: NewVersionBannerStrings.string(
            "app.newVersion.loadingA11y", "Checking for updates"
        )))
    }
}

// MARK: - Empty (up to date / dismissed — web `return null`)

/// The empty render — a friendly card stating that TeslaSync is up to date, the native parity of the
/// web banner returning `null` when there is no new version (improved to never collapse to a blank
/// box, per the P4 leaf contract). Also the resting state after the user taps "Later".
struct NewVersionBannerUpToDateView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(NewVersionBannerStrings.string(
                    "app.newVersion.upToDateTitle", "You're on the latest version"
                )),
                message: LocalizedStringKey(NewVersionBannerStrings.string(
                    "app.newVersion.upToDateMessage",
                    "TeslaSync is up to date. A notice appears here when a new version is deployed."
                )),
                systemImage: "checkmark.seal"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (boot probe failed — web swallows to null)

/// The boot-probe-failure state — a compact error card with a retry affordance. The web hook swallows
/// the failure to `null` and retries on the next poll tick; the P4 leaf surfaces it so a misconfigured
/// `/system/version` is visible. The message is the runtime failure reason, rendered verbatim.
struct NewVersionBannerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: NewVersionBannerStrings.string(
                    "app.newVersion.errorTitle", "Couldn't check for updates"
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
                    Text(verbatim: NewVersionBannerStrings.string("app.newVersion.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: NewVersionBannerStrings.string(
                    "app.newVersion.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
