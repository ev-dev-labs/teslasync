//
//  ProjectedRangeWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0074 · ProjectedRangeWidget (Apple)
//
//  The presentational subviews composed by `ProjectedRangeWidget`: the tinted
//  health chip, the stale/offline banner, the compact (1×2) big-number readout,
//  the standard/wide primary readout, the projected-vs-EPA comparison bar, and the
//  wide-view range-factors list. All consume the pre-projected `ProjectedRangeStats`
//  + pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - ProjectedRangeChip (tinted capsule — web `Badge`)

/// A capsule status chip styled with the shared badge tokens, taking a pre-localized
/// `String` (which the shared `TSBadge` — `LocalizedStringKey`-only — can't express
/// for our per-surface table). Used for the health-confidence badge.
struct ProjectedRangeChip: View {
    let tone: TSTone
    let label: String

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: label))
    }
}

/// The health-confidence badge ("Excellent · 94%") rendered when a health score is
/// present (web `badge && <Badge>…`). Renders nothing when the score is unknown.
struct ProjectedRangeHealthBadge: View {
    let stats: ProjectedRangeStats

    var body: some View {
        if let tier = stats.healthTier, let label = stats.healthLabel, let score = stats.healthScoreDisplay {
            ProjectedRangeChip(tone: tier.tone, label: "\(label) · \(score)")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not
/// live, so the cached projection is clearly labeled (web freshness intent).
struct ProjectedRangeConnectivityBanner: View {
    let connection: ProjectedRangeConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.projectedRange.offlineBanner" : "widget.projectedRange.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known range"
            : "Reconnecting — range may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ProjectedRangeStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Compact big number (web `WidgetBigNumber`, 1×2)

/// The 1×2 layout: the projected range as a big accent number, the unit, the
/// "Projected" caption, and the health badge (web `WidgetBigNumber`).
struct ProjectedRangeBigNumber: View {
    let stats: ProjectedRangeStats

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                ProjectedRangeValueText(display: stats.projectedDisplay)
                Text(verbatim: stats.distanceUnit)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            ProjectedRangeStrings.text("widget.projectedRange.projected", "Projected")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            ProjectedRangeHealthBadge(stats: stats)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ProjectedRangeAccessibility.summary(
            for: stats,
            localize: ProjectedRangeStrings.string
        )))
    }
}

// MARK: - Standard / wide primary readout (web `StandardView` / `WideView` header)

/// The centered primary range readout (big accent number + unit + health badge)
/// shared by the standard (2×2) and wide (≥3 cols) layouts.
struct ProjectedRangePrimaryReadout: View {
    let stats: ProjectedRangeStats

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                ProjectedRangeValueText(display: stats.projectedDisplay)
                Text(verbatim: stats.distanceUnit)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            ProjectedRangeHealthBadge(stats: stats)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ProjectedRangeAccessibility.summary(
            for: stats,
            localize: ProjectedRangeStrings.string
        )))
    }
}

/// The animated projected-range value, or the muted em-dash sentinel when the
/// payload has no current range (web `projectedRange != null ? <AnimatedNumber> : —`).
struct ProjectedRangeValueText: View {
    let display: String?

    var body: some View {
        if let display {
            TSAnimatedNumber(formatted: display)
                .foregroundStyle(Color.TS.accent)
        } else {
            Text(verbatim: "—")
                .font(Font.TS.title)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Comparison bar (web `ComparisonBar`)

/// The projected-vs-EPA proportion bar: the "Projected" / "EPA: …" header, the
/// tinted fill (green ≥80% · amber ≥60% · red below), and the "{pct}% of EPA rated"
/// caption (web `ComparisonBar`).
struct ProjectedRangeComparisonBar: View {
    let stats: ProjectedRangeStats

    private var fraction: Double {
        Double(stats.rangePct ?? 0) / 100
    }

    private var epaLine: String {
        let epa = stats.epaDisplay ?? "—"
        return "\(ProjectedRangeStrings.string("widget.projectedRange.epa", "EPA")): \(epa)"
    }

    var body: some View {
        let tone = ProjectedRangeStats.comparisonTone(rangePct: stats.rangePct)
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                ProjectedRangeStrings.text("widget.projectedRange.projected", "Projected")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: epaLine)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.TS.border.opacity(0.3))
                    Capsule()
                        .fill(tone.color)
                        .frame(width: geo.size.width * min(max(fraction, 0), 1))
                }
            }
            .frame(height: 8)
            if let pct = stats.rangePct {
                Text(verbatim: "\(pct)% \(ProjectedRangeStrings.string("widget.projectedRange.ofEpa", "of EPA rated"))")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Range factors (web wide-view factors list)

/// The wide-view "Range Factors" list — the titled set of degradation / daily-usage
/// / capacity / cycles rows (web `factors.map(...)`).
struct ProjectedRangeFactorsList: View {
    let factors: [ProjectedRangeFactor]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ProjectedRangeStrings.text("widget.projectedRange.factors", "Range Factors")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(factors) { factor in
                ProjectedRangeFactorRow(factor: factor)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One factor row: a leading SF Symbol, the localized label, and the formatted
/// value (web factor row), sized to the 44pt accessible touch target.
struct ProjectedRangeFactorRow: View {
    let factor: ProjectedRangeFactor

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: factor.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(verbatim: factor.label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: factor.value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
        }
        .frame(minHeight: 44)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.TS.border.opacity(0.4)).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(factor.label): \(factor.value)"))
    }
}
