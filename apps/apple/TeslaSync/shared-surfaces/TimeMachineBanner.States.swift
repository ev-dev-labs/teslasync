//
//  TimeMachineBanner.States.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `TimeMachineBanner` when the surface is not showing the
//  active banner: the loading skeleton (the banner shape as shimmer), the empty card (the native parity
//  of the web `if (effective == null && !pickerOpen) return null` — rendered as a calm "viewing live
//  data" card with a "Pick a date" affordance instead of a blank box), and the error tile with a retry
//  affordance. All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (the initial as-of resolution in flight)

/// The initial-resolution chrome — a skeleton that keeps the surface's shape (an icon + two text lines
/// + a control) while the as-of feed resolves. Brief in production (the read is fast), but a real,
/// rendered state before the first emission.
struct TimeMachineLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 200, height: 12)
                TSSkeleton(height: 12)
            }
            Spacer(minLength: 0)
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
        .accessibilityLabel(Text(verbatim: TimeMachineBannerStrings.string(
            "timeMachine.loadingA11y", "Loading the historical viewer"
        )))
    }
}

// MARK: - Empty (web `if (effective == null && !pickerOpen) return null`)

/// The empty render — a friendly card, the native parity of the web banner returning `null` in live
/// mode with the picker closed, improved to never collapse to a blank box (P4 leaf contract). The copy
/// confirms the live view and offers a "Pick a date" affordance (the native parity of the web command
/// palette opening the picker) so the user can enter time-machine mode.
struct TimeMachineEmptyView: View {
    let onPick: () -> Void

    private var pickLabel: String {
        TimeMachineBannerStrings.string(TimeMachineCopy.pickKey, TimeMachineCopy.pickFallback)
    }

    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(TimeMachineBannerStrings.string(
                    "timeMachine.empty.title", "You're viewing live data"
                )),
                message: LocalizedStringKey(TimeMachineBannerStrings.string(
                    "timeMachine.empty.message",
                    "Pick a point in time to review a historical snapshot of your fleet."
                )),
                systemImage: "clock.arrow.circlepath"
            ) {
                TSButton(variant: .secondary, size: .small, action: onPick) {
                    Text(verbatim: pickLabel)
                }
                .accessibilityLabel(Text(verbatim: pickLabel))
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct TimeMachineErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: TimeMachineBannerStrings.string(
                    "timeMachine.errorTitle", "Couldn't load the historical viewer"
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
                    Text(verbatim: TimeMachineBannerStrings.string("timeMachine.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: TimeMachineBannerStrings.string(
                    "timeMachine.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
