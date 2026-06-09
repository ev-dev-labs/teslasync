//
//  ChargingBreakdownSlide.Components.swift
//  TeslaSync — P4 feature view · 0061 · ChargingBreakdownSlide (Apple)
//
//  The Apple-idiomatic view pieces the slide composes: the SwiftUI i18n `text`
//  helper, the hero (web 🔌 emoji spring-in + "{sessions} charge sessions" +
//  average-plug-in-SOC caption), the legend row, the freshness chip, and the
//  loading / empty / error / offline states. All strings resolve through the P1/S10
//  facade and all colors / spacing / motion come from the P1/S9 tokens. The donut
//  lives in `ChargingBreakdownSlide.Chart.swift`.
//

import SwiftUI

// MARK: - Localization facade — SwiftUI `Text` (P1/S10)

extension ChargingBreakdownSlideStrings {
    /// Resolves a key to a SwiftUI `Text` with the web English fallback (web
    /// `t(key, default)`); kept here so the Foundation-only facade in the model file
    /// stays SwiftUI-free for the adapter + accessibility seams.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Hero (web 🔌 emoji + sessions count + SOC caption)

/// The slide's hero block: the plug emoji (web spring pop-in), the charge-session
/// count beside the localized "charge sessions" label, and the average-plug-in-SOC
/// caption. The entrance delays mirror the web `motion` timings (count 0.2s, caption
/// 0.4s) and honor Reduce Motion via `TSFadeIn` + the spring guard. Spoken as one
/// combined VoiceOver element.
struct ChargingBreakdownSlideHero: View {
    let projection: ChargingBreakdownSlideProjection

    @State private var emojiShown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var sessionsWord: String {
        ChargingBreakdownSlideStrings.string("yearReview.chargeSessions", "charge sessions")
    }

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            emoji
            TSFadeIn(delay: 0.2) {
                Text(verbatim: "\(projection.chargeSessionsText) \(sessionsWord)")
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
            }
            TSFadeIn(delay: 0.4) {
                Text(verbatim: projection.avgStartSocText)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ChargingBreakdownSlideAccessibility.heroSummary(for: projection)))
        .onAppear(perform: animateIn)
    }

    private var emoji: some View {
        Text(verbatim: "🔌")
            .font(.system(size: 52))
            .scaleEffect(emojiShown ? 1 : 0.01)
            .accessibilityHidden(true)
    }

    private func animateIn() {
        if reduceMotion {
            emojiShown = true
            return
        }
        withAnimation(.spring(response: 0.4, dampingFraction: 0.55)) { emojiShown = true }
    }
}

// MARK: - Legend row (web `flex gap-6` of dot + "name (pct%)")

/// The colored legend beneath the donut (web legend row). Hidden from VoiceOver —
/// the donut speaks the full share list, so the chips are decorative there.
struct ChargingBreakdownSlideLegend: View {
    let slices: [ChargingBreakdownSlice]

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(slices) { slice in
                ChargingBreakdownLegendChip(slice: slice)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// Corner chip flagging live / stale / offline data — the native chrome the
/// auto-refreshing P4 surface requires (the web leaf has none).
struct ChargingBreakdownSlideFreshnessChip: View {
    let freshness: ChargingBreakdownSlideFreshness

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
        case .live: ChargingBreakdownSlideStrings.string("yearReview.chargingBreakdown.live", "Live")
        case .stale: ChargingBreakdownSlideStrings.string("yearReview.chargingBreakdown.stale", "Stale")
        case .offline: ChargingBreakdownSlideStrings.string("yearReview.chargingBreakdown.offline", "Offline")
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
struct ChargingBreakdownSlideRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            ChargingBreakdownSlideStrings.text("yearReview.chargingBreakdown.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ChargingBreakdownSlideStrings.text("yearReview.chargingBreakdown.retry", "Retry"))
    }
}

// MARK: - Loading skeleton (web initial fetch)

/// Skeleton chrome shown during the initial fetch (web `Skeleton`); its a11y label is
/// the friendly "loading your charging breakdown" message.
struct ChargingBreakdownSlideLoadingView: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            TSSkeleton(width: 52, height: 52, cornerRadius: TSRadius.md)
            TSSkeleton(width: 200, height: 28, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 220, height: 16, cornerRadius: TSRadius.sm)
            Circle()
                .strokeBorder(Color.TS.border.opacity(0.3), lineWidth: 30)
                .frame(width: 200, height: 200)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, TSSpacing.x2xl)
        .accessibilityElement()
        .accessibilityLabel(
            ChargingBreakdownSlideStrings.text(
                "yearReview.chargingBreakdown.loading",
                "Loading your charging breakdown…"
            )
        )
    }
}

// MARK: - Empty state (web friendly empty — no charging yet)

/// The in-place empty state shown when the recap holds no charging at all.
struct ChargingBreakdownSlideEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ChargingBreakdownSlideStrings.text(
                    "yearReview.chargingBreakdown.empty.title",
                    "No charging recorded yet"
                )
            } icon: {
                Image(systemName: "bolt.car")
            }
        } description: {
            ChargingBreakdownSlideStrings.text(
                "yearReview.chargingBreakdown.empty.message",
                "Your charging breakdown will appear here once you've plugged in a few times."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error + offline states

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct ChargingBreakdownSlideErrorView: View {
    let retryable: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargingBreakdownSlideStrings.text(
                "yearReview.chargingBreakdown.error",
                "Couldn't load your charging breakdown"
            )
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if retryable {
                ChargingBreakdownSlideRetryButton(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The offline-without-cache state with retry (web offline fallback).
struct ChargingBreakdownSlideOfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
            ChargingBreakdownSlideStrings.text(
                "yearReview.chargingBreakdown.offlineMessage",
                "Offline — showing your last saved charging breakdown"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            ChargingBreakdownSlideRetryButton(onRetry: onRetry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
