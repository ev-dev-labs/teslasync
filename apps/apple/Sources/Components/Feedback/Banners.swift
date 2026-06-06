import SwiftUI

/// Base banner (web `AlertBanner`): tinted, icon + message + optional trailing action.
public struct TSAlertBanner<Action: View>: View {
    private let tone: TSTone
    private let systemImage: String
    private let title: LocalizedStringKey
    private let message: LocalizedStringKey?
    private let onDismiss: (() -> Void)?
    private let action: () -> Action

    public init(
        tone: TSTone,
        systemImage: String,
        title: LocalizedStringKey,
        message: LocalizedStringKey? = nil,
        onDismiss: (() -> Void)? = nil,
        @ViewBuilder action: @escaping () -> Action
    ) {
        self.tone = tone
        self.systemImage = systemImage
        self.title = title
        self.message = message
        self.onDismiss = onDismiss
        self.action = action
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: systemImage)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Font.TS.bodySm).fontWeight(.semibold).foregroundStyle(Color.TS.textPrimary)
                if let message {
                    Text(message).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            action()
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark").font(.caption2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityLabel(Text("action.dismiss"))
            }
        }
        .padding(TSSpacing.md)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.color.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

public extension TSAlertBanner where Action == EmptyView {
    /// Banner with no trailing action.
    init(
        tone: TSTone,
        systemImage: String,
        title: LocalizedStringKey,
        message: LocalizedStringKey? = nil,
        onDismiss: (() -> Void)? = nil
    ) {
        self.init(
            tone: tone,
            systemImage: systemImage,
            title: title,
            message: message,
            onDismiss: onDismiss
        ) { EmptyView() }
    }
}

/// Inline contextual note (web `InlineCallout`).
public struct TSInlineCallout: View {
    private let tone: TSTone
    private let message: LocalizedStringKey

    public init(tone: TSTone = .info, message: LocalizedStringKey) {
        self.tone = tone
        self.message = message
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "info.circle.fill").foregroundStyle(tone.color)
            Text(message).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }
}

// Specific banners — thin presets over TSAlertBanner so every web export maps to a
// named component without duplicating the layout.

/// Offline connectivity banner (web `OfflineBanner`).
public struct TSOfflineBanner: View {
    public init() {}
    public var body: some View {
        TSAlertBanner(tone: .warning, systemImage: "wifi.slash", title: "offline.title", message: "offline.message")
    }
}

/// Stale live-data banner (web `LiveStaleDataBanner`).
public struct TSLiveStaleDataBanner: View {
    public init() {}
    public var body: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "clock.badge.exclamationmark",
            title: "stale.title",
            message: "stale.message"
        )
    }
}

/// Tesla re-authentication banner with a reconnect action (web `TeslaReauthBanner`).
public struct TSTeslaReauthBanner: View {
    private let onReconnect: () -> Void
    public init(onReconnect: @escaping () -> Void) {
        self.onReconnect = onReconnect
    }

    public var body: some View {
        TSAlertBanner(tone: .danger, systemImage: "key.slash", title: "reauth.title", message: "reauth.message") {
            TSButton("reauth.action", size: .small, action: onReconnect)
        }
    }
}

/// Rate-limit banner (web `RateLimitBanner`).
public struct TSRateLimitBanner: View {
    public init() {}
    public var body: some View {
        TSAlertBanner(tone: .warning, systemImage: "hourglass", title: "rateLimit.title", message: "rateLimit.message")
    }
}

/// Maintenance window banner (web `MaintenanceBanner`).
public struct TSMaintenanceBanner: View {
    public init() {}
    public var body: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "wrench.and.screwdriver",
            title: "maintenance.title",
            message: "maintenance.message"
        )
    }
}

/// Impersonation-active banner (web `ImpersonationBanner`).
public struct TSImpersonationBanner: View {
    private let onExit: () -> Void
    public init(onExit: @escaping () -> Void) {
        self.onExit = onExit
    }

    public var body: some View {
        TSAlertBanner(
            tone: .accent,
            systemImage: "person.crop.circle.badge.exclamationmark",
            title: "impersonation.title",
            message: "impersonation.message"
        ) {
            TSButton("impersonation.exit", variant: .secondary, size: .small, action: onExit)
        }
    }
}

/// Draft-recovery banner (web `DraftRecoveryBanner`).
public struct TSDraftRecoveryBanner: View {
    private let onRestore: () -> Void
    private let onDiscard: () -> Void
    public init(onRestore: @escaping () -> Void, onDiscard: @escaping () -> Void) {
        self.onRestore = onRestore
        self.onDiscard = onDiscard
    }

    public var body: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "arrow.uturn.backward",
            title: "draft.title",
            message: "draft.message",
            onDismiss: onDiscard
        ) {
            TSButton("draft.restore", size: .small, action: onRestore)
        }
    }
}

/// Edit-conflict banner (web `EditConflictBanner`).
public struct TSEditConflictBanner: View {
    private let onReload: () -> Void
    public init(onReload: @escaping () -> Void) {
        self.onReload = onReload
    }

    public var body: some View {
        TSAlertBanner(
            tone: .danger,
            systemImage: "exclamationmark.arrow.triangle.2.circlepath",
            title: "conflict.title",
            message: "conflict.message"
        ) {
            TSButton("conflict.reload", size: .small, action: onReload)
        }
    }
}

/// Historical/time-machine viewing banner (web `TimeMachineBanner`).
public struct TSTimeMachineBanner: View {
    private let onExit: () -> Void
    public init(onExit: @escaping () -> Void) {
        self.onExit = onExit
    }

    public var body: some View {
        TSAlertBanner(
            tone: .accent,
            systemImage: "clock.arrow.circlepath",
            title: "timeMachine.title",
            message: "timeMachine.message"
        ) {
            TSButton("timeMachine.exit", variant: .secondary, size: .small, action: onExit)
        }
    }
}

/// Cookie-consent banner (web `CookieConsentBanner`).
public struct TSCookieConsentBanner: View {
    private let onAccept: () -> Void
    public init(onAccept: @escaping () -> Void) {
        self.onAccept = onAccept
    }

    public var body: some View {
        TSAlertBanner(
            tone: .neutral,
            systemImage: "checkmark.shield",
            title: "cookie.title",
            message: "cookie.message"
        ) {
            TSButton("cookie.accept", size: .small, action: onAccept)
        }
    }
}

/// Browser/platform compatibility banner (web `BrowserCompatBanner`).
public struct TSBrowserCompatBanner: View {
    public init() {}
    public var body: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle",
            title: "compat.title",
            message: "compat.message"
        )
    }
}

/// Draft-restore prompt with restore/discard (web `DraftRestorePrompt`).
public struct TSDraftRestorePrompt: View {
    private let onRestore: () -> Void
    private let onDiscard: () -> Void
    public init(onRestore: @escaping () -> Void, onDiscard: @escaping () -> Void) {
        self.onRestore = onRestore
        self.onDiscard = onDiscard
    }

    public var body: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "tray.and.arrow.up",
            title: "draftRestore.title",
            message: "draftRestore.message",
            onDismiss: onDiscard
        ) {
            TSButton("draft.restore", size: .small, action: onRestore)
        }
    }
}
