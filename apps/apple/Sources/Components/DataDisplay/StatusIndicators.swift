import SwiftUI

/// Small colored state dot (web `StatusDot`).
public struct TSStatusDot: View {
    private let tone: TSTone
    private let isPulsing: Bool

    public init(tone: TSTone = .neutral, isPulsing: Bool = false) {
        self.tone = tone
        self.isPulsing = isPulsing
    }

    public var body: some View {
        Circle()
            .fill(tone.color)
            .frame(width: 8, height: 8)
            .overlay {
                if isPulsing {
                    Circle().stroke(tone.color.opacity(0.5), lineWidth: 2).scaleEffect(1.6)
                }
            }
            .accessibilityHidden(true)
    }
}

/// Labeled status with a leading dot (web `StatusBadge`).
public struct TSStatusBadge: View {
    private let text: LocalizedStringKey
    private let tone: TSTone

    public init(_ text: LocalizedStringKey, tone: TSTone = .neutral) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TSStatusDot(tone: tone)
            Text(text).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
        }
    }
}

/// Severity level shared by severity/score badges.
public enum TSSeverity {
    case info, low, medium, high, critical

    public var tone: TSTone {
        switch self {
        case .info: .info
        case .low: .success
        case .medium: .warning
        case .high: .warning
        case .critical: .danger
        }
    }

    public var labelKey: LocalizedStringKey {
        switch self {
        case .info: "severity.info"
        case .low: "severity.low"
        case .medium: "severity.medium"
        case .high: "severity.high"
        case .critical: "severity.critical"
        }
    }
}

/// Severity chip (web `SeverityBadge`).
public struct TSSeverityBadge: View {
    private let severity: TSSeverity

    public init(_ severity: TSSeverity) {
        self.severity = severity
    }

    public var body: some View {
        TSBadge(severity.labelKey, tone: severity.tone)
    }
}

/// Numeric score chip colored by threshold (web `ScoreBadge`).
public struct TSScoreBadge: View {
    private let score: Int

    public init(score: Int) {
        self.score = score
    }

    private var tone: TSTone {
        switch score {
        case ..<50: .danger
        case 50 ..< 80: .warning
        default: .success
        }
    }

    public var body: some View {
        Text(verbatim: "\(score)")
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .accessibilityLabel(Text("score.value \(score)"))
    }
}

/// Vehicle FSM state badge (web `FSMBadge`).
public struct TSFSMBadge: View {
    private let state: LocalizedStringKey
    private let tone: TSTone

    public init(state: LocalizedStringKey, tone: TSTone = .accent) {
        self.state = state
        self.tone = tone
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "circle.hexagongrid.fill").font(.caption2)
            Text(state).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.12), in: Capsule())
    }
}

/// Signal source-layer badge L1/L2/log (web `SourceLayerBadge`).
public struct TSSourceLayerBadge: View {
    public enum Layer { case local, shared, history }

    private let layer: Layer

    public init(_ layer: Layer) {
        self.layer = layer
    }

    private var labelKey: LocalizedStringKey {
        switch layer {
        case .local: "source.local"
        case .shared: "source.shared"
        case .history: "source.history"
        }
    }

    public var body: some View {
        Text(labelKey)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 1)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

/// Live-stream pulse indicator (web `LiveIndicator`). Pulse honors Reduce Motion.
public struct TSLiveIndicator: View {
    private let isLive: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    public init(isLive: Bool) {
        self.isLive = isLive
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(isLive ? Color.TS.statusSuccess : Color.TS.textMuted)
                .frame(width: 8, height: 8)
                .scaleEffect(pulse && isLive && !reduceMotion ? 1.3 : 1)
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true),
                    value: pulse
                )
            Text(isLive ? "live.on" : "live.off")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .onAppear { pulse = true }
        .accessibilityLabel(Text(isLive ? "live.on" : "live.off"))
    }
}

/// Data freshness chip; flags stale values (web `FreshnessIndicator`/`DataFreshness`).
public struct TSFreshnessIndicator: View {
    private let isStale: Bool
    private let label: LocalizedStringKey

    public init(isStale: Bool, label: LocalizedStringKey) {
        self.isStale = isStale
        self.label = label
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isStale ? "clock.badge.exclamationmark" : "clock")
                .font(.caption2)
            Text(label).font(Font.TS.caption)
        }
        .foregroundStyle(isStale ? Color.TS.statusWarning : Color.TS.textMuted)
    }
}

/// Arrow between two FSM states (web `TransitionArrow`).
public struct TSTransitionArrow: View {
    private let from: LocalizedStringKey
    private let to: LocalizedStringKey

    public init(from: LocalizedStringKey, to: LocalizedStringKey) {
        self.from = from
        self.to = to
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(from).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            Image(systemName: "arrow.right").font(.caption2).foregroundStyle(Color.TS.textMuted)
            Text(to).font(Font.TS.caption).fontWeight(.semibold).foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
    }
}
