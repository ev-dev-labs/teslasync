//
//  SecurityStatusCards.Views.swift
//  TeslaSync — P4 feature view · 0046 · SecurityStatusCards (Apple)
//
//  The presentational subviews composed by `SecurityStatusCards`: the responsive
//  card grid + glass card tile (web `GlassPanel` cells), the loading skeleton grid
//  (web `Skeleton` blocks), the friendly empty hint, the QueryError-equivalent
//  failure state with retry, and the freshness chip + stale/offline banner. All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9 design
//  tokens — no networking, no Tailwind ports. Each card's semantic tone maps to a
//  `Color.TS` token here so the projection stays SwiftUI-free.
//

import SwiftUI

// MARK: - Tone → design-token color

extension SecurityCardsTone {
    /// The `Color.TS` token for the card's icon + value. `.homelink` is the web
    /// purple accent (no dedicated semantic token), drawn from the chart palette.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        case .neutral: Color.TS.textMuted
        case .homelink: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Responsive card grid (web `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)

/// The adaptive grid of security cards. `.adaptive(minimum:)` reproduces the web's
/// 1 / 2 / 3-column responsive breakpoints across iPhone, iPad, and Mac widths.
struct SecurityCardsGrid: View {
    let cards: [SecurityCardViewModel]

    private let columns = [
        GridItem(.adaptive(minimum: 220, maximum: 420), spacing: TSSpacing.lg, alignment: .top)
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(cards) { card in
                SecurityCardTile(card: card)
            }
        }
    }
}

// MARK: - Card tile (web `GlassPanel` cell)

/// One security card: a tinted SF Symbol + title, the bold tone-colored value, and
/// the muted description, on a glass panel. The whole tile is one VoiceOver element
/// reading the composed `title: value. detail` summary.
struct SecurityCardTile: View {
    let card: SecurityCardViewModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: card.systemImage)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(card.tone.color)
                        .accessibilityHidden(true)
                    Text(verbatim: card.title)
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                Text(verbatim: card.value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(card.tone.color)
                    .fixedSize(horizontal: false, vertical: true)
                Text(verbatim: card.detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: card.accessibilityLabel))
    }
}

// MARK: - Loading grid (web six `<Skeleton height={120} />`)

/// The in-flight skeleton grid: six redacted card-height blocks that respect Reduce
/// Motion via the shared `TSSkeleton`.
struct SecurityCardsLoadingGrid: View {
    private let columns = [
        GridItem(.adaptive(minimum: 220, maximum: 420), spacing: TSSpacing.lg, alignment: .top)
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 6, id: \.self) { _ in
                TSSkeleton(height: 116, cornerRadius: TSRadius.lg)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(SecurityCardsStrings.text("admin.security.cards.loadingA11y", "Loading security status"))
    }
}

// MARK: - Empty hint (resolved with no event)

/// The friendly hint shown under the fallback grid when the source resolved with no
/// security event, so the empty state never reads as a blank surface.
struct SecurityCardsEmptyHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            SecurityCardsStrings.text("admin.security.cards.empty", "No security telemetry yet")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` equivalent + retry)

/// The no-cached-data failure state (web `QueryError`): a danger glyph, the failure
/// title, the underlying message, and a retry affordance wired to the model.
struct SecurityCardsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                SecurityCardsStrings.text("admin.security.cards.errorTitle", "Couldn't load security status")
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(action: onRetry) {
                    SecurityCardsStrings.text("admin.security.cards.retry", "Retry")
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.vertical, TSSpacing.xs)
                        .background(Color.TS.accent.opacity(0.16), in: Capsule())
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(SecurityCardsStrings.text("admin.security.cards.retry", "Retry"))
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). Shown only
/// when the source is not live, so the normal grid stays as clean as the web source.
struct SecurityCardsFreshnessChip: View {
    let connection: SecurityCardsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SecurityCardsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SecurityCardsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SecurityCardsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "admin.security.cards.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "admin.security.cards.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "admin.security.cards.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the grid when the bound source is not
/// live, so the last-known cards are clearly labeled as cached.
struct SecurityCardsConnectivityBanner: View {
    let connection: SecurityCardsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.security.cards.offlineBanner" : "admin.security.cards.staleBanner"
        let fallback = offline
            ? "Offline — showing last known security status"
            : "Reconnecting — security status may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            SecurityCardsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
