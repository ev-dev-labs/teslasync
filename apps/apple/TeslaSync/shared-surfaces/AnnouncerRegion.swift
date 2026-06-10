//
//  AnnouncerRegion.swift
//  TeslaSync — P4 shared surface · 0001 · AnnouncerRegion (Apple)
//
//  The global screen-reader announcer surface — the SwiftUI parity of
//  `components/a11y/AnnouncerRegion.tsx`. The web component renders two visually-hidden live
//  regions (one polite, one assertive) that `subscribeAnnouncer` writes into, voicing each
//  message through `aria-live`. The native parity surface presents those same two regions
//  visibly as an announcements inspector — the polite + assertive region cards plus the recent
//  announcement log — while performing the real assistive-technology voicing through the
//  presenter seam. Binds through `AnnouncerRegionModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton region cards.
//    • empty    — resolved with nothing voiced yet → friendly empty state, never a blank box.
//    • error    — source feed failure → retry affordance (web `QueryError` peer).
//    • data     — the two live regions over the recent-announcement log.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the body
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AnnouncerRegion (the shared surface)

/// The global screen-reader announcer surface — the SwiftUI parity of
/// `components/a11y/AnnouncerRegion.tsx`. Renders every state plus the P4 leaf freshness
/// states, binding through `AnnouncerRegionModel`.
public struct AnnouncerRegion: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AnnouncerRegion"

    @State private var model: AnnouncerRegionModel

    public init(model: AnnouncerRegionModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production announcer + the real assistive-technology
    /// presenter — the parity of the web `<AnnouncerRegion>` mounting once and subscribing to
    /// the shared announcer.
    public init() {
        _model = State(initialValue: AnnouncerRegionModel(
            source: LiveAnnouncerRegionSource(),
            presenter: AccessibilityAnnouncementPresenter()
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content
            if model.connection != .live {
                AnnouncerFreshnessChip(connection: model.connection) {
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
            Text(verbatim: AnnouncerRegionStrings.string("announcer.title", "Announcements"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: AnnouncerRegionStrings.string(
                "announcer.subtitle", "Live screen-reader announcements voiced by the app"
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
            AnnouncerLoadingView()
        case .empty:
            AnnouncerEmptyView()
        case let .error(message):
            AnnouncerErrorView(message: message) { model.refresh() }
        case .data:
            AnnouncerDataView(resolved: model.resolved)
        }
    }
}
