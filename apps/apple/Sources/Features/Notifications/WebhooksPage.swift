import SwiftUI

/// Native SwiftUI parity of `web/src/features/notifications/pages/WebhooksPage.tsx`
/// (route `/notifications/webhooks`). The web page is a thin `PageContainer`
/// (title + subtitle + `copyLink`) wrapper around `<WebhookChannelsSection/>`; this page
/// reproduces that exactly — the localized title + subtitle + a copy-link affordance, then
/// hosts the already-shipped `WebhookChannelsSection` feature view (its own P4 parity unit,
/// `TeslaSync/feature-views/WebhookChannelsSection`) driven by the page model's
/// `WebhookChannelsSectionModel`. The section itself renders every web data state
/// (loading / empty / error / stale / offline / content) — never a blank region.
///
/// All copy resolves from `Localizable.xcstrings` with the web key names
/// (`notifications.webhooks.title` / `.subtitle`); the section binds through the `@Observable`
/// model (no networking in the view, ADR-004). Adaptive across macOS/iPad (regular) + iPhone
/// (compact) via the shared P2 tokens + P3 components (ADR-002/006).
public struct WebhooksPage: View {
    @State private var model: WebhooksPageModel

    public init(model: WebhooksPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                WebhookChannelsSection(model: model.section)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1024, alignment: .leading) // web `PageContainer` centered column
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    // MARK: - Header (web PageContainer title + subtitle + copyLink)

    private var header: some View {
        let shareURL = model.shareURL
        return HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle(model.titleKey)
                Text(model.subtitleKey)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            CopyLinkButton(url: { shareURL })
        }
        .accessibilityElement(children: .contain)
    }
}

#if DEBUG
    #Preview("Loaded") {
        WebhooksPage(model: WebhooksPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        WebhooksPage(
            model: WebhooksPageModel(
                source: InMemoryWebhookChannelsSource(
                    initial: WebhookChannelsUpdate(status: .loaded, channels: [], connection: .live)
                )
            )
        )
        .teslaSyncTheme()
    }
#endif
