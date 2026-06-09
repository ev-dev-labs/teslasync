//
//  FrontendErrorsCard.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  The last-hour rolling summary of browser-reported frontend errors — the SwiftUI parity of
//  features/system/components/status/FrontendErrorsCard.tsx. Surfaces the total error count plus the
//  top offenders (component + route + count) so operators can see whether the SPA is misbehaving,
//  bound through `FrontendErrorsModel` (P1/S8). No networking lives here; the freshness chip + banner
//  reflect the bound source's live-state.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → two skeleton bars (web `isLoading`).
//    • error    — no data / fetch failure → retryable "Unable to load frontend error summary."
//                 (web `!data`, upgraded with a retry per the P4 leaf contract).
//    • empty    — data resolved, no offenders → header + headline total + "No frontend errors
//                 reported in the last hour." (web `top.length === 0`), never a blank box.
//    • data     — header + headline total + the top-offender list (web `top.length > 0`).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - FrontendErrorsCard (the feature surface)

/// The operator-grade frontend-errors summary card — the SwiftUI parity of
/// `features/system/components/status/FrontendErrorsCard.tsx`. Renders every state from the web
/// source plus the P4 leaf freshness states, binding through `FrontendErrorsModel`.
public struct FrontendErrorsCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "FrontendErrorsCard"

    @State private var model: FrontendErrorsModel

    public init(model: FrontendErrorsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        card
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }
}

// MARK: - Card chrome

private extension FrontendErrorsCard {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                FrontendErrorsConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: FrontendErrorsStrings.string(
            "frontendErrors.title",
            "Frontend errors (last hour)"
        )))
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            FrontendErrorsHeader()
            Spacer(minLength: TSSpacing.sm)
            FrontendErrorsFreshnessChip(connection: model.connection)
            FrontendErrorsRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension FrontendErrorsCard {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            FrontendErrorsLoadingView()
        case let .error(message):
            FrontendErrorsErrorView(message: message) { model.refresh() }
        case .empty:
            summaryBody { FrontendErrorsNoErrorsBody() }
        case .data:
            summaryBody { FrontendErrorsOffenderList(offenders: model.offenders) }
        }
    }

    /// The shared header-total chrome wrapping either the no-errors message (empty) or the offender
    /// list (data) — both web data branches share the headline total above the body.
    func summaryBody(@ViewBuilder _ body: @escaping () -> some View) -> some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                FrontendErrorsHeadline(totalText: model.totalText)
                body()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
