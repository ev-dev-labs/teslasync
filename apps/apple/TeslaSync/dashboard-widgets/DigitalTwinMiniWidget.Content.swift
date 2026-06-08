import SwiftUI

// MARK: - Loaded content: glyph + status badges

struct DigitalTwinMiniContent: View {
    let data: DigitalTwinMiniData
    let exteriorColor: String?
    let showBadges: Bool

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            DigitalTwinGlyph(data: data, bodyColor: twinExteriorColor(exteriorColor))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilityLabel)
                .accessibilityIdentifier("widget.digitalTwinMini.glyph")
            if showBadges {
                badges
            }
        }
    }

    private var badges: some View {
        HStack(spacing: TSSpacing.sm) {
            TwinStatusBadge(spec: DigitalTwinMiniBadges.lock(locked: data.locked))
            if let sentry = DigitalTwinMiniBadges.sentry(data.sentryMode) {
                TwinStatusBadge(spec: sentry)
            }
        }
        .accessibilityIdentifier("widget.digitalTwinMini.badges")
    }

    /// Combined VoiceOver description of the glyph (lock, sentry, charge, openings).
    private var accessibilityLabel: Text {
        var label = Text("widget.digitalTwinMini.a11y.vehicle")
        let lock = DigitalTwinMiniBadges.lock(locked: data.locked)
        label = label + Text(verbatim: " · ") + Text(LocalizedStringKey(lock.key))
        if let sentry = DigitalTwinMiniBadges.sentry(data.sentryMode) {
            label = label + Text(verbatim: " · ") + Text(LocalizedStringKey(sentry.key))
        }
        if data.isCharging {
            label = label + Text(verbatim: " · ") + Text("widget.digitalTwinMini.a11y.charging")
        } else if data.chargePortOpen == true {
            label = label + Text(verbatim: " · ") + Text("widget.digitalTwinMini.a11y.chargePortOpen")
        }
        if data.anyDoorOpen {
            label = label + Text(verbatim: " · ") + Text("widget.digitalTwinMini.a11y.doorsOpen")
        }
        if data.anyWindowOpen {
            label = label + Text(verbatim: " · ") + Text("widget.digitalTwinMini.a11y.windowsOpen")
        }
        return label
    }
}

// MARK: - Status badge (web `Badge` with leading icon)

/// Tone for a status badge, kept local + `Equatable` so badge specs are testable.
enum TwinBadgeTone: Equatable {
    case success, danger, info, neutral

    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .neutral: Color.TS.textMuted
        }
    }
}

/// A resolved badge: i18n key + tone + SF Symbol. Pure data so the lock/sentry
/// mapping is unit-tested without rendering.
struct TwinBadgeSpec: Equatable {
    let key: String
    let tone: TwinBadgeTone
    let systemImage: String
}

/// Lock/sentry badge mapping, mirroring the web variant + label logic exactly.
enum DigitalTwinMiniBadges {
    static func lock(locked: Bool?) -> TwinBadgeSpec {
        if locked == false {
            return TwinBadgeSpec(key: "widget.digitalTwinMini.unlocked", tone: .danger, systemImage: "lock.open.fill")
        }
        let key = locked == true ? "widget.digitalTwinMini.locked" : "widget.digitalTwinMini.unknownDash"
        return TwinBadgeSpec(key: key, tone: .success, systemImage: "lock.fill")
    }

    static func sentry(_ sentryMode: Bool?) -> TwinBadgeSpec? {
        guard let sentryMode else { return nil }
        return sentryMode
            ? TwinBadgeSpec(key: "widget.digitalTwinMini.sentryOn", tone: .info, systemImage: "shield.lefthalf.filled")
            : TwinBadgeSpec(key: "widget.digitalTwinMini.sentryOff", tone: .neutral, systemImage: "shield.slash")
    }
}

private struct TwinStatusBadge: View {
    let spec: TwinBadgeSpec

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: spec.systemImage)
                .font(.system(size: 9, weight: .semibold))
            Text(LocalizedStringKey(spec.key))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(spec.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(spec.tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(spec.tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(LocalizedStringKey(spec.key)))
    }
}
