//
//  StatusHeader.Views.swift
//  TeslaSync — P4 feature view · 0028 · StatusHeader (Apple)
//
//  The presentational chrome composed by `StatusHeader`: the freshness chip, the stale/offline
//  connectivity banner, the three-up summary-card grid (the web `Grid` of `StatCard`s), the
//  per-card tile (label + muted icon row / prominent value / muted sublabel — the web `StatCard`
//  layout), the initial-fetch skeleton, the retryable error state, the resolved-but-empty hint,
//  and the `replay_enabled == false` warning banner (the web `AlertBanner variant="warning"`).
//  All consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Localization helper (SwiftUI Text over the P1/S10 facade)

extension StatusHeaderStrings {
    /// Resolves a key to a verbatim SwiftUI `Text` (the resolved value is already localized, so
    /// it must not be re-localized by `Text`'s `LocalizedStringKey` initializer).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct StatusHeaderFreshnessChip: View {
    let connection: StatusHeaderConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            StatusHeaderStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(StatusHeaderStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: StatusHeaderConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "admin.dlq.status.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "admin.dlq.status.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "admin.dlq.status.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the cards when the bound source is not live, so cached
/// counts are clearly labeled while reconnecting / offline.
struct StatusHeaderConnectivityBanner: View {
    let connection: StatusHeaderConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.dlq.status.offlineBanner" : "admin.dlq.status.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known DLQ summary"
            : "Reconnecting — the DLQ summary may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            StatusHeaderStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary card (web `StatCard`)

/// One summary card: the label + muted icon row, the prominent value, and the muted sublabel —
/// the web `<StatCard label value icon sublabel />`. The whole card is a single VoiceOver
/// element reading "{label}, {value}, {sublabel}".
struct StatusHeaderStatCard: View {
    let item: StatusHeaderCardItem

    private var resolvedValue: String {
        StatusHeaderAccessibility.resolvedValue(item.value, localize: StatusHeaderStrings.string)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                StatusHeaderStrings.text(item.labelKey, item.labelFallback)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: TSSpacing.xs)
                Image(systemName: item.systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            Text(verbatim: resolvedValue)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            StatusHeaderStrings.text(item.sublabelKey, item.sublabelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: StatusHeaderAccessibility.cardSummary(item, localize: StatusHeaderStrings.string))
        )
    }
}

// MARK: - Responsive grid (web `Grid cols={{ default: 1, sm: 3 }}`)

/// The responsive card grid. `.adaptive` columns reproduce the web breakpoints — one card on a
/// compact width, growing toward the full three on a regular/large width.
struct StatusHeaderGrid: View {
    let cards: [StatusHeaderCardItem]

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(cards) { card in
                StatusHeaderStatCard(item: card)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Skeleton (initial fetch)

/// One redacted skeleton card. Static bars (no shimmer) so it is reduce-motion-safe by
/// construction.
struct StatusHeaderSkeletonCard: View {
    private var bar: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                bar.frame(width: 88, height: 11)
                Spacer(minLength: TSSpacing.xs)
                bar.frame(width: 18, height: 18)
            }
            bar.frame(width: 64, height: 22)
            bar.frame(width: 120, height: 9)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// The initial-fetch skeleton grid (web `loading` `StatCard` redaction): three redacted cards in
/// the same responsive grid as the content.
struct StatusHeaderSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 3, id: \.self) { _ in
                StatusHeaderSkeletonCard()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(StatusHeaderStrings.text("admin.dlq.status.loading", "Loading DLQ summary"))
    }
}

// MARK: - Error state (web `QueryError`)

/// The fetch-failure state with a retry affordance (web `QueryError`). Surfaces the failure
/// message under the title when present.
struct StatusHeaderErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            StatusHeaderStrings.text("admin.dlq.status.errorTitle", "Couldn't load the DLQ summary")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                StatusHeaderStrings.text("admin.dlq.status.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(StatusHeaderStrings.text("admin.dlq.status.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty hint (resolved DLQ with no entries)

/// The "queue is empty" caption shown under the zero-count cards, so the resolved-but-empty
/// surface reads as intentional (and healthy) rather than blank.
struct StatusHeaderEmptyHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            StatusHeaderStrings.text(
                "admin.dlq.status.empty",
                "Dead-letter queue is empty — no failed ingests"
            )
            .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Disabled warning banner (web `AlertBanner variant="warning"`)

/// The persistent warning banner shown when `replay_enabled` is false (web
/// `{!loading && !enabled && <AlertBanner variant="warning" … />}`), so an operator immediately
/// sees that the replay action below will return HTTP 403 instead of publishing.
struct StatusHeaderDisabledBanner: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                StatusHeaderStrings.text("admin.dlq.banners.disabledTitle", "DLQ replay is disabled")
                    .font(Font.TS.label)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.statusWarning)
                StatusHeaderStrings.text(
                    "admin.dlq.banners.disabledMessage",
                    """
                    The DLQ_REPLAY_ENABLED env flag is not set on this server. \
                    Replay attempts will return HTTP 403 and be logged as result="disabled".
                    """
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusWarning)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusWarning.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
