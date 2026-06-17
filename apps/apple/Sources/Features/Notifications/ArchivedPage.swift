import SwiftUI

/// Native SwiftUI parity of `web/src/features/notifications/pages/ArchivedPage.tsx`
/// (route `/notifications/archived`). The web page is a thin `PageContainer` (title + subtitle +
/// `copyLink` + a "Back to inbox" action) wrapper around `<InboxBody archived vehicles rules/>`;
/// this page reproduces that exactly — the localized title + subtitle, a copy-link affordance,
/// the back-to-inbox control, then the already-shipped `InboxBody` feature view (its own P4
/// parity unit, `TeslaSync/feature-views/InboxBody`) fixed to the archived tab through the page
/// model's `InboxBodyModel`. The inbox itself renders every web data state (loading / error /
/// empty / content) and swaps the bulk-action set Archive → Restore — never a blank region.
///
/// All copy resolves from `Localizable.xcstrings` with the web key names
/// (`notifications.archived.title` / `.subtitle` / `.backToInbox`); the inbox binds through the
/// `@Observable` model (no networking in the view, ADR-004). Adaptive across macOS/iPad (regular)
/// + iPhone (compact) via the shared P2 tokens + P3 components (ADR-002/006).
public struct ArchivedPage: View {
    @State private var model: ArchivedPageModel
    private let onNavigate: (AppRoute) -> Void

    public init(model: ArchivedPageModel, onNavigate: @escaping (AppRoute) -> Void = { _ in }) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                InboxBody(model: model.inbox)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1024, alignment: .leading) // web `PageContainer` centered column
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    // MARK: - Header (web PageContainer title + subtitle + actions + copyLink)

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
            backToInboxButton
            CopyLinkButton(url: { shareURL })
        }
        .accessibilityElement(children: .contain)
    }

    /// Web `actions` slot: `<Link to="/notifications/inbox"><ArrowLeft/> Back to inbox</Link>`.
    private var backToInboxButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { onNavigate(model.backToInboxRoute) },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.left")
                        .imageScale(.small)
                        .accessibilityHidden(true)
                    Text(model.backToInboxKey)
                }
            }
        )
        .accessibilityLabel(Text(model.backToInboxKey))
    }
}

#if DEBUG
    #Preview("Loaded") {
        ArchivedPage(model: ArchivedPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ArchivedPage(
            model: ArchivedPageModel(
                source: InMemoryInboxSource(
                    initial: InboxUpdate(flatStatus: .empty, groupStatus: .empty, updatedAt: Date())
                )
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        ArchivedPage(
            model: ArchivedPageModel(
                source: InMemoryInboxSource(
                    initial: InboxUpdate(
                        flatStatus: .failed("Network unavailable"),
                        groupStatus: .failed("Network unavailable")
                    )
                )
            )
        )
        .teslaSyncTheme()
    }
#endif
