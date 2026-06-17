import SwiftUI

// MARK: - Thermal Comfort (web GlassPanel with 3 inner tiles)

/// The Thermal Comfort panel (web `GlassPanel`): a Comfort Score circle, a Temp
/// Delta circle, and a cabin-status circle, each tinted by the comfort ladder.
struct ClimateThermalComfort: View {
    let latest: ClimateSnapshot?
    let isCompact: Bool

    private var score: Double? {
        ClimateInsight.comfortScore(inside: latest?.insideTemp, target: latest?.driverTempSetting)
    }

    private var scoreBand: ClimateScoreBand {
        ClimateScoreBand.from(score) ?? .poor
    }

    private var delta: Double? {
        ClimateInsight.tempDelta(inside: latest?.insideTemp, target: latest?.driverTempSetting)
    }

    private var comfort: ClimateComfort {
        ClimateComfort.evaluate(inside: latest?.insideTemp, target: latest?.driverTempSetting)
    }

    var body: some View {
        ClimateSectionPanel(systemImage: "thermometer.medium", title: "Thermal Comfort") {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                comfortScoreTile
                tempDeltaTile
                statusTile
            }
        }
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: isCompact ? 1 : 3)
    }

    private var comfortScoreTile: some View {
        ClimateComfortTile(title: "Comfort Score", tone: scoreBand.tone) {
            Text(verbatim: score.map { ClimateFormat.int($0) } ?? ClimateFormat.dash)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(scoreBand.tone.color)
                .monospacedDigit()
        } footer: {
            TSBadge(scoreBand.labelKey, tone: scoreBand.tone)
        }
    }

    private var tempDeltaTile: some View {
        ClimateComfortTile(title: "Temp Delta", tone: deltaTone) {
            Text(verbatim: delta.map { ClimateFormat.signedDelta($0) } ?? ClimateFormat.dash)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(deltaTone.color)
                .monospacedDigit()
        } footer: {
            Text(deltaCaption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, 3)
                .background(Color.TS.surface, in: Capsule())
        }
    }

    private var statusTile: some View {
        let status = ClimateThermalStatus.from(delta: delta)
        return ClimateComfortTile(title: "Status", tone: scoreBand.tone) {
            Image(systemName: status.systemImage)
                .font(.system(size: 28))
                .foregroundStyle(status.tone.color)
                .accessibilityHidden(true)
        } footer: {
            TSBadge(status.labelKey, tone: comfort.tone)
        }
    }

    private var deltaTone: TSTone {
        guard let delta else { return .neutral }
        let magnitude = abs(delta)
        if magnitude <= 1 { return .success }
        if magnitude <= 3 { return .warning }
        return .danger
    }

    private var deltaCaption: LocalizedStringKey {
        guard let delta else { return "N/A" }
        if abs(delta) <= 1 { return "Near Target" }
        return delta > 0 ? "Above Target" : "Below Target"
    }
}

// MARK: - Climate Efficiency (web GlassPanel with 4 MetricCards)

/// The Climate Efficiency panel (web `GlassPanel`): Avg / Peak fan speed, AC on
/// time, and the comfort score, derived from the climate history.
struct ClimateEfficiencySection: View {
    let history: [ClimateSnapshot]
    let latest: ClimateSnapshot?
    let isCompact: Bool

    private var efficiency: ClimateEfficiency? {
        ClimateInsight.efficiency(history)
    }

    private var score: Double? {
        ClimateInsight.comfortScore(inside: latest?.insideTemp, target: latest?.driverTempSetting)
    }

    var body: some View {
        ClimateSectionPanel(systemImage: "waveform.path.ecg", title: "Climate Efficiency") {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                avgFanCard
                peakFanCard
                acOnTimeCard
                comfortScoreCard
            }
        }
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: isCompact ? 2 : 4)
    }

    private var avgFanCard: some View {
        let text = efficiency.map { ClimateFormat.number($0.avgFan, decimals: 1) } ?? ClimateFormat.dash
        return ClimateMetricCard(
            label: "Avg Fan Speed",
            value: Text(verbatim: text),
            systemImage: "wind",
            tone: .accent,
            subtitle: Text("Level 0–10")
        )
    }

    private var peakFanCard: some View {
        let text = efficiency.map { ClimateFormat.number($0.peakFan, decimals: 1) } ?? ClimateFormat.dash
        return ClimateMetricCard(
            label: "Peak Fan Speed",
            value: Text(verbatim: text),
            systemImage: "wind",
            tone: .info,
            subtitle: Text("Level 0–10")
        )
    }

    private var acOnTimeCard: some View {
        let text = efficiency.map { "\(ClimateFormat.int($0.acOnPct))%" } ?? ClimateFormat.dash
        return ClimateMetricCard(
            label: "AC On Time",
            value: Text(verbatim: text),
            systemImage: "bolt.fill",
            tone: .warning,
            subtitle: Text("of samples")
        )
    }

    private var comfortScoreCard: some View {
        let text = score.map { "\(ClimateFormat.int($0))%" } ?? ClimateFormat.dash
        let tone: TSTone = (score ?? 0) >= 80 ? .success : .warning
        return ClimateMetricCard(
            label: "Comfort Score",
            value: Text(verbatim: text),
            systemImage: "thermometer.medium",
            tone: tone
        )
    }
}
