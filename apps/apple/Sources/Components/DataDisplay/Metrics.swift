import SwiftUI

/// Up/down delta with sign-colored arrow (web `Delta`). Caller pre-formats the value.
public struct TSDelta: View {
    private let value: Double
    private let formatted: String
    private let invertColors: Bool

    public init(value: Double, formatted: String, invertColors: Bool = false) {
        self.value = value
        self.formatted = formatted
        self.invertColors = invertColors
    }

    private var isPositive: Bool {
        value >= 0
    }

    private var color: Color {
        let good = invertColors ? !isPositive : isPositive
        if value == 0 { return Color.TS.textMuted }
        return good ? Color.TS.statusSuccess : Color.TS.statusDanger
    }

    public var body: some View {
        HStack(spacing: 2) {
            Image(systemName: isPositive ? "arrow.up.right" : "arrow.down.right").font(.caption2)
            Text(verbatim: formatted).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .combine)
    }
}

/// Battery percentage delta with a bolt accent (web `BatteryDelta`).
public struct TSBatteryDelta: View {
    private let deltaPercent: Double

    public init(deltaPercent: Double) {
        self.deltaPercent = deltaPercent
    }

    public var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "bolt.fill").font(.caption2).foregroundStyle(Color.TS.statusWarning)
            TSDelta(value: deltaPercent, formatted: String(format: "%+.0f%%", deltaPercent))
        }
    }
}

/// Animated numeric value honoring Reduce Motion (web `AnimatedNumber`).
public struct TSAnimatedNumber: View {
    private let formatted: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(formatted: String) {
        self.formatted = formatted
    }

    public var body: some View {
        Text(verbatim: formatted)
            .font(Font.TS.title)
            .fontWeight(.semibold)
            .monospacedDigit()
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: formatted)
    }
}

/// Circular progress ring (web `ProgressRing`).
public struct TSProgressRing: View {
    private let progress: Double
    private let lineWidth: CGFloat
    private let colorIndex: Int

    public init(progress: Double, lineWidth: CGFloat = 8, colorIndex: Int = 0) {
        self.progress = progress
        self.lineWidth = lineWidth
        self.colorIndex = colorIndex
    }

    private var clamped: Double {
        min(max(progress, 0), 1)
    }

    public var body: some View {
        ZStack {
            Circle().stroke(Color.TS.border.opacity(0.3), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(
                    TSChartPalette.color(at: colorIndex),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityValue(Text("progress.percent \(Int((clamped * 100).rounded()))"))
    }
}

/// Horizontal proportion bar (web `MetricBar`).
public struct TSMetricBar: View {
    private let fraction: Double
    private let tone: TSTone

    public init(fraction: Double, tone: TSTone = .accent) {
        self.fraction = fraction
        self.tone = tone
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.3))
                Capsule().fill(tone.color).frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 8)
        .accessibilityValue(Text("progress.percent \(Int((min(max(fraction, 0), 1) * 100).rounded()))"))
    }
}

/// One key/value row.
public struct TSKVRow: Identifiable {
    public let id: String
    public let key: LocalizedStringKey
    public let value: String

    public init(id: String, key: LocalizedStringKey, value: String) {
        self.id = id
        self.key = key
        self.value = value
    }
}

/// Key/value list (web `KVList`).
public struct TSKVList: View {
    private let rows: [TSKVRow]

    public init(rows: [TSKVRow]) {
        self.rows = rows
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline) {
                    Text(row.key).font(Font.TS.bodySm).foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.md)
                    TSCode(row.value)
                }
            }
        }
    }
}

/// Headline metric card with optional delta (web `StatCard`).
public struct TSStatCard: View {
    private let title: LocalizedStringKey
    private let value: String
    private let systemImage: String?
    private let delta: Double?
    private let deltaFormatted: String?

    public init(
        title: LocalizedStringKey,
        value: String,
        systemImage: String? = nil,
        delta: Double? = nil,
        deltaFormatted: String? = nil
    ) {
        self.title = title
        self.value = value
        self.systemImage = systemImage
        self.delta = delta
        self.deltaFormatted = deltaFormatted
    }

    public var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    TSMetricLabel(title)
                    Spacer()
                    if let systemImage {
                        TSIconBox(systemName: systemImage)
                    }
                }
                TSAnimatedNumber(formatted: value)
                if let delta, let deltaFormatted {
                    TSDelta(value: delta, formatted: deltaFormatted)
                }
            }
        }
    }
}

/// Metric card with a title, value, and supporting caption (web `MetricCard`).
public struct TSMetricCard: View {
    private let title: LocalizedStringKey
    private let value: String
    private let caption: LocalizedStringKey?

    public init(title: LocalizedStringKey, value: String, caption: LocalizedStringKey? = nil) {
        self.title = title
        self.value = value
        self.caption = caption
    }

    public var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSMetricLabel(title)
                TSMetricValue(value)
                if let caption { TSCaption(caption) }
            }
        }
    }
}

/// Usage card with a used/total bar (web `UsageCard`).
public struct TSUsageCard: View {
    private let title: LocalizedStringKey
    private let used: Double
    private let total: Double
    private let valueText: String

    public init(title: LocalizedStringKey, used: Double, total: Double, valueText: String) {
        self.title = title
        self.used = used
        self.total = total
        self.valueText = valueText
    }

    private var fraction: Double {
        total > 0 ? used / total : 0
    }

    public var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    TSMetricLabel(title)
                    Spacer()
                    TSCode(valueText)
                }
                TSMetricBar(fraction: fraction, tone: fraction > 0.9 ? .danger : .accent)
            }
        }
    }
}

/// Inline "label: value" metric (web `InlineMetric`).
public struct TSInlineMetric: View {
    private let label: LocalizedStringKey
    private let value: String

    public init(label: LocalizedStringKey, value: String) {
        self.label = label
        self.value = value
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value).font(Font.TS.bodySm).fontWeight(.medium).foregroundStyle(Color.TS.textPrimary)
        }
    }
}

/// Two-value comparison header with a delta (web `ComparisonHeader`).
public struct TSComparisonHeader: View {
    private let leadingLabel: LocalizedStringKey
    private let leadingValue: String
    private let trailingLabel: LocalizedStringKey
    private let trailingValue: String
    private let delta: Double
    private let deltaFormatted: String

    public init(
        leadingLabel: LocalizedStringKey,
        leadingValue: String,
        trailingLabel: LocalizedStringKey,
        trailingValue: String,
        delta: Double,
        deltaFormatted: String
    ) {
        self.leadingLabel = leadingLabel
        self.leadingValue = leadingValue
        self.trailingLabel = trailingLabel
        self.trailingValue = trailingValue
        self.delta = delta
        self.deltaFormatted = deltaFormatted
    }

    public var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSMetricLabel(leadingLabel)
                TSMetricValue(leadingValue)
            }
            TSDelta(value: delta, formatted: deltaFormatted)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSMetricLabel(trailingLabel)
                TSMetricValue(trailingValue)
            }
        }
    }
}

/// One KPI tile for `TSKpiOverviewCard`.
public struct TSKpi: Identifiable {
    public let id: String
    public let label: LocalizedStringKey
    public let value: String

    public init(id: String, label: LocalizedStringKey, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

/// Grid of KPI tiles (web `KpiOverviewCard`).
public struct TSKpiOverviewCard: View {
    private let title: LocalizedStringKey
    private let kpis: [TSKpi]

    public init(title: LocalizedStringKey, kpis: [TSKpi]) {
        self.title = title
        self.kpis = kpis
    }

    public var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle(title)
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 2),
                    spacing: TSSpacing.md
                ) {
                    ForEach(kpis) { kpi in
                        VStack(alignment: .leading, spacing: TSSpacing.xs) {
                            TSMetricLabel(kpi.label)
                            TSMetricValue(kpi.value)
                        }
                    }
                }
            }
        }
    }
}
