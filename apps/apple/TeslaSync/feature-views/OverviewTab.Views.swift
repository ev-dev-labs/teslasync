//
//  OverviewTab.Views.swift
//  TeslaSync — P4 feature view · 0059 · OverviewTab (Apple)
//
//  The presentational chrome composed by `OverviewTab`: the glass section panel (web
//  `GlassPanel` + `SectionTitle`), the three Swift Charts (Distance by Vehicle bars; the
//  Day-of-Week bars+line and the Monthly-Cost grouped-bars+line composed charts, each with a
//  Recharts-style dual axis via `OverviewAxisScale`), the custom color-dot legend, the
//  freshness chip + stale/offline banner, the per-chart empty row, the initial-load skeleton,
//  the `QueryError`-equivalent error state, and the Quick Links launcher grid. All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no networking,
//  no Tailwind ports.
//

import Charts
import SwiftUI

// MARK: - Section panel (web `GlassPanel` + `SectionTitle`)

/// A glass card with a localized section title above its content (web `GlassPanel` wrapping a
/// `SectionTitle`). Always renders — empties live inside, never by hiding the panel.
struct OverviewPanel<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            OverviewStrings.text(titleKey, titleFallback)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct OverviewFreshnessChip: View {
    let connection: OverviewConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            OverviewStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(OverviewStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: OverviewConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "analytics.overview.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "analytics.overview.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "analytics.overview.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the charts when the bound source is not live, so
/// cached charts are clearly labeled while reconnecting / offline.
struct OverviewConnectivityBanner: View {
    let connection: OverviewConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "analytics.overview.offlineBanner" : "analytics.overview.staleBanner"
        let fallback = offline
            ? "Offline — showing last loaded analytics"
            : "Reconnecting — analytics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            OverviewStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Per-chart empty row (web `EmptyState`)

/// A centered, muted "No …" empty row shown inside a panel when a chart has no rows (web
/// `<EmptyState message={…} />`). Never hides the panel.
struct OverviewEmptyRow: View {
    let key: String
    let fallback: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.xyaxis.line")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            OverviewStrings.text(key, fallback)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .accessibilityLabel(OverviewStrings.text(key, fallback))
    }
}

// MARK: - Quick Links (web `<Link>` cards)

/// One Quick Links card: a tinted SF Symbol + localized label + chevron, routing through the
/// model's navigation seam (web `<Link to={href}>`).
struct OverviewQuickLinkCard: View {
    let link: OverviewQuickLink
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: link.systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 32, height: 32)
                    .background(Color.TS.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
                OverviewStrings.text(link.labelKey, link.labelFallback)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(OverviewStrings.text(link.labelKey, link.labelFallback))
        .accessibilityAddTraits(.isLink)
    }
}

// MARK: - Initial-load skeleton (web `<Skeleton>`)

/// The initial-fetch skeleton chrome shown before any cached charts exist, respecting Reduce
/// Motion through `TSSkeleton`.
struct OverviewLoadingChrome: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            ForEach(0 ..< 3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSSkeleton(width: 180, height: 14)
                    TSSkeleton(height: 220, cornerRadius: TSRadius.md)
                }
                .padding(TSSpacing.lg)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
            }
        }
        .accessibilityElement()
        .accessibilityLabel(OverviewStrings.text("analytics.overview.loading", "Loading analytics"))
    }
}

// MARK: - Error state (web `QueryError`)

/// The surface-level failure state with a retry affordance (web `QueryError`), shown only
/// when the query failed with no cached charts to display.
struct OverviewErrorState: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            OverviewStrings.text("analytics.overview.errorTitle", "Couldn't load analytics")
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
            Button(action: retry) {
                OverviewStrings.text("analytics.overview.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(OverviewStrings.text("analytics.overview.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 280)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
