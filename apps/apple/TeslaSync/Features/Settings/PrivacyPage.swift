//
//  PrivacyPage.swift
//  TeslaSync — P4-APPLE P7 · page:settings/Privacy (Apple)
//
//  Native SwiftUI / HIG parity of `web/src/features/settings/pages/PrivacyPage.tsx` (web route
//  `/account/privacy`): the web `PageContainer` chrome (title + subtitle + the `copyLink`
//  affordance) wrapping `<PrivacySection/>` — the recently-viewed-pages control (count + a
//  silence-aware destructive Clear, web `<ConfirmDialog silenceKey>`) and the always-rendered
//  cookie/analytics consent control (Re-grant / Withdraw / Reset). Adaptive across macOS (regular)
//  and iOS (compact / regular) per ADR-002/006; the page scrolls and each region reflows.
//
//  All copy resolves from `Localizable.xcstrings` under the web key names; data binds through the
//  `@Observable` `PrivacyPageModel` (no persistence logic in the view body, ADR-004). The two parity
//  strings — `account.privacy.title` / `account.privacy.subtitle` — render here as the page title +
//  subtitle.
//

import SwiftUI

struct PrivacyPage: View {
    @State private var model: PrivacyPageModel
    @State private var showClearConfirm = false
    @State private var didCopyLink = false

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    init(model: PrivacyPageModel = PrivacyPageModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                PrivacySectionCard(
                    model: model,
                    isCompact: isCompact,
                    onRequestClear: requestClear
                )
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 880, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("account.privacy.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .task { await model.load() }
            .confirmationDialog(
                Text("translation.recentPages.clearConfirmTitle"),
                isPresented: $showClearConfirm,
                titleVisibility: .visible
            ) {
                Button(role: .destructive) {
                    model.clearRecentPages()
                } label: {
                    Text("translation.recentPages.clearConfirmCta")
                }
                Button(role: .destructive) {
                    model.clearRecentPages(silencingFutureConfirms: true)
                } label: {
                    Text("translation.confirm.silence.checkbox")
                }
                Button(role: .cancel) {} label: {
                    Text("translation.common.cancel")
                }
            } message: {
                Text("translation.recentPages.clearConfirmBody")
            }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Clear flow (web `<ConfirmDialog silenceKey>` auto-resolve)

    /// Web Clear press: skip straight to the wipe when the user previously silenced this action,
    /// otherwise present the destructive confirmation.
    private func requestClear() {
        if model.shouldConfirmClear() {
            showClearConfirm = true
        } else {
            model.clearRecentPages()
        }
    }

    // MARK: - Header (web `PageContainer` title + subtitle + copyLink)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    copyLinkButton
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    copyLinkButton
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("account.privacy.title")
            Text("account.privacy.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Copy-link affordance (web `PageContainer copyLink`)

    private var copyLinkButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: copyLink,
            label: {
                Label(
                    didCopyLink ? "translation.common.copyLink.copied" : "translation.common.copyLink.action",
                    systemImage: didCopyLink ? "checkmark" : "link"
                )
            }
        )
        .accessibilityLabel(Text("translation.common.copyLink.label"))
        .accessibilityAddTraits(.isButton)
    }

    private func copyLink() {
        TSClipboard.copy(model.shareURL)
        didCopyLink = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            didCopyLink = false
        }
    }
}

#if DEBUG
    @MainActor
    private func previewModel(
        recentEntries: Int = 12,
        consent: AccountPrivacyConsentState = .unknown,
        requiresConsent: Bool = false
    ) -> PrivacyPageModel {
        PrivacyPageModel(
            recentPages: AccountPrivacyInMemoryRecentPagesStore(entries: recentEntries),
            consentStore: AccountPrivacyInMemoryConsentStore(state: consent),
            silenceStore: AccountPrivacyInMemoryConfirmSilenceStore(),
            requirementProvider: FixedConsentRequirementProvider(value: requiresConsent),
            toasts: ToastCenter()
        )
    }

    #Preview("Default · undecided") {
        NavigationStack {
            PrivacyPage(model: previewModel())
        }
        .teslaSyncTheme()
    }

    #Preview("No recent pages · consent accepted") {
        NavigationStack {
            PrivacyPage(model: previewModel(recentEntries: 0, consent: .accepted))
        }
        .teslaSyncTheme()
    }

    #Preview("Consent required · declined · dark") {
        NavigationStack {
            PrivacyPage(model: previewModel(consent: .declined, requiresConsent: true))
        }
        .teslaSyncTheme()
        .preferredColorScheme(.dark)
    }
#endif
