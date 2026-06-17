//
//  QuietHoursPage.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/QuietHours (Apple)
//
//  Native SwiftUI / HIG parity of `web/src/features/notifications/pages/QuietHoursPage.tsx`
//  (web route `/notifications/quiet-hours`). The web page is a thin `PageContainer` (title +
//  subtitle + `copyLink`) wrapper that renders the `<AIQuietHoursSuggestion/>` advisor above the
//  `<QuietHoursPanel/>` schedule editor, threading the advisor's "Apply to form" proposal into the
//  panel's draft (the propose-only seed hand-off, ADR-015 §I8). This page reproduces that exactly —
//  the localized title + subtitle + a copy-link affordance, then both already-shipped child surfaces
//  (their own P4 parity units — `shared-surfaces/AIQuietHoursSuggestion` + `feature-views/
//  QuietHoursPanel`) driven by the page model's `advisor` + `panel`. Each surface renders every web
//  data state (loading / empty / error / stale / offline / content) itself — never a blank region.
//
//  All copy resolves from `Localizable.xcstrings` with the web key names
//  (`notifications.quietHours.title` / `.subtitle`); the surfaces bind through the `@Observable`
//  page model (no networking in the view, ADR-004). Adaptive across macOS/iPad (regular) + iPhone
//  (compact) via the shared P2 tokens + P3 components (ADR-002/006/013/014/015).
//

import SwiftUI

public struct QuietHoursPage: View {
    @State private var model: QuietHoursPageModel

    public init(model: QuietHoursPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                AIQuietHoursSuggestion(model: model.advisor)
                QuietHoursPanel(model: model.panel)
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
        QuietHoursPage(model: QuietHoursPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        QuietHoursPage(
            model: QuietHoursPageModel(
                panelSource: InMemoryQuietHoursSource(
                    initial: QuietHoursUpdate(status: .loaded, items: [], connection: .live)
                )
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        QuietHoursPage(
            model: QuietHoursPageModel(
                panelSource: InMemoryQuietHoursSource(
                    initial: QuietHoursUpdate(status: .failed("Couldn’t reach the server."), items: [])
                )
            )
        )
        .teslaSyncTheme()
    }
#endif
