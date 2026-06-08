//
//  ChargerTypeBreakdown.Views.swift
//  TeslaSync — P4 feature view · 0108 · ChargerTypeBreakdown (Apple)
//
//  The presentational subviews composed by `ChargerTypeBreakdown`: the panel shell
//  (web `GlassPanel`), the titled header with the bolt glyph (web `Zap`), the
//  per-type breakdown rows (web `data.map` — name · cost · sessions, a proportion
//  bar, the kWh / $-per-kWh / percent footer), the color legend (web `Legend`
//  dots), the "Not enough data" empty state (web `charts.noData`), the freshness
//  banner (stale / offline), the hard-error state (web `QueryError`), and the
//  loading skeleton. All consume pre-localized strings from the P1/S10 facade +
//  the shared P1/S9 tokens — no Tailwind ports.
//

import SwiftUI

// MARK: - Panel shell + titled header (web `GlassPanel` + Zap title)

/// The titled header (web `<h3>` with a yellow `Zap` icon + "Cost by Charger
/// Type"), marked as an accessibility header.
struct ChargerTypeSectionTitle: View {
    let title: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityAddTraits(.isHeader)
    }
}

/// One glass panel with the titled header and content (web `<GlassPanel
/// className="p-4">`). The panel never hides — content vs. the empty state is the
/// caller's decision inside `content`.
struct ChargerTypeGlassPanel<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ChargerTypeSectionTitle(title: title)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }
}

/// The "Not enough data" empty state (web `charts.noData`) — a friendly,
/// never-blank fallback shown when there are no charger-type rows.
struct ChargerTypeEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "bolt.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Proportion bar (web `<div style={{ width: pct% }}/>`)

/// A horizontal proportion bar (web `h-2 rounded-full` track + tinted fill). The
/// fraction is clamped to `0…1`.
struct ChargerTypeProportionBar: View {
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

// MARK: - Breakdown content (donut + legend + per-type rows)

/// The loaded breakdown content (web grid: donut left, detail bars right). On
/// native it stacks — the donut, the color legend, then the per-type rows — so it
/// reads cleanly across iPhone / iPad / macOS size classes.
struct ChargerTypeBreakdownContent: View {
    let rows: [ChargerTypeRow]
    let title: String
    let localize: (String, String) -> String
    let formatting: any ChargerTypeFormatting

    private let legendColumns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md, alignment: .leading)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ChargerTypeDonutChart(rows: rows, title: title, formatting: formatting)
            legend
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach(rows) { row in
                    ChargerTypeRowView(row: row, localize: localize, formatting: formatting)
                }
            }
        }
    }

    private var legend: some View {
        LazyVGrid(columns: legendColumns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(rows) { row in
                ChargerTypeLegendChip(color: TSChartPalette.color(at: row.colorIndex), label: row.name)
            }
        }
        .accessibilityHidden(true)
    }
}

/// One breakdown row: "name" + "cost · sessions sessions" over a tinted
/// proportion bar, with a kWh / $-per-kWh / percent footer (web row layout).
struct ChargerTypeRowView: View {
    let row: ChargerTypeRow
    let localize: (String, String) -> String
    let formatting: any ChargerTypeFormatting

    private var sessionsWord: String {
        localize("costAnalysis.chargerType.sessions", "sessions")
    }

    private var energyUnit: String {
        localize("costAnalysis.chargerType.energyUnit", "kWh")
    }

    private var perKwhSuffix: String {
        localize("costAnalysis.chargerType.perKwhSuffix", "/kWh")
    }

    /// Web `{formatCurrency(cost, 2)} · {fmtInt(sessions)} sessions`.
    private var costAndSessions: String {
        let cost = formatting.formatCurrency(ChargerTypeNumeric.safe(row.cost), decimals: 2)
        return "\(cost) · \(formatting.formatInt(row.sessions)) \(sessionsWord)"
    }

    /// Web `fmtWithUnit(energy, 'kWh', 1)`.
    private var energyText: String {
        formatting.formatWithUnit(row.energy, unit: energyUnit, decimals: 1)
    }

    /// Web `energy > 0 ? formatCurrency(cost / energy, 3) + '/kWh' : '—'`.
    private var rateText: String {
        guard let ratePerKwh = row.ratePerKwh else { return "—" }
        return formatting.formatCurrency(ratePerKwh, decimals: 3) + perKwhSuffix
    }

    /// Web `fmtNumber(pct, 1)%`.
    private var percentText: String {
        "\(formatting.formatNumber(row.percent, decimals: 1))%"
    }

    private var summary: String {
        ChargerTypeAccessibility.rowSummary(
            row,
            labels: ChargerTypeRowLabels(
                sessions: sessionsWord,
                energyUnit: energyUnit,
                perKwhSuffix: perKwhSuffix,
                rateUnavailable: "—"
            ),
            formatCurrency: { formatting.formatCurrency($0, decimals: $1) },
            formatInt: formatting.formatInt,
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: row.name)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: costAndSessions)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            ChargerTypeProportionBar(
                fraction: row.fraction,
                color: TSChartPalette.color(at: row.colorIndex),
                height: 8
            )
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: energyText)
                Spacer(minLength: TSSpacing.xs)
                Text(verbatim: rateText)
                Spacer(minLength: TSSpacing.xs)
                Text(verbatim: percentText)
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .monospacedDigit()
            .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }
}

// MARK: - Freshness banner (native chrome for stale / offline)

/// The freshness banner shown above the panel when the feed is stale or offline.
/// Cached data stays visible; the banner offers a manual refresh.
struct ChargerTypeFreshnessBanner: View {
    let connection: ChargerTypeConnection
    let localize: (String, String) -> String
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: String {
        connection == .offline
            ? localize(
                "costAnalysis.chargerType.offlineBanner",
                "Offline — showing the last known charger type costs"
            )
            : localize(
                "costAnalysis.chargerType.staleBanner",
                "Reconnecting — charger type costs may be out of date"
            )
    }

    private var refreshLabel: String {
        localize("costAnalysis.chargerType.refresh", "Refresh")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                Text(verbatim: refreshLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: refreshLabel))
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
struct ChargerTypeErrorView: View {
    let message: String
    let localize: (String, String) -> String
    let onRetry: () -> Void

    private var retryLabel: String {
        localize("costAnalysis.chargerType.retry", "Retry")
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: localize("costAnalysis.chargerType.errorTitle", "Couldn't load charger type costs"))
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
                Text(verbatim: retryLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: a redacted title, a redacted donut ring, and
/// a few breakdown bars matching the loaded layout so the transition is stable.
struct ChargerTypeSkeleton: View {
    let localize: (String, String) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSSkeleton(width: 180, height: 14)
            Circle()
                .strokeBorder(Color.TS.border.opacity(0.3), lineWidth: 28)
                .frame(width: 160, height: 160)
                .frame(maxWidth: .infinity)
            ForEach(0 ..< 3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(height: 10)
                    TSSkeleton(width: 220, height: 8)
                }
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: localize(
            "costAnalysis.chargerType.loading",
            "Loading cost by charger type"
        )))
    }
}
