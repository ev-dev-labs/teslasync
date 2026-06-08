//
//  ChargingDetailSection.Views.swift
//  TeslaSync — P4 feature view · 0053 · ChargingDetailSection (Apple)
//
//  The presentational subviews composed by `ChargingDetailSection`: the panel
//  shell (web `GlassPanel` + `SectionTitle`), the per-panel empty state (web
//  `EmptyState`), the charger-brand leaderboard rows (web `brandLeaderboard`), the
//  cost-analysis cards (web `MetricCard`), the charger-type share bars (web
//  `chargerTypes.map`), the freshness banner (stale / offline), the hard-error
//  state (web `QueryError`), and the loading skeleton. All consume pre-localized
//  strings from the P1/S10 facade + the shared P1/S9 tokens — no Tailwind ports.
//

import SwiftUI

// MARK: - Panel shell (web `GlassPanel` + `SectionTitle`)

/// A small semibold section title (web `SectionTitle` — `text-sm font-semibold
/// text-[var(--text-primary)]`), marked as an accessibility header.
struct ChargingSectionTitle: View {
    let title: String

    var body: some View {
        Text(verbatim: title)
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// One glass panel with a title and content (web `<GlassPanel className="p-4">`
/// with a `SectionTitle` header). The panel never hides — content vs. empty is the
/// caller's decision inside `content`.
struct ChargingGlassPanel<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ChargingSectionTitle(title: title)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }
}

/// The per-panel empty state (web `EmptyState message=…`) — a friendly, never-blank
/// fallback shown when a panel's source data is missing.
struct ChargingEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "bolt.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 120)
    }
}

/// A horizontal proportion bar (web `<div className="h-N rounded-full …"><div
/// style={{ width: pct% }}/></div>`). The fraction is clamped to `0…1`.
struct ChargingProportionBar: View {
    let fraction: Double
    let color: Color
    var height: CGFloat = 8

    private var clamped: Double {
        Swift.min(Swift.max(fraction, 0), 1)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.25))
                Capsule().fill(color).frame(width: geo.size.width * clamped)
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

// MARK: - Freshness banner (native chrome for stale / offline)

/// The freshness banner shown above the panels when the feed is stale or offline.
/// Cached analytics stay visible; the banner offers a manual refresh.
struct ChargingFreshnessBanner: View {
    let connection: ChargingDetailConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("analytics.charging.detail.offlineBanner", "Offline — showing the last known charging analytics")
            : ("analytics.charging.detail.staleBanner", "Reconnecting — charging analytics may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            ChargingDetailStrings.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                ChargingDetailStrings.text("analytics.charging.detail.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargingDetailStrings.text("analytics.charging.detail.refresh", "Refresh"))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Hard-error state (web `QueryError`)

/// The hard-error state shown when the feed fails with nothing cached to render
/// (web `QueryError`): an icon, title, the technical message, and a retry action.
struct ChargingDetailErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ChargingDetailStrings.text("analytics.charging.detail.errorTitle", "Couldn't load charging analytics")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                onRetry()
            } label: {
                ChargingDetailStrings.text("analytics.charging.detail.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargingDetailStrings.text("analytics.charging.detail.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: four redacted panels matching the loaded
/// layout so the transition is stable.
struct ChargingDetailSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 4, id: \.self) { _ in
                panelSkeleton
            }
        }
        .accessibilityElement()
        .accessibilityLabel(ChargingDetailStrings.text(
            "analytics.charging.detail.loading",
            "Loading charging analytics"
        ))
    }

    private var panelSkeleton: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 160, height: 14)
            TSSkeleton(height: 10)
            TSSkeleton(height: 10)
            TSSkeleton(width: 220, height: 10)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }
}
