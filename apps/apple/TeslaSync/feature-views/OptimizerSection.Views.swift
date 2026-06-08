//
//  OptimizerSection.Views.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  The presentational subviews composed by `OptimizerSection`: the panel shell (web
//  `GlassPanel` + titled header), the per-panel empty state (web `EmptyState`), the
//  savings banner (web success `AlertBanner`), the freshness banner (stale /
//  offline), the hard-error state (web `QueryError`), the loading skeleton, the
//  Charging Habits rows, the Battery-Friendly Score gauge (web `RadialGauge`), the
//  Cost Analysis rows, and the Recommendations list/rows. All consume pre-localized
//  strings from the P1/S10 facade + the shared P1/S9 tokens — no Tailwind ports.
//

import SwiftUI

// MARK: - Panel shell (web `GlassPanel` + titled header)

/// A titled panel header (web `<h3 class="text-sm font-semibold text-white">` with a
/// tinted leading glyph), marked as an accessibility header.
struct OptimizerPanelHeader: View {
    let systemImage: String
    let tint: Color
    let title: String

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
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(.isHeader)
    }
}

/// One glass panel with a titled header and content (web `<GlassPanel class="p-6">`).
/// The panel never hides — content vs. empty is the caller's decision inside
/// `content`.
struct OptimizerGlassPanel<Content: View>: View {
    let systemImage: String
    let tint: Color
    let title: String
    var alignment: HorizontalAlignment = .leading
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: alignment, spacing: TSSpacing.md) {
            OptimizerPanelHeader(systemImage: systemImage, tint: tint, title: title)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }
}

/// The per-panel empty state (web `EmptyState message=…`) — a friendly, never-blank
/// fallback shown when a panel's source data is missing.
struct OptimizerEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "bolt.badge.clock")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 120)
    }
}

// MARK: - Key/value row (web habit / cost rows)

/// One "label … value" row (web `flex items-center justify-between text-xs`): a muted
/// label and a trailing tinted value.
struct OptimizerStatRow: View {
    let label: String
    let value: String
    var valueTint: Color = .TS.textPrimary
    var monospaced: Bool = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            valueText
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(label) \(value)"))
    }

    @ViewBuilder
    private var valueText: some View {
        let base = Text(verbatim: value)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(valueTint)
        if monospaced {
            base.monospacedDigit().multilineTextAlignment(.trailing)
        } else {
            base.multilineTextAlignment(.trailing)
        }
    }
}

// MARK: - Savings banner (web success `AlertBanner`)

/// The savings banner (web `<AlertBanner variant="success">`): a success-tinted card
/// with a dollar glyph, an interpolated title, and a detail line. Shown only when the
/// model reports potential savings above the web threshold.
struct OptimizerSavingsBanner: View {
    let title: String
    let detail: String

    private var tone: Color {
        Color.TS.statusSuccess
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "dollarsign.circle.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness banner (native chrome for stale / offline)

/// The freshness banner shown above the content when the feed is stale or offline.
/// Cached optimizer data stays visible; the banner offers a manual refresh.
struct OptimizerFreshnessBanner: View {
    let connection: OptimizerConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("charging.optimizer.offlineBanner", "Offline — showing the last known optimization")
            : ("charging.optimizer.staleBanner", "Reconnecting — optimization may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            OptimizerSection.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                OptimizerSection.text("charging.optimizer.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(OptimizerSection.text("charging.optimizer.refresh", "Refresh"))
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
struct OptimizerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            OptimizerSection.text("charging.optimizer.errorTitle", "Couldn't load optimization")
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
                OptimizerSection.text("charging.optimizer.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(OptimizerSection.text("charging.optimizer.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: a stat panel, a gauge panel, and a
/// recommendations panel redacted to match the loaded layout so the transition is
/// stable.
struct OptimizerSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                panelSkeleton
                panelSkeleton
            }
            recommendationsSkeleton
        }
        .accessibilityElement()
        .accessibilityLabel(OptimizerSection.text("charging.optimizer.loading", "Loading optimization"))
    }

    private var panelSkeleton: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 150, height: 14)
            TSSkeleton(height: 10)
            TSSkeleton(height: 10)
            TSSkeleton(width: 180, height: 10)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }

    private var recommendationsSkeleton: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 200, height: 14)
            TSSkeleton(height: 44)
            TSSkeleton(height: 44)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }
}
