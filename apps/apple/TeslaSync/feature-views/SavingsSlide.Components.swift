//
//  SavingsSlide.Components.swift
//  TeslaSync — P4 feature view · 0065 · SavingsSlide (Apple)
//
//  The Apple-idiomatic view pieces the surface composes: the spring-scaled emoji
//  (web `motion.span`), the count-up hero amount (web `AnimatedNumber`), the
//  gas-vs-electric comparison bars, the cups-of-coffee note, the freshness +
//  refresh accessory, and the empty / error / offline / loading states (web
//  `EmptyState` / `QueryError`). All strings resolve through the P1/S10 facade;
//  all colors/spacing come from the P1/S9 tokens. The assembled content lives in
//  `SavingsSlide.Content.swift`.
//

import SwiftUI

// MARK: - Emoji header (web `motion.span` spring scale/rotate-in)

/// The 💰 hero glyph, springing in like the web `motion.span` (scale 0→1,
/// rotate −15°→0). Static under Reduce Motion; carries a VoiceOver label since
/// the raw emoji reads poorly.
struct SavingsEmoji: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        Text(verbatim: "💰")
            .font(.system(size: 60))
            .scaleEffect(shown ? 1 : 0)
            .rotationEffect(.degrees(shown ? 0 : -15))
            .onAppear {
                if reduceMotion {
                    shown = true
                } else {
                    withAnimation(.spring(response: 0.45, dampingFraction: 0.55)) { shown = true }
                }
            }
            .accessibilityLabel(SavingsSlideStrings.text("savings.emojiLabel", "Money bag"))
    }
}

// MARK: - Hero amount (web `AnimatedNumber value={gas_savings} prefix="$">)

/// One animation frame of the hero amount. `Animatable` so SwiftUI interpolates
/// `amount` from 0 to the target during the count-up; the string is re-derived
/// each frame through the same grouped formatter the projection uses.
private struct SavingsAmountText: View, @MainActor Animatable {
    var amount: Double
    let locale: Locale

    var animatableData: Double {
        get { amount }
        set { amount = newValue }
    }

    var body: some View {
        Text(verbatim: SavingsSlideProjection.heroCurrency(amount, locale: locale))
            .font(.system(size: 60, weight: .bold))
            .monospacedDigit()
            .minimumScaleFactor(0.5)
            .lineLimit(1)
            .foregroundStyle(Color.TS.statusSuccess)
    }
}

/// The count-up hero (web `AnimatedNumber` ease-out over 1.5s). Counts 0→target
/// on appear; jumps straight to the target under Reduce Motion. Hidden from
/// VoiceOver — the content view exposes the final value in its combined label.
struct SavingsAnimatedAmount: View {
    let target: Double
    var locale: Locale = .current
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        SavingsAmountText(amount: shown ? target : 0, locale: locale)
            .onAppear {
                if reduceMotion {
                    shown = true
                } else {
                    withAnimation(.easeOut(duration: 1.5)) { shown = true }
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Comparison bar (web gas/electric rows)

/// One labeled proportion bar (web gas/electric comparison row): an icon + label
/// on the left, the rounded dollar amount on the right, and a tinted fill below.
struct SavingsComparisonBar: View {
    let systemImage: String
    let tint: Color
    let label: Text
    let valueText: String
    let fraction: Double

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 13))
                    .foregroundStyle(tint.opacity(0.7))
                    .accessibilityHidden(true)
                label
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: valueText)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(tint)
            }
            track
        }
        .accessibilityElement(children: .ignore)
    }

    private var track: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.4))
                Capsule()
                    .fill(tint.opacity(0.6))
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 8)
    }
}

// MARK: - Cups-of-coffee note (web `DollarSign` + savingsNote)

/// The closing savings note (web `DollarSign` + `yearReview.savingsNote`).
struct SavingsCoffeeNote: View {
    let note: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "dollarsign.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            Text(verbatim: note)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusSuccess.opacity(0.85))
                .multilineTextAlignment(.center)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip + status accessory (live / stale / offline)

/// Header chip flagging live / stale / offline data (web freshness indicator).
struct SavingsFreshnessChip: View {
    let freshness: SavingsSlideFreshness

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: SavingsSlideStrings.string("savings.live", "Live")
        case .stale: SavingsSlideStrings.string("savings.stale", "Stale")
        case .offline: SavingsSlideStrings.string("savings.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// Freshness chip + an in-flight spinner + a refresh control (web refetch).
struct SavingsStatusAccessory: View {
    let freshness: SavingsSlideFreshness
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            SavingsFreshnessChip(freshness: freshness)
            if refreshing {
                ProgressView().controlSize(.mini)
            }
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(SavingsSlideStrings.text("savings.refresh", "Refresh"))
        }
    }
}

// MARK: - Retry affordance (web `QueryError` retry button)

/// Capsule retry button shared by the error + offline states.
struct SavingsRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            SavingsSlideStrings.text("savings.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SavingsSlideStrings.text("savings.retry", "Retry"))
    }
}

// MARK: - Empty / error / offline / loading states

/// The friendly empty state (web `EmptyState`) — a resolved review with nothing
/// to celebrate yet, never a blank slide.
struct SavingsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SavingsSlideStrings.text("savings.empty.title", "No savings yet")
            } icon: {
                Image(systemName: "bag")
            }
        } description: {
            SavingsSlideStrings.text(
                "savings.empty.message",
                "Once you've driven and charged, your gas-vs-electric savings will appear here."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct SavingsErrorView: View {
    let retryable: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SavingsSlideStrings.text("savings.errorTitle", "Couldn't load your savings")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if retryable {
                SavingsRetryButton(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The offline-without-cache state (web offline fallback) with retry.
struct SavingsOfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
            SavingsSlideStrings.text("savings.offlineMessage", "Offline — showing your last known savings")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            SavingsRetryButton(onRetry: onRetry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// Skeleton chrome shown during the initial fetch (web `Skeleton`), echoing the
/// slide layout (emoji dot · hero bar · two comparison bars). Its a11y label is
/// the web-style "Tallying your savings…".
struct SavingsLoadingView: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            TSSkeleton(width: 64, height: 64, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 200, height: 48, cornerRadius: TSRadius.md)
            VStack(spacing: TSSpacing.sm) {
                TSSkeleton(height: 10)
                TSSkeleton(height: 10)
            }
            .frame(maxWidth: 240)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(SavingsSlideStrings.text("savings.loading", "Tallying your savings…"))
    }
}
