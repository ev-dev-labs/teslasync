import SwiftUI

/// Semantic tone shared by badges/pills/icon boxes, mapped to status tokens.
public enum TSTone {
    case neutral, accent, success, warning, danger, info

    public var color: Color {
        switch self {
        case .neutral: Color.TS.textMuted
        case .accent: Color.TS.accent
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        }
    }
}

/// Compact tinted label (web `Badge`).
public struct TSBadge: View {
    private let text: LocalizedStringKey
    private let tone: TSTone

    public init(_ text: LocalizedStringKey, tone: TSTone = .neutral) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

/// Status label with a leading state dot (web `StatusBadge`).
public struct TSStatusPill: View {
    private let text: LocalizedStringKey
    private let tone: TSTone

    public init(_ text: LocalizedStringKey, tone: TSTone = .neutral) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone.color)
                .frame(width: 8, height: 8)
            Text(text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }
}

/// Rounded tinted container for an SF Symbol (web `IconBox`).
public struct TSIconBox: View {
    private let systemName: String
    private let tone: TSTone

    public init(systemName: String, tone: TSTone = .accent) {
        self.systemName = systemName
        self.tone = tone
    }

    public var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(tone.color)
            .frame(width: 36, height: 36)
            .background(
                tone.color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

#if DEBUG
    #Preview("Badges") {
        VStack(spacing: TSSpacing.md) {
            TSBadge("badge.neutral")
            TSStatusPill("status.online", tone: .success)
            TSIconBox(systemName: "bolt.fill", tone: .warning)
        }
        .padding()
    }
#endif
