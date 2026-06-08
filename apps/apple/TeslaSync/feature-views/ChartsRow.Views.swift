//
//  ChartsRow.Views.swift
//  TeslaSync — P4 feature view · 0099 · ChartsRow (Apple)
//
//  The presentational chrome composed by `ChartsRow` + its panels: the titled panel
//  shell (web `GlassPanel` + `section-title` with its lucide icon), the per-panel empty
//  state (web `EmptyState`), the freshness banner (stale / offline), the hard-error
//  state (web `QueryError`), and the loading skeleton. All consume pre-localized strings
//  from the P1/S10 facade + the shared P1/S9 tokens — no Tailwind ports.
//

import SwiftUI

// MARK: - Section title (web `section-title flex items-center gap-2` + lucide icon)

/// A small semibold section title with a leading tinted glyph (web `<h3 class=
/// "section-title …"><Icon/>{title}</h3>`), marked as an accessibility header.
struct ChartsRowSectionTitle: View {
    let title: String
    let systemImage: String
    let tint: Color

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Panel shell (web `<GlassPanel className="p-6">`)

/// One glass panel with a titled header and content (web `<GlassPanel>` with a
/// `section-title`). The panel never hides — content vs. empty is the caller's decision
/// inside `content`.
struct ChartsRowGlassPanel<Content: View>: View {
    let title: String
    let systemImage: String
    let tint: Color
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ChartsRowSectionTitle(title: title, systemImage: systemImage, tint: tint)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }
}

// MARK: - Empty state (web `<EmptyState message=…>`)

/// The per-panel empty state — a friendly, never-blank fallback shown when a panel's
/// source data is missing.
struct ChartsRowEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "chart.line.uptrend.xyaxis")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }
}

// MARK: - Freshness banner (native chrome for stale / offline)

/// The freshness banner shown above the panels when the feed is stale or offline.
/// Cached charts stay visible; the banner offers a manual refresh.
struct ChartsRowFreshnessBanner: View {
    let connection: ChartsRowConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("charging.charts.offlineBanner", "Offline — showing the last known charging charts")
            : ("charging.charts.staleBanner", "Reconnecting — charging charts may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            ChartsRowStrings.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                ChartsRowStrings.text("charging.charts.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChartsRowStrings.text("charging.charts.refresh", "Refresh"))
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

/// The hard-error state shown when the feed fails with nothing cached to render (web
/// `QueryError`): an icon, title, the technical message, and a retry action.
struct ChartsRowErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ChartsRowStrings.text("charging.charts.errorTitle", "Couldn't load charging charts")
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
                ChartsRowStrings.text("charging.charts.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChartsRowStrings.text("charging.charts.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: two redacted panels in the same responsive grid as
/// the loaded layout so the transition is stable.
struct ChartsRowSkeleton: View {
    var body: some View {
        LazyVGrid(columns: ChartsRow.gridColumns, alignment: .leading, spacing: TSSpacing.lg) {
            panelSkeleton
            panelSkeleton
        }
        .accessibilityElement()
        .accessibilityLabel(ChartsRowStrings.text("charging.charts.loading", "Loading charging charts"))
    }

    private var panelSkeleton: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 180, height: 14)
            TSChartSkeleton(height: 180)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }
}
