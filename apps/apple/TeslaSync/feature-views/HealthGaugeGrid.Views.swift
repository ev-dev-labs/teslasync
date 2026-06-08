//
//  HealthGaugeGrid.Views.swift
//  TeslaSync — P4 feature view · 0154 · HealthGaugeGrid (Apple)
//
//  The content chrome composed by `HealthGaugeGrid`: the responsive three-panel row (health-score
//  gauge · motor details · drive statistics), the single radial gauge (web `RadialGauge`), and the
//  key/value rows (web `KVList`). The freshness chip, connectivity banner, and loading / empty /
//  error states live in HealthGaugeGrid.States.swift. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Health status → token tint (web HEALTH_COLOR map)

extension HealthGaugeGridDrivetrainHealthStatus {
    /// The shared status tone for the gauge arc + percent (web hex map: good `#10b981` →
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
}

// MARK: - Layout

enum HealthGaugeLayout {
    /// The responsive panel row (web `grid-cols-1 md:grid-cols-3`): one column on a narrow phone
    /// panel, flowing to three on a wider iPad / Mac surface via an adaptive column track.
    static let columns = [GridItem(.adaptive(minimum: 240, maximum: .infinity), spacing: TSSpacing.lg, alignment: .top)]
}

// MARK: - Content (web three-panel `Grid`)

/// The populated state: the three panels in the web render order (health-score gauge, motor
/// details, drive statistics) in a responsive grid.
struct HealthGaugeContent: View {
    let projection: HealthGaugeGridProjection

    var body: some View {
        LazyVGrid(columns: HealthGaugeLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
            HealthScoreGaugePanel(gauge: projection.gauge)
            MotorDetailsPanel(rows: projection.motorRows)
            DriveStatisticsPanel(rows: projection.driveRows)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: HealthGaugeGridAccessibility.summary(for: projection)))
    }
}

// MARK: - Panel scaffolding

/// A glass panel matching the web `GlassPanel p-6`, with a consistent inset so the three panels
/// read as a row.
struct HealthGaugePanel<Content: View>: View {
    var alignment: HorizontalAlignment = .leading
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: alignment, spacing: TSSpacing.md) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: alignment == .center ? .center : .leading)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }
}

/// The uppercase muted panel header (web `text-sm font-medium uppercase tracking-wider
/// text-muted`).
private struct HealthPanelHeader: View {
    let key: String
    let fallback: String

    var body: some View {
        HealthGaugeGridStrings.text(key, fallback)
            .font(Font.TS.label)
            .fontWeight(.medium)
            .textCase(.uppercase)
            .tracking(0.8)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Health-score gauge panel (web RadialGauge + description)

/// The first panel: the centered radial health-score gauge over its description text (web
/// `GlassPanel.flex.flex-col.items-center` with the `RadialGauge` + the `healthScoreDesc` copy).
struct HealthScoreGaugePanel: View {
    let gauge: HealthScoreGauge

    var body: some View {
        HealthGaugePanel(alignment: .center) {
            HealthRadialGaugeView(gauge: gauge)
            HealthGaugeGridStrings.text(
                "drivetrain.healthScoreDesc",
                "Overall drivetrain condition rating"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
        }
    }
}

/// One radial gauge: a neutral track ring, a status-tinted progress arc filling `value / 100`, a
/// centre value + "%" suffix, and the "Health Score" label below — the native parity of the web
/// `RadialGauge`. The arc fills in on appear and honours Reduce Motion.
struct HealthRadialGaugeView: View {
    let gauge: HealthScoreGauge

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fill: Double = 0

    private let diameter: CGFloat = 140
    private let lineWidth: CGFloat = 8

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                Circle()
                    .stroke(Color.TS.textMuted.opacity(0.22), lineWidth: lineWidth)
                Circle()
                    .trim(from: 0, to: fill)
                    .stroke(
                        gauge.status.color,
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                centreReadout
            }
            .frame(width: diameter, height: diameter)
            Text(verbatim: gauge.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .onAppear { animate(to: gauge.fraction) }
        .onChange(of: gauge.fraction) { _, newValue in animate(to: newValue) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: gauge.label))
        .accessibilityValue(Text(verbatim: gauge.spokenValue))
    }

    private var centreReadout: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: gauge.valueText)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: gauge.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, lineWidth)
    }

    private func animate(to fraction: Double) {
        let target = min(max(fraction, 0), 1)
        withAnimation(reduceMotion ? nil : .easeOut(duration: TSMotion.slowDuration)) {
            fill = target
        }
    }
}

// MARK: - Motor details panel (web KVList + footer)

/// The second panel: the "Motor Details" header, the four motor key/value rows, and the
/// "Real-time telemetry active" footer with a live-telemetry glyph.
struct MotorDetailsPanel: View {
    let rows: [HealthDetailRow]

    var body: some View {
        HealthGaugePanel {
            HealthPanelHeader(key: "drivetrain.motorDetails", fallback: "Motor Details")
            HealthKVList(rows: rows)
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                HealthGaugeGridStrings.text("drivetrain.realTime", "Real-time telemetry active")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Drive statistics panel (web KVList or Skeleton)

/// The third panel: the "Drive Statistics" header over the four drive key/value rows, or the
/// four-line skeleton when the stats query has not resolved (web `stats ? <KVList/> :
/// <Skeleton lines={4} />`).
struct DriveStatisticsPanel: View {
    let rows: [HealthDetailRow]?

    var body: some View {
        HealthGaugePanel {
            HealthPanelHeader(key: "drivetrain.driveStats", fallback: "Drive Statistics")
            if let rows {
                HealthKVList(rows: rows)
            } else {
                HealthKVSkeleton(lines: 4)
            }
        }
    }
}

// MARK: - Key/value list (web `KVList`)

/// The native parity of the web `KVList`: muted labels on the leading edge, medium-weight values
/// on the trailing edge, hairline dividers between rows (web `divide-y`).
struct HealthKVList: View {
    let rows: [HealthDetailRow]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 {
                    Divider().overlay(Color.TS.border)
                }
                HealthKVRow(row: row)
            }
        }
    }
}

/// One key/value row (web `flex justify-between py-2`).
private struct HealthKVRow: View {
    let row: HealthDetailRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: row.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: row.value)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: HealthGaugeGridAccessibility.rowSummary(label: row.label, value: row.value)))
    }
}
