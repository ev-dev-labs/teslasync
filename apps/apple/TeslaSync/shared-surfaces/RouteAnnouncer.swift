//
//  RouteAnnouncer.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  The route-change announcer surface — the SwiftUI parity of `components/a11y/RouteAnnouncer.tsx`.
//  The web component renders a single visually-hidden polite live region that, on every route
//  change after the first, carries the new page's title so screen-reader users hear that the page
//  changed (WCAG 2.4.2). The native parity surface presents that region visibly as a route
//  announcements inspector — the live region card plus the recent-navigation log — while
//  performing the real assistive-technology voicing through the presenter seam. Binds through
//  `RouteAnnouncerModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton region card.
//    • empty    — resolved, nothing announced yet → friendly empty state (the web region is
//                 silent on first paint), never a blank box.
//    • error    — source feed failure → retry affordance (web `QueryError` peer).
//    • data     — the live region card over the recent-navigation log.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the body with
//                 a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - RouteAnnouncer (the shared surface)

/// The route-change announcer surface — the SwiftUI parity of `components/a11y/RouteAnnouncer.tsx`.
/// Renders every state plus the P4 leaf freshness states, binding through `RouteAnnouncerModel`.
public struct RouteAnnouncer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RouteAnnouncer"

    @State private var model: RouteAnnouncerModel

    public init(model: RouteAnnouncerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production route centre + the real assistive-technology
    /// presenter — the parity of the web `<RouteAnnouncer>` mounting once and subscribing to the
    /// router location.
    public init() {
        _model = State(initialValue: RouteAnnouncerModel(
            source: LiveRouteAnnouncerSource(),
            presenter: AccessibilityRouteAnnouncementPresenter()
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content
            if model.connection != .live {
                RouteAnnouncerFreshnessChip(connection: model.connection) {
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
            Text(verbatim: RouteAnnouncerStrings.title)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: RouteAnnouncerStrings.subtitle)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            RouteAnnouncerLoadingView()
        case .empty:
            RouteAnnouncerEmptyView()
        case let .error(message):
            RouteAnnouncerErrorView(message: message) { model.refresh() }
        case .data:
            RouteAnnouncerDataView(resolved: model.resolved)
        }
    }
}
