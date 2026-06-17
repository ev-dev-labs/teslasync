//
//  InboxPage.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/Inbox (Apple)
//
//  Native SwiftUI parity of `web/src/features/notifications/pages/InboxPage.tsx`
//  (route `/notifications/inbox`). The web page is a thin `PageContainer` (title + subtitle +
//  `copyLink` + a "View archived" action) wrapper around `<InboxBody archived={false} vehicles
//  rules/>`; this page reproduces that exactly — the localized title + subtitle, a copy-link
//  affordance, the view-archived control, then the already-shipped `InboxBody` feature view (its
//  own P4 parity unit, `TeslaSync/feature-views/InboxBody`) fixed to the active tab through the
//  page model's `InboxBodyModel`. The inbox itself renders every web data state (loading / error
//  / empty / content) — never a blank region.
//
//  All copy resolves from `Localizable.xcstrings` with the web key names
//  (`notifications.inbox.title` / `.subtitle` / `.viewArchived`); the inbox binds through the
//  `@Observable` model (no networking in the view, ADR-004). Adaptive across macOS/iPad (regular)
//  + iPhone (compact) via the shared P2 tokens + P3 components (ADR-002/005/006), with full
//  Dark Mode + Dynamic Type + VoiceOver support (ADR-015).
//

import SwiftUI

public struct InboxPage: View {
    @State private var model: InboxPageModel
    private let onNavigate: (AppRoute) -> Void

    public init(model: InboxPageModel, onNavigate: @escaping (AppRoute) -> Void = { _ in }) {
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
        .task {
            await model.load()
        }
        .refreshable {
            model.refresh()
        }
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
            viewArchivedButton
            CopyLinkButton(url: { shareURL })
        }
        .accessibilityElement(children: .contain)
    }

    /// Web `actions` slot: `<Link to="/notifications/archived"><Archive/> View archived</Link>`.
    private var viewArchivedButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { onNavigate(model.viewArchivedRoute) },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "archivebox")
                        .imageScale(.small)
                        .accessibilityHidden(true)
                    Text(model.viewArchivedKey)
                }
            }
        )
        .accessibilityLabel(Text(model.viewArchivedKey))
    }
}

#if DEBUG
    #Preview("Loaded") {
        InboxPage(model: InboxPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        InboxPage(
            model: InboxPageModel(
                source: InMemoryInboxSource(
                    initial: InboxUpdate(flatStatus: .empty, groupStatus: .empty, updatedAt: Date())
                )
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        InboxPage(
            model: InboxPageModel(
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
