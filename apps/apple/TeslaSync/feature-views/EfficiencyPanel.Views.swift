//
//  EfficiencyPanel.Views.swift
//  TeslaSync — P4 feature view · 0102 · EfficiencyPanel (Apple)
//
//  The presentational subviews composed by `EfficiencyPanel`: the titled header (the
//  Activity-icon section title + the hint / session-count caption + the freshness
//  chip), the responsive four-tile metric grid + tile (web inner `GlassPanel` cells),
//  the initial-fetch skeleton grid, the friendly empty hint, the QueryError-equivalent
//  failure state with retry, and the stale / offline banner. All consume pre-localized,
//  pre-formatted strings from the P1/S10 facade + the projection, and the shared P1/S9
//  design tokens — no networking, no Tailwind ports. Each tile's semantic accent maps
//  to a `Color.TS` token here so the projection stays SwiftUI-free.
//

import SwiftUI

// MARK: - Accent → design-token color

extension EfficiencyMetricAccent {
    /// The `Color.TS` token for the tile's value (web `text-cyan-300` /
    /// `text-emerald-300` / `text-rose-300` / `text-amber-300`, toned to the
    /// theme-adaptive semantic tokens).
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .emerald: Color.TS.statusSuccess
        case .rose: Color.TS.statusDanger
        case .amber: Color.TS.statusWarning
        }
    }
}

// MARK: - Header (web `h3.section-title` + hint span)

/// The panel header: the Activity glyph + the localized title, with the muted
/// "wall-to-battery energy conversion (N sessions with data)" hint beneath, and the
/// freshness chip trailing when the bound source is not live (so the live panel stays
/// as clean as the web source).
struct EfficiencyPanelHeader: View {
    let count: Int?
    let connection: EfficiencyPanelConnection

    private var hint: String {
        let base = EfficiencyPanelStrings.string(
            "charging.efficiency.hint",
            "Wall-to-battery energy conversion"
        )
        guard let count else { return base }
        let sessions = EfficiencyPanelStrings.string(
            "charging.efficiency.sessionsWithData",
            "sessions with data"
        )
        return "\(base) (\(count) \(sessions))"
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                EfficiencyPanelStrings.text("charging.efficiency.title", "Charging Efficiency")
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: hint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            if connection != .live {
                EfficiencyFreshnessChip(connection: connection)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Responsive grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`)

/// The adaptive grid of the four metric tiles. `.adaptive(minimum:)` reproduces the
/// web's 1 / 2 / 4-column responsive breakpoints across iPhone, iPad, and Mac widths.
struct EfficiencyMetricsGrid: View {
    let metrics: [EfficiencyMetricModel]

    private let columns = [
        GridItem(.adaptive(minimum: 150, maximum: 320), spacing: TSSpacing.md, alignment: .top)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(metrics) { metric in
                EfficiencyMetricTile(metric: metric)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Metric tile (web inner `GlassPanel.text-center` cell)

/// One metric tile: the bold accent-colored value, the muted label, and the footer
/// (the average tile's proportional bar, or the best / worst / wall-loss detail line),
/// centered on a glass surface. The whole tile is one VoiceOver element reading the
/// composed summary.
struct EfficiencyMetricTile: View {
    let metric: EfficiencyMetricModel

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: metric.value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(metric.accent.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: metric.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            footer
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: metric.accessibilityLabel))
    }

    @ViewBuilder
    private var footer: some View {
        switch metric.footer {
        case let .progress(fraction):
            TSMetricBar(fraction: fraction, tone: .accent)
                .frame(height: 6)
                .padding(.top, 2)
                .accessibilityHidden(true)
        case let .detail(text):
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

// MARK: - Loading grid (web shell skeleton)

/// The in-flight skeleton grid: four redacted tile-height blocks that respect Reduce
/// Motion via the shared `TSSkeleton`.
struct EfficiencyLoadingGrid: View {
    private let columns = [
        GridItem(.adaptive(minimum: 150, maximum: 320), spacing: TSSpacing.md, alignment: .top)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                TSSkeleton(height: 104, cornerRadius: TSRadius.lg)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            EfficiencyPanelStrings.text("charging.efficiency.loadingA11y", "Loading charging efficiency")
        )
    }
}

// MARK: - Empty hint (resolved with no efficiency data)

/// The friendly hint shown under the fallback tiles when the source resolved with no
/// efficiency data, so the empty state never reads as a blank surface.
struct EfficiencyEmptyHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.badge.clock")
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            EfficiencyPanelStrings.text(
                "charging.efficiency.empty",
                "No charging efficiency data yet"
            )
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
struct EfficiencyErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            EfficiencyPanelStrings.text(
                "charging.efficiency.errorTitle",
                "Couldn't load charging efficiency"
            )
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
                EfficiencyPanelStrings.text("charging.efficiency.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(EfficiencyPanelStrings.text("charging.efficiency.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). Shown only
/// when the source is not live, so the normal panel stays as clean as the web source.
struct EfficiencyFreshnessChip: View {
    let connection: EfficiencyPanelConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            EfficiencyPanelStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(EfficiencyPanelStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: EfficiencyPanelConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "charging.efficiency.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "charging.efficiency.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "charging.efficiency.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the tiles when the bound source is not live,
/// so the last-known panel is clearly labeled as cached.
struct EfficiencyConnectivityBanner: View {
    let connection: EfficiencyPanelConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.efficiency.offlineBanner" : "charging.efficiency.staleBanner"
        let fallback = offline
            ? "Offline — showing last known charging efficiency"
            : "Reconnecting — charging efficiency may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            EfficiencyPanelStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
