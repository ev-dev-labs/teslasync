//
//  ReferenceLinksSection.swift
//  TeslaSync — P4 feature view · 0007 · ReferenceLinksSection (Apple)
//
//  The developer reference-links section — the SwiftUI parity of
//  features/admin/components/devtools/ReferenceLinksSection.tsx. Renders the web
//  source's responsive grid of external documentation cards plus the P4 leaf
//  contract states. Binds through `ReferenceLinksModel` (P1/S8); no networking lives
//  here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton card grid.
//    • empty    — catalog resolved with no entries → friendly empty state, never a
//                 blank grid.
//    • error    — fetch failure → retry affordance (web `QueryError` peer).
//    • data     — the responsive grid of reference-link cards (the web render).
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - ReferenceLinksSection (the feature surface)

/// The developer reference-links section — the SwiftUI parity of
/// `features/admin/components/devtools/ReferenceLinksSection.tsx`. Renders the web
/// grid of external documentation cards and every P4 leaf state, binding through
/// `ReferenceLinksModel`. The web source is an anonymous grid (no header), so the
/// native surface adds only the freshness chip + connectivity banner when the
/// catalog is not live.
public struct ReferenceLinksSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ReferenceLinksSection"

    @State private var model: ReferenceLinksModel

    public init(model: ReferenceLinksModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                connectivityHeader
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ReferenceLinksStrings.string(
            "devtools.ref.a11y", "Reference links"
        )))
    }
}

// MARK: - Connectivity header (freshness chip + banner)

private extension ReferenceLinksSection {
    var connectivityHeader: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Spacer(minLength: TSSpacing.sm)
                ReferenceLinksFreshnessChip(connection: model.connection)
            }
            ReferenceLinksConnectivityBanner(connection: model.connection) {
                model.refresh()
            }
        }
    }
}

// MARK: - Content states (web grid + the P4 leaf contract)

private extension ReferenceLinksSection {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            ReferenceLinksLoadingView()
        case .empty:
            ReferenceLinksEmptyView()
        case let .error(message):
            ReferenceLinksErrorView(message: message) { model.refresh() }
        case .data:
            ReferenceLinksGrid(links: model.links)
        }
    }
}
