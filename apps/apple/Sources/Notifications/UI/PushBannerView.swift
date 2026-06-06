import SwiftUI

/// The in-app banner shown when a push arrives while the app is foreground. The
/// server-provided title/body are rendered verbatim (dynamic content, not
/// app-localized) with a localized open/dismiss affordance, tinted by category +
/// severity. "Open" deep-links via the coordinator. Composed from the design
/// tokens so it matches the shared banner language (web `AlertBanner`).
public struct PushBannerView: View {
    private let notification: PushNotification
    private let onOpen: () -> Void
    private let onDismiss: () -> Void

    public init(
        notification: PushNotification,
        onOpen: @escaping () -> Void,
        onDismiss: @escaping () -> Void
    ) {
        self.notification = notification
        self.onOpen = onOpen
        self.onDismiss = onDismiss
    }

    public var body: some View {
        let tone = Self.tone(for: notification)
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: notification.category.systemImage)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                titleText
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityIdentifier("push.banner.title")
                if let body = notification.body, !body.isEmpty {
                    Text(verbatim: body)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .accessibilityIdentifier("push.banner.body")
                }
            }
            Spacer(minLength: TSSpacing.sm)
            TSButton("push.banner.open", size: .small, action: onOpen)
                .accessibilityIdentifier("push.banner.open")
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption2)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text("action.dismiss"))
            .accessibilityIdentifier("push.banner.dismiss")
        }
        .padding(TSSpacing.md)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.color.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("push.banner")
    }

    @ViewBuilder private var titleText: some View {
        if let title = notification.title, !title.isEmpty {
            Text(verbatim: title)
        } else {
            Text(notification.category.titleKey)
        }
    }

    /// Tints the banner by severity first (critical/warning win) then by category.
    static func tone(for notification: PushNotification) -> TSTone {
        switch notification.severity {
        case .critical: return .danger
        case .warning: return .warning
        case .info, .none: break
        }
        switch notification.category {
        case .charging: return .success
        case .security: return .danger
        case .command, .automation: return .accent
        case .alert, .trip: return .info
        case .generic: return .neutral
        }
    }
}

#if DEBUG
    #Preview("Push banner") {
        VStack(spacing: 12) {
            PushBannerView(
                notification: PushNotification(
                    id: "1",
                    category: .charging,
                    title: "Charging started",
                    body: "Now charging at 11 kW",
                    route: .charging
                ),
                onOpen: {},
                onDismiss: {}
            )
            PushBannerView(
                notification: PushNotification(
                    id: "2",
                    category: .security,
                    title: "Sentry event",
                    body: "Motion detected near your vehicle",
                    route: .vehicleSystems,
                    severity: .critical
                ),
                onOpen: {},
                onDismiss: {}
            )
        }
        .padding()
    }
#endif
