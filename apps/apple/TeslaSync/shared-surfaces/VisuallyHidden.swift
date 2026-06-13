//
//  VisuallyHidden.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  The visually-hidden utility surface — the SwiftUI parity of `components/a11y/VisuallyHidden.tsx`.
//  The web component renders content invisible to sighted users but exposed to assistive
//  technology, in three modes (the bare `sr-only` default, a `liveRegion` pairing, and a
//  `focusable` skip-link), element-polymorphic via `as`. The native parity surface presents
//  those modes visibly as an inspector — the hidden sample, the polite + assertive live regions
//  (fed by the announcer), the real reveal-on-focus skip link, and the element-kind row — while
//  performing the real assistive-technology voicing through the presenter seam. Binds through
//  `VisuallyHiddenModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton mode cards.
//    • empty    — resolved with nothing voiced yet → full catalog + friendly empty note.
//    • error    — source feed failure → retry affordance (web `QueryError` peer).
//    • data     — the mode catalog over the recent-announcement log.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the body
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - VisuallyHidden (the shared surface)

/// The visually-hidden utility surface — the SwiftUI parity of `components/a11y/VisuallyHidden.tsx`.
/// Renders every state plus the P4 leaf freshness states, binding through `VisuallyHiddenModel`.
public struct VisuallyHidden: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VisuallyHidden"

    @State private var model: VisuallyHiddenModel

    public init(model: VisuallyHiddenModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production announcer source + the real
    /// assistive-technology presenter — the parity of the web component mounting and binding to
    /// the shared `useAnnouncer` feed.
    public init() {
        _model = State(initialValue: VisuallyHiddenModel(
            source: LiveVisuallyHiddenSource(),
            presenter: AccessibilityVisuallyHiddenPresenter()
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content
            if model.connection != .live {
                VisuallyHiddenFreshnessChip(connection: model.connection) {
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
            Text(verbatim: VisuallyHiddenStrings.string("vh.title", "Visually hidden"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: VisuallyHiddenStrings.string(
                "vh.subtitle", "Content exposed to assistive technology without a visual footprint"
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
            VisuallyHiddenLoadingView()
        case .empty:
            VisuallyHiddenEmptyView(resolved: model.resolved)
        case let .error(message):
            VisuallyHiddenErrorView(message: message) { model.refresh() }
        case .data:
            VisuallyHiddenDataView(resolved: model.resolved)
        }
    }
}
