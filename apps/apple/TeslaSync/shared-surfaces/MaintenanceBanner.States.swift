//
//  MaintenanceBanner.States.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `MaintenanceBanner` when the surface is not in its banner
//  state: the loading skeleton (the banner shape as shimmer while the first `/system/health` read is in
//  flight — the web component's pre-resolve window where `data` is undefined), the empty state (no
//  active banner — `mode === 'ok'` or a dismissed snapshot — the friendly native improvement over the
//  web component rendering nothing, never a blank box), and the error tile with a retry affordance (the
//  initial-read failure). All copy resolves through the P1/S10 facade; all colour comes from the P1/S9
//  tokens.
//

import SwiftUI

// MARK: - Loading (initial `/system/health` read)

/// The initial-read chrome — a skeleton banner that keeps the surface's shape (icon chip + title /
/// message lines + a dismiss-affordance shape) while the first health read is in flight.
struct MaintenanceBannerLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 160, height: 12)
                TSSkeleton(height: 10)
                TSSkeleton(width: 120, height: 10)
            }
            TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
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
        .accessibilityLabel(Text(verbatim: MaintenanceBannerStrings.string(
            "serviceMode.loadingA11y",
            "Checking service status"
        )))
    }
}

// MARK: - Empty (no active banner)

/// The empty render — a friendly card stating the service is operating normally, shown when `mode` is
/// `ok` or the current snapshot has been dismissed. The native improvement over the web component
/// rendering nothing (per the P4 leaf contract, the surface never collapses to a blank box).
struct MaintenanceBannerEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(MaintenanceBannerStrings.string(
                    "serviceMode.empty",
                    "All systems operational"
                )),
                message: LocalizedStringKey(MaintenanceBannerStrings.string(
                    "serviceMode.emptyMessage",
                    "No maintenance or degraded-service window is active right now."
                )),
                systemImage: "checkmark.circle"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (initial-read failure)

/// The initial-read-failure state — a compact error card with a retry affordance, shown only when no
/// health payload has resolved yet (a resolved payload always governs, so an active banner stays visible
/// through a background failure). The message is the runtime failure reason, rendered verbatim.
struct MaintenanceBannerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: MaintenanceBannerStrings.string(
                    "serviceMode.errorTitle",
                    "Couldn't load service status"
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
                    Text(verbatim: MaintenanceBannerStrings.string("serviceMode.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: MaintenanceBannerStrings.string("serviceMode.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
