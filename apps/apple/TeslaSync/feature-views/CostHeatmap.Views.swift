//
//  CostHeatmap.Views.swift
//  TeslaSync — P4 feature view · 0100 · CostHeatmap (Apple)
//
//  The presentational subviews composed by `CostHeatmap`: the glass panel shell
//  (web `GlassPanel` + clock-titled header), the cheap→expensive legend (web legend
//  strip), the friendly empty state (web never-blank rule), the freshness banner
//  (stale / offline), the hard-error state (web `QueryError`), and the loading
//  skeleton. All consume pre-localized strings from the P1/S10 facade + the shared
//  P1/S9 tokens — no Tailwind ports. The heatmap canvas itself lives in
//  CostHeatmap.Grid.swift.
//

import SwiftUI

// MARK: - Panel (web `<GlassPanel className="p-6">` + clock header + grid + legend)

/// The heatmap panel. Always renders its header; the body is the grid + legend, or
/// the friendly empty state when no sessions are recorded (the panel never hides).
struct CostHeatmapPanel: View {
    let model: CostHeatmapModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            if model.isEmpty {
                CostHeatmapEmptyState(
                    message: model.localize(
                        "charging.optimizer.heatmap.empty",
                        "No charging sessions recorded yet"
                    )
                )
            } else {
                CostHeatmapCanvas(
                    cells: model.cells,
                    dayLabels: model.dayLabels,
                    hourLabels: model.labelledHours
                )
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
                CostHeatmapLegend(swatches: model.legendSwatches, localize: model.localize)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }

    /// The clock-icon title (web `<Clock className="text-neon-purple" /> {t(...)}`).
    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "clock")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.chartSeriesPower)
                .accessibilityHidden(true)
            CostHeatmapStrings.text("charging.optimizer.heatmap", "Charging Cost Heatmap")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Legend (web Cheap → gradient → Expensive strip)

/// The cheap→expensive colour legend, right-aligned like the web (`justify-end`):
/// a "Cheap" label, five gradient swatches, and an "Expensive" label.
struct CostHeatmapLegend: View {
    let swatches: [CostHeatmapColor]
    let localize: (String, String) -> String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            Text(verbatim: localize("charging.optimizer.cheap", "Cheap"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: 2) {
                ForEach(Array(swatches.enumerated()), id: \.offset) { _, swatch in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(swatch.swiftUIColor)
                        .frame(width: 14, height: 14)
                }
            }
            Text(verbatim: localize("charging.optimizer.expensive", "Expensive"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: localize("charging.optimizer.heatmap.legend", "Cost scale from cheap to expensive"))
        )
    }
}

// MARK: - Empty state (web never-blank rule)

/// The friendly empty state shown when no sessions are recorded — never a blank box.
struct CostHeatmapEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "calendar.badge.clock")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 140)
    }
}

// MARK: - Freshness banner (native chrome for stale / offline)

/// The freshness banner shown above the panel when the feed is stale or offline.
/// Cached data stays visible; the banner offers a manual refresh.
struct CostHeatmapFreshnessBanner: View {
    let connection: CostHeatmapConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("charging.optimizer.heatmap.offlineBanner", "Offline — showing the last known cost heatmap")
            : ("charging.optimizer.heatmap.staleBanner", "Reconnecting — cost heatmap may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            CostHeatmapStrings.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                CostHeatmapStrings.text("charging.optimizer.heatmap.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CostHeatmapStrings.text("charging.optimizer.heatmap.refresh", "Refresh"))
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
struct CostHeatmapErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CostHeatmapStrings.text("charging.optimizer.heatmap.errorTitle", "Couldn't load the cost heatmap")
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
                CostHeatmapStrings.text("charging.optimizer.heatmap.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CostHeatmapStrings.text("charging.optimizer.heatmap.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: a redacted title, grid block, and legend line
/// matching the loaded layout so the transition is stable.
struct CostHeatmapSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSSkeleton(width: 180, height: 14)
            TSSkeleton(height: 150, cornerRadius: TSRadius.md)
            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSSkeleton(width: 200, height: 12)
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement()
        .accessibilityLabel(
            CostHeatmapStrings.text("charging.optimizer.heatmap.loading", "Loading charging cost heatmap")
        )
    }
}
