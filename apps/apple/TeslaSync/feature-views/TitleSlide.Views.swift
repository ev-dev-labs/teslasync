//
//  TitleSlide.Views.swift
//  TeslaSync — P4 feature view · 0070 · TitleSlide (Apple)
//
//  The presentational building blocks of the TitleSlide surface: the animated hero (web emoji +
//  `AnimatedNumber` year + title + vehicle name), the freshness chip + connectivity banner (ADR-013
//  live-state chrome), and the loading / empty / error sub-states. All are driven by the projected
//  `TitleSlideProjection` + the model's freshness; none of them fetch. Motion honors Reduce Motion
//  and every state carries an accessibility label.
//

import SwiftUI

// MARK: - Hero glyph (web animated 🚗)

/// The decorative recap glyph. Mirrors the web `motion.div` that scales the 🚗 emoji in from 0.5×
/// while fading up. Static under Reduce Motion. Accessibility-hidden because the combined hero label
/// already speaks the recap; the emoji would otherwise be read as "automobile".
struct TitleSlideHeroGlyph: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        Text(verbatim: "🚗")
            .font(.system(size: 72))
            .scaleEffect(shown ? 1 : 0.5)
            .opacity(shown ? 1 : 0)
            .onAppear {
                if reduceMotion {
                    shown = true
                } else {
                    withAnimation(.easeOut(duration: TSMotion.slowDuration)) { shown = true }
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Hero composition (web slide body)

/// The centered hero: glyph over the animated year (web `AnimatedNumber`), the "Year in Review"
/// subtitle, and the vehicle name. The three text lines fade/lift in on a stagger that mirrors the
/// web `motion.*` delays (0.3 / 0.5 / 0.7s) via `TSFadeIn`, which collapses to an instant appearance
/// under Reduce Motion. The whole hero is a single VoiceOver element.
struct TitleSlideHero: View {
    let projection: TitleSlideProjection

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TitleSlideHeroGlyph()
            TSFadeIn(delay: 0.3) {
                TSAnimatedNumber(formatted: projection.yearText)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            TSFadeIn(delay: 0.5) {
                TitleSlideStrings.text("yearReview.title", "Year in Review")
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSFadeIn(delay: 0.7) {
                Text(verbatim: projection.vehicleName)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, TSSpacing.x2xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: heroLabel))
    }

    private var heroLabel: String {
        TitleSlideAccessibility.summary(for: projection, localize: TitleSlideStrings.string)
    }
}

// MARK: - Freshness chip (ADR-013 live-state)

/// The live/stale/offline freshness chip shown in the slide header. A colored dot + status word,
/// with an optional relative "updated …" stamp. Mirrors the web `DataFreshness` chip.
struct TitleSlideFreshnessChip: View {
    let connection: TitleSlideConnection
    let isFetching: Bool
    let updatedAt: Date?

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var label: String {
        if isFetching { return TitleSlideStrings.string("titleSlide.updating", "Updating") }
        switch connection {
        case .live: return TitleSlideStrings.string("titleSlide.live", "Live")
        case .stale: return TitleSlideStrings.string("titleSlide.stale", "Stale")
        case .offline: return TitleSlideStrings.string("titleSlide.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (cached-data notice)

/// The inline cached-data banner shown above the hero whenever the connection is not live, so a
/// stale or offline recap is clearly labeled. Mirrors the web story shell's reconnecting / offline
/// notice.
struct TitleSlideConnectivityBanner: View {
    let connection: TitleSlideConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            TitleSlideStrings.text(bannerKey, bannerFallback)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var isOffline: Bool {
        connection == .offline
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var bannerKey: String {
        isOffline ? "titleSlide.offlineBanner" : "titleSlide.staleBanner"
    }

    private var bannerFallback: String {
        isOffline ? "Offline — showing last known recap" : "Reconnecting — recap may be stale"
    }
}

// MARK: - Loading chrome

/// The initial-fetch skeleton: a redacted hero (glyph + year + subtitle + vehicle) that respects
/// Reduce Motion via `TSSkeleton`. Carries a single "Loading …" accessibility label.
struct TitleSlideLoadingChrome: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 72, height: 72, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 140, height: 30, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 120, height: 14)
            TSSkeleton(width: 90, height: 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(TitleSlideStrings.text("titleSlide.loading", "Loading year in review"))
    }
}

// MARK: - Empty state

/// The friendly empty state shown when the recap resolved with no data. Uses
/// `ContentUnavailableView` so it is never a blank box.
struct TitleSlideEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TitleSlideStrings.text("titleSlide.noData", "No year-in-review data")
            } icon: {
                Image(systemName: "calendar")
            }
        } description: {
            TitleSlideStrings.text(
                "titleSlide.emptyHint",
                "Drive through the year to build up your recap."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error state

/// The fetch-failure state with a retry affordance (web `QueryError`). Shows the failure detail when
/// present and a single combined accessibility element.
struct TitleSlideErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TitleSlideStrings.text("titleSlide.errorTitle", "Couldn't load year in review")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                TitleSlideStrings.text("titleSlide.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TitleSlideStrings.text("titleSlide.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
