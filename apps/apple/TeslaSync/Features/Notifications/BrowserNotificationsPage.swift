//
//  BrowserNotificationsPage.swift
//  TeslaSync — P4 feature view · P7 · notifications/BrowserNotifications (Apple)
//
//  Native SwiftUI / HIG parity of web/src/features/notifications/pages/BrowserNotificationsPage.tsx
//  (route `/notifications/browser`): the web `PageContainer` chrome (title + subtitle +
//  the `copyLink` affordance) wrapping the `NotificationSettings` surface — the
//  permission gate + per-event toggles, the browser-tab signal toggles, and the
//  notification-sound channels + volume. Adaptive across macOS (regular) and iOS
//  (compact / regular) per ADR-002/006; the page scrolls and the settings card reflows.
//
//  All copy resolves from `Localizable.xcstrings` under the web key names; data binds
//  through the `@Observable` `BrowserNotificationsPageModel` (no business logic in the
//  view body). The two parity strings — `notifications.browser.title` /
//  `notifications.browser.subtitle` — render here as the page title + subtitle.
//

import SwiftUI

struct BrowserNotificationsPage: View {
    @State private var model: BrowserNotificationsPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    init(model: BrowserNotificationsPageModel = BrowserNotificationsPageModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                BrowserNotificationsSettingsCard(model: model)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 880, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("translation.notifications.browser.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .task { await model.refreshPermission() }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web `PageContainer` title + subtitle + copyLink)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    BrowserNotificationsCopyLinkButton()
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    BrowserNotificationsCopyLinkButton()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("translation.notifications.browser.title")
            Text("translation.notifications.browser.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Copy-link affordance (web `PageContainer copyLink`)

/// The web `copyLink` button — copies the page's deep link with a transient confirmation.
/// Uses the shared cross-platform clipboard seam; labels reuse the `common.copyLink.*` keys.
struct BrowserNotificationsCopyLinkButton: View {
    @State private var didCopy = false

    private let link = "/notifications/browser"

    var body: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: copy,
            label: {
                Label(
                    didCopy ? "translation.common.copyLink.copied" : "translation.common.copyLink.action",
                    systemImage: didCopy ? "checkmark" : "link"
                )
            }
        )
        .accessibilityLabel(Text("translation.common.copyLink.label"))
        .accessibilityAddTraits(.isButton)
    }

    private func copy() {
        TSClipboard.copy(link)
        didCopy = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            didCopy = false
        }
    }
}

#if DEBUG
    @MainActor
    private func previewModel(
        _ permission: BrowserNotificationsPermission,
        soundOn: Bool = false
    ) -> BrowserNotificationsPageModel {
        var preferences = BrowserNotificationsPreferences()
        preferences.sound.enabled = soundOn
        return BrowserNotificationsPageModel(
            permissionProvider: PreviewNotificationPermissionProvider(fixed: permission),
            store: InMemoryBrowserNotificationsStore(preferences: preferences),
            soundPreviewer: SilentNotificationSoundPreviewer(),
            initialPermission: permission
        )
    }

    #Preview("Granted · sounds on") {
        NavigationStack {
            BrowserNotificationsPage(model: previewModel(.granted, soundOn: true))
        }
    }

    #Preview("Not determined") {
        NavigationStack {
            BrowserNotificationsPage(model: previewModel(.notDetermined))
        }
    }

    #Preview("Denied · dark") {
        NavigationStack {
            BrowserNotificationsPage(model: previewModel(.denied))
        }
        .preferredColorScheme(.dark)
    }

    #Preview("Unsupported") {
        NavigationStack {
            BrowserNotificationsPage(model: previewModel(.unsupported))
        }
    }
#endif
