import SwiftUI

/// Compact tinted badge for a verbatim data value (provider name, run type, run status) —
/// the web renders these dynamic, non-i18n labels directly, so they stay verbatim here
/// while still using the shared `TSBadge` capsule styling + `TSTone` tokens.
struct BackupDataBadge: View {
    let text: String
    let tone: TSTone
    var systemImage: String?

    init(_ text: String, tone: TSTone, systemImage: String? = nil) {
        self.text = text
        self.tone = tone
        self.systemImage = systemImage
    }

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage).font(.caption2).accessibilityHidden(true)
            }
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

/// Provider chip (web `PROVIDER_BADGE_VARIANT` + icon + label).
struct BackupProviderBadge: View {
    let provider: BackupProvider

    /// Web `PROVIDER_BADGE_VARIANT`.
    static func tone(for provider: BackupProvider) -> TSTone {
        switch provider {
        case .local: .neutral
        case .s3: .warning
        case .azure: .info
        case .gcs: .success
        }
    }

    var body: some View {
        BackupDataBadge(provider.displayName, tone: Self.tone(for: provider), systemImage: provider.symbolName)
            .accessibilityLabel(Text(verbatim: provider.displayName))
    }
}

/// Run-type chip (web `{ backup: info, restore: success, quick: warning }`).
struct BackupRunTypeBadge: View {
    let runType: String

    static func tone(for runType: String) -> TSTone {
        switch runType {
        case "backup": .info
        case "restore": .success
        case "quick": .warning
        default: .neutral
        }
    }

    var body: some View {
        BackupDataBadge(runType, tone: Self.tone(for: runType))
    }
}

/// Run-status chip (web `STATUS_CONFIG`): tone + leading glyph, with an animated spinner
/// for the in-progress `running` state. The raw status label renders verbatim (web
/// `t('backup.status.{status}', status)` fallback).
struct BackupStatusBadge: View {
    let status: String

    private var known: BackupRunStatus {
        BackupRunStatus(status)
    }

    private var tone: TSTone {
        switch known {
        case .completed: .success
        case .failed: .danger
        case .running: .info
        case .queued: .neutral
        }
    }

    private var symbol: String {
        switch known {
        case .completed: "checkmark.seal.fill"
        case .failed: "xmark.octagon.fill"
        case .running: "arrow.triangle.2.circlepath"
        case .queued: "clock"
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            if known == .running {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: symbol).font(.caption2).accessibilityHidden(true)
            }
            Text(verbatim: status).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityLabel(Text(verbatim: status))
    }
}
