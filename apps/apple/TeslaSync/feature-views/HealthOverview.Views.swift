//
//  HealthOverview.Views.swift
//  TeslaSync — P4 feature view · 0155 · HealthOverview (Apple)
//
//  The content chrome composed by `HealthOverview`: the status banner (web `AlertBanner`, shown
//  only when the drivetrain is not healthy) and the summary card (web `GlassPanel` with a status
//  icon, a headline, the "Motor State: …" line, a status badge, and the animated health-score
//  percent). The freshness chip, connectivity banner, and loading / empty / error states live in
//  HealthOverview.States.swift. All consume pre-localized strings from the P1/S10 facade and the
//  shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Health status → token tint + icon (web HEALTH_COLOR / icon map)

extension HealthOverviewHealthStatus {
    /// The shared status tone for the icon, badge, and score (web hex map: good `#10b981` →
    /// success, warning `#f59e0b` → warning, critical `#ef4444` → danger).
    var tone: TSTone {
        switch self {
        case .good: .success
        case .warning: .warning
        case .critical: .danger
        }
    }

    var color: Color {
        tone.color
    }

    /// The summary-card status glyph (web `CheckCircle` when healthy, else `AlertTriangle`).
    var iconSystemName: String {
        isHealthy ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
    }

    /// The status-banner glyph (web `AlertTriangle`).
    var alertIconSystemName: String {
        "exclamationmark.triangle.fill"
    }
}

// MARK: - Content (web banner + summary panel)

/// The populated state: the optional status banner over the summary card (web fragment with the
/// conditional `AlertBanner` + the `GlassPanel`).
struct HealthOverviewContent: View {
    let projection: HealthOverviewProjection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let alert = projection.alert {
                HealthOverviewAlertBanner(alert: alert)
            }
            HealthOverviewSummaryCard(projection: projection)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Status banner (web `AlertBanner`)

/// The status banner shown when the drivetrain is not healthy — the native parity of the web
/// `<AlertBanner variant={getAlertVariant(overallHealth)} title=… icon={<AlertTriangle/>}>`,
/// rendered over the shared `TSAlertBanner` (web `AlertBanner`).
struct HealthOverviewAlertBanner: View {
    let alert: HealthOverviewAlert

    var body: some View {
        TSAlertBanner(
            tone: alert.status.tone,
            systemImage: alert.status.alertIconSystemName,
            title: LocalizedStringKey(alert.title.text),
            message: LocalizedStringKey(alert.message.text)
        )
        .accessibilityLabel(Text(verbatim: HealthOverviewAccessibility.alertSummary(for: alert)))
    }
}

// MARK: - Summary card (web `GlassPanel`)

/// The summary card: a leading status icon + headline + "Motor State: …" line, and a trailing
/// status badge + animated health-score percent. Responsive like the web `flex-col sm:flex-row
/// sm:items-center sm:justify-between` — a single column on a narrow phone panel, a two-column row
/// on a wider iPad / Mac surface — via `ViewThatFits`.
struct HealthOverviewSummaryCard: View {
    let projection: HealthOverviewProjection

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: TSSpacing.lg) {
                identity
                Spacer(minLength: TSSpacing.md)
                trailing
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                identity
                trailing
            }
        }
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(projection.status.color.opacity(0.35), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: HealthOverviewAccessibility.cardSummary(for: projection)))
    }

    /// The leading block: the status glyph next to the headline + "Motor State: …" line.
    private var identity: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            Image(systemName: projection.status.iconSystemName)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(projection.status.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: projection.headline.text)
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: projection.motorStateLine)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The trailing block: the status badge next to the animated score percent.
    private var trailing: some View {
        HStack(spacing: TSSpacing.md) {
            HealthOverviewStatusBadge(status: projection.badge.status, label: projection.badge.label.text)
            HealthOverviewScoreText(text: projection.scoreReadout, color: projection.status.color)
        }
    }
}

// MARK: - Status badge (web `Badge size="lg" dot`)

/// The status badge — the native parity of the web `<Badge variant=… size="lg" dot>`: a leading
/// state dot and the uppercased status label in a tinted capsule.
struct HealthOverviewStatusBadge: View {
    let status: HealthOverviewHealthStatus
    let label: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(status.color)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(status.color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(status.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(status.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Score percent (web `AnimatedNumber` colored by status)

/// The health-score percent — the native parity of the web colored `<span class="text-2xl
/// font-bold"><AnimatedNumber value={healthScore} suffix="%" /></span>`. The numeric content
/// transition animates on value change and honors Reduce Motion (matching the shared
/// `TSAnimatedNumber`); the status tint is applied here because the score is colored by health in
/// the web source.
struct HealthOverviewScoreText: View {
    let text: String
    let color: Color

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.title)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(color)
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: text)
            .accessibilityLabel(Text(verbatim: text))
    }
}
