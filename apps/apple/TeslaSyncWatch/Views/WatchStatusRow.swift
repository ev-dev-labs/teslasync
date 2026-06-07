import SwiftUI

/// The read-only climate & security status row on the glance: lock, climate (with
/// cabin temperature), and Sentry. Each chip honestly shows an unknown state when
/// the phone has not synced that datum yet, rather than implying a value. Actuation
/// lives in the confirmed Actions surface, never a tap here.
struct WatchStatusRow: View {
    let glance: WatchGlanceData

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            WatchStatusChip(
                systemImage: lockImage,
                titleKey: lockKey,
                tint: lockTint
            )
            WatchStatusChip(
                systemImage: glance.isClimateOn == true ? "fan.fill" : "fan.slash",
                titleKey: climateKey,
                tint: glance.isClimateOn == true ? Color.TS.statusInfo : Color.TS.textMuted
            )
            WatchStatusChip(
                systemImage: glance.isSentryOn == true ? "shield.lefthalf.filled" : "shield.slash",
                titleKey: sentryKey,
                tint: glance.isSentryOn == true ? Color.TS.statusWarning : Color.TS.textMuted
            )
        }
    }

    private var lockImage: String {
        switch glance.isLocked {
        case true: "lock.fill"
        case false: "lock.open.fill"
        default: "lock.slash"
        }
    }

    private var lockTint: Color {
        switch glance.isLocked {
        case true: Color.TS.statusSuccess
        case false: Color.TS.statusWarning
        default: Color.TS.textMuted
        }
    }

    private var lockKey: LocalizedStringKey {
        switch glance.isLocked {
        case true: "watch.status.locked"
        case false: "watch.status.unlocked"
        default: "watch.status.unknown"
        }
    }

    private var climateKey: LocalizedStringKey {
        if let temp = glance.insideTempDisplay {
            return LocalizedStringKey(temp)
        }
        return glance.isClimateOn == true ? "watch.status.on" : "watch.status.off"
    }

    private var sentryKey: LocalizedStringKey {
        switch glance.isSentryOn {
        case true: "watch.status.on"
        case false: "watch.status.off"
        default: "watch.status.unknown"
        }
    }
}

/// One status chip: a glyph over a short label, sized for a glance.
private struct WatchStatusChip: View {
    let systemImage: String
    let titleKey: LocalizedStringKey
    let tint: Color

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: systemImage)
                .font(.body)
                .foregroundStyle(tint)
            Text(titleKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(titleKey))
    }
}
