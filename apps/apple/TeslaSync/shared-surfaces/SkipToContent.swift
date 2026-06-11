//
//  SkipToContent.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  The skip-navigation surface — the SwiftUI parity of `components/feedback/SkipToContent.tsx`.
//  The web component renders one visually-hidden anchor (WCAG 2.4.1 Bypass Blocks) that, on
//  activation, jumps focus + scroll to the page's `<main id="main-content">` landmark so
//  keyboard / assistive-technology users do not have to tab through the 50+ sidebar items to
//  reach the body. The native parity surface presents that skip affordance visibly — the hero
//  "Skip to main content" link plus any secondary landmarks — while performing the real
//  focus move through the coordinator seam. Binds through `SkipToContentModel` (P1/S8); no
//  networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton skip-link rows.
//    • empty    — resolved with no landmark registered → friendly empty state, never blank.
//    • error    — landmark feed failure → retry affordance (web `QueryError` peer).
//    • data     — the hero skip link over any secondary landmark links.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the body
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - SkipToContent (the shared surface)

/// The skip-navigation surface — the SwiftUI parity of `components/feedback/SkipToContent.tsx`.
/// Renders every state plus the P4 leaf freshness states, binding through `SkipToContentModel`.
public struct SkipToContent: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SkipToContent"

    @State private var model: SkipToContentModel

    public init(model: SkipToContentModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production landmark registry + the real assistive
    /// technology focus coordinator — the parity of the web `<SkipToContent>` mounting once and
    /// targeting the page's `#main-content` landmark.
    public init() {
        _model = State(initialValue: SkipToContentModel(
            source: LiveSkipToContentSource(),
            focuser: AccessibilitySkipFocuser()
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content
            if model.connection != .live {
                SkipFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: SkipToContentStrings.string("skip.title", "Skip navigation"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: SkipToContentStrings.string(
                "skip.subtitle", "Bypass the navigation and jump to the main content"
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            SkipToContentLoadingView()
        case .empty:
            SkipToContentEmptyView()
        case let .error(message):
            SkipToContentErrorView(message: message) { model.refresh() }
        case .data:
            SkipToContentDataView(resolved: model.resolved) { target in
                model.skip(to: target)
            }
        }
    }
}
