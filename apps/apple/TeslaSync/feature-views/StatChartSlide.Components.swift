//
//  StatChartSlide.Components.swift
//  TeslaSync — P4 feature view · 0067 · StatChartSlide (Apple)
//
//  The Apple-idiomatic view pieces the slide composes: the SwiftUI i18n `text`
//  helper, the hero headline (web 🗓️ emoji spring-in + `AnimatedNumber` count-up +
//  "drives" label + average-per-week caption), the freshness chip, and the loading /
//  empty / error / offline states. All strings resolve through the P1/S10 facade and
//  all colors / spacing / motion come from the P1/S9 tokens. The bar chart lives in
//  `StatChartSlide.Chart.swift`.
//

import SwiftUI

// MARK: - Localization facade — SwiftUI `Text` (P1/S10)

extension StatChartSlideStrings {
    /// Resolves a key to a SwiftUI `Text` with the web English fallback (web
    /// `t(key, default)`); kept here so the Foundation-only facade in the model file
    /// stays SwiftUI-free for the adapter + accessibility seams.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Hero count-up (web `AnimatedNumber`, ease-out from zero)

/// The hero drive total, counting up from zero on appear — the native parity of the
/// web `AnimatedNumber` (a `requestAnimationFrame` ease-out-quad ramp). `Animatable`
/// drives the interpolation; the parent toggles the target value inside an `easeOut`
/// transaction. Under Reduce Motion the final value is shown immediately.
struct StatChartSlideAnimatedTotal: View, Animatable {
    var value: Double
    let localeIdentifier: String

    nonisolated var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    var body: some View {
        Text(verbatim: StatChartSlideFormat.integer(Int(value.rounded()), localeIdentifier: localeIdentifier))
            .font(Font.TS.display)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
    }
}

// MARK: - Hero headline (web emoji + number + label + caption)

/// The slide's hero block: the calendar emoji (web spring pop-in), the counting drive
/// total beside the localized "drives" label, and the average-per-week caption. The
/// entrance delays mirror the web `motion` timings (number 0.2s, caption 0.5s) and
/// honor Reduce Motion via `TSFadeIn` + the spring guard.
struct StatChartSlideHeadline: View {
    let projection: StatChartSlideProjection
    let localeIdentifier: String

    @State private var emojiShown = false
    @State private var counted = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            emoji
            TSFadeIn(delay: 0.2) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                    StatChartSlideAnimatedTotal(
                        value: counted ? Double(projection.totalDrives) : 0,
                        localeIdentifier: localeIdentifier
                    )
                    StatChartSlideStrings.text("yearReview.drives", "drives")
                        .font(Font.TS.section)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
            TSFadeIn(delay: 0.5) {
                Text(verbatim: projection.avgPerWeekText)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: StatChartSlideAccessibility.headlineSummary(for: projection)))
        .onAppear(perform: animateIn)
    }

    private var emoji: some View {
        Text(verbatim: "🗓️")
            .font(.system(size: 56))
            .scaleEffect(emojiShown ? 1 : 0.01)
            .accessibilityHidden(true)
    }

    private func animateIn() {
        if reduceMotion {
            emojiShown = true
            counted = true
            return
        }
        withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) { emojiShown = true }
        withAnimation(.easeOut(duration: 1.2)) { counted = true }
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// Corner chip flagging live / stale / offline data — the native chrome the
/// auto-refreshing P4 surface requires (the web leaf has none).
struct StatChartSlideFreshnessChip: View {
    let freshness: StatChartSlideFreshness

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
        case .live: StatChartSlideStrings.string("yearReview.statChart.live", "Live")
        case .stale: StatChartSlideStrings.string("yearReview.statChart.stale", "Stale")
        case .offline: StatChartSlideStrings.string("yearReview.statChart.offline", "Offline")
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

// MARK: - Retry affordance (web `QueryError` retry button)

/// Capsule retry button shared by the error + offline states.
struct StatChartSlideRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            StatChartSlideStrings.text("yearReview.statChart.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(StatChartSlideStrings.text("yearReview.statChart.retry", "Retry"))
    }
}

// MARK: - Loading skeleton (web initial fetch)

/// Skeleton chrome shown during the initial fetch (web `Skeleton`); its a11y label is
/// the friendly "loading your year in review" message.
struct StatChartSlideLoadingView: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            TSSkeleton(width: 56, height: 56, cornerRadius: TSRadius.md)
            TSSkeleton(width: 180, height: 40, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 220, height: 16, cornerRadius: TSRadius.sm)
            TSSkeleton(height: 180, cornerRadius: TSRadius.md)
                .frame(maxWidth: 480)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, TSSpacing.x2xl)
        .accessibilityElement()
        .accessibilityLabel(
            StatChartSlideStrings.text("yearReview.statChart.loading", "Loading your year in review…")
        )
    }
}

// MARK: - Empty state (web friendly empty — no recap yet)

/// The in-place empty state shown when the recap holds no drives at all.
struct StatChartSlideEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                StatChartSlideStrings.text("yearReview.statChart.empty.title", "No drives recorded yet")
            } icon: {
                Image(systemName: "calendar")
            }
        } description: {
            StatChartSlideStrings.text(
                "yearReview.statChart.empty.message",
                "Your yearly recap will appear here once you've taken a few drives."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error + offline states

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct StatChartSlideErrorView: View {
    let retryable: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            StatChartSlideStrings.text("yearReview.statChart.error", "Couldn't load your year in review")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if retryable {
                StatChartSlideRetryButton(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The offline-without-cache state with retry (web offline fallback).
struct StatChartSlideOfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
            StatChartSlideStrings.text(
                "yearReview.statChart.offlineMessage",
                "Offline — showing your last saved recap"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            StatChartSlideRetryButton(onRetry: onRetry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
