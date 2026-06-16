import SwiftUI

// The metric-card grid (panels 1-4), the drain-score `RadialGauge` panel (panel 5, the P3
// native Swift Charts gauge — never a WKWebView), the Tips-to-Reduce-Vampire-Drain panel
// (panel 9), and the loading skeleton for the Vampire Drain surface (web `VampireDrainPage`).
// Percentages / rates / energy / score format directly via `VampireDrainFormat` at this
// render boundary (ADR-005). Each section renders its own empty state (never a blank region).

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled metric with a tinted SF Symbol (web `MetricCard` + its `color`/`icon` props —
/// `color` tints the icon). Composes the shared `TSCard` + typography.
struct VampireMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String
    var tone: TSTone = .accent

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSMetricValue(value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary metrics (web 4 MetricCards — panels 1-4)

/// The four summary cards (web Avg-Drain-Rate, Total-Phantom-Loss, Worst-Session,
/// Drain-Score). Labels use the web key names verbatim; the icon tints map the web `color`
/// props (purple→accent, red→danger, amber→warning, green→success) to the shared tones.
struct VampireDrainSummarySection: View {
    let data: VampireDrainData

    private let columns = [GridItem(.adaptive(minimum: 170), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            VampireMetricCard(
                title: "Avg Drain Rate",
                value: VampireDrainFormat.ratePerHour(data.avgDrainRate),
                systemImage: "bolt.fill",
                tone: .accent
            )
            VampireMetricCard(
                title: "Total Phantom Loss",
                value: VampireDrainFormat.kilowattHours(data.totalEnergyLost),
                systemImage: "minus.plus.batteryblock.fill",
                tone: .danger
            )
            VampireMetricCard(
                title: "Worst Session",
                value: VampireDrainFormat.lossPercent(data.worstDrainPct),
                systemImage: "waveform.path.ecg",
                tone: .warning
            )
            VampireMetricCard(
                title: "Drain Score",
                value: VampireDrainFormat.score(data.drainScore),
                systemImage: "shield.lefthalf.filled",
                tone: .success
            )
        }
    }
}

// MARK: - Drain-score gauge (web GlassPanel5 — RadialGauge)

/// The drain-score gauge panel (web GlassPanel5): a `TSRadialGauge` of the 0-100 drain
/// score, tinted by the web `scoreColor` band (≥ 80 green / ≥ 50 amber / else red) with the
/// "Score" label beneath the value.
struct VampireDrainScoreGauge: View {
    let data: VampireDrainData

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                TSRadialGauge(
                    value: data.scoreFraction,
                    label: "Score",
                    colorIndex: data.scoreColorIndex
                )
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text("Drain Score"))
                .accessibilityValue(Text(verbatim: VampireDrainFormat.score(data.drainScore)))
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Tips (web Tips to Reduce Vampire Drain — GlassPanel9)

/// The recommendations panel (web green-glow GlassPanel9): a lightbulb header plus the four
/// ported tips, each a tinted glyph beside its localized advice.
struct VampireDrainTipsSection: View {
    private let tips = VampireDrainTip.all

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "lightbulb.fill")
                        .foregroundStyle(Color.TS.statusSuccess)
                        .accessibilityHidden(true)
                    TSSubhead("Tips to Reduce Vampire Drain")
                }
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(tips) { tip in
                        tipRow(tip)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private func tipRow(_ tip: VampireDrainTip) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: tip.systemImage)
                .font(.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(LocalizedStringKey(tip.textKey))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web Skeleton loading state)

/// Mirrors the page layout while the source loads (web `loading` → `Skeleton`): the summary
/// grid, the gauge/trend pair, the daily bar block, and the table block, all under SwiftUI
/// redaction (the manifest's `loading → redacted`).
struct VampireDrainSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonGrid(count: 4, minimum: 170)
            HStack(spacing: TSSpacing.lg) {
                skeletonBlock(height: 220)
                skeletonBlock(height: 220)
            }
            skeletonBlock(height: 260)
            skeletonBlock(height: 240)
        }
        .vampireDrainRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("Vampire Drain"))
    }

    private func skeletonGrid(count: Int, minimum: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 96)
            }
        }
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func vampireDrainRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
