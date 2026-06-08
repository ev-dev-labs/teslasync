//
//  WindowStatusDetail.swift
//  TeslaSync — P4 feature view · 0049 · WindowStatusDetail (Apple)
//
//  The composable Window Status Detail feature view — the SwiftUI parity of
//  features/admin/components/security-access/WindowStatusDetail.tsx. Binds through
//  `WindowStatusModel` (no networking in the view) and renders every state: loading
//  (skeleton grid) · error (QueryError + retry) · empty (the four cards, all Unknown,
//  plus a friendly note) · data (the four toned cards), with the live-state freshness
//  chip + stale/offline banner (ADR-013) layered on top.
//

import SwiftUI

/// The composable Window Status Detail surface — the SwiftUI parity of
/// `features/admin/components/security-access/WindowStatusDetail.tsx`. Renders every
/// state, binding through `WindowStatusModel` (P1/S8). No networking lives here.
public struct WindowStatusDetail: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "WindowStatusDetail"

    @State private var model: WindowStatusModel

    public init(model: WindowStatusModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.15) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                WindowStatusHeader(title: title, connection: model.connection)
                if model.connection != .live {
                    WindowStatusConnectivityBanner(connection: model.connection)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            WindowStatusLoadingGrid()
        case let .error(message):
            WindowStatusErrorView(message: message) { model.refresh() }
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                summaryRow
                WindowStatusGrid(cells: model.cells)
                WindowStatusEmptyNote()
            }
        case .data:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                summaryRow
                WindowStatusGrid(cells: model.cells)
            }
        }
    }

    private var summaryRow: some View {
        HStack {
            WindowStatusSummaryChip(allClosed: model.allClosed, notClosedCount: model.notClosedCount)
            Spacer(minLength: 0)
        }
    }

    /// Web `t('admin.security.windowDetail', 'Window Status Detail')`.
    private var title: String {
        WindowStatusStrings.string("admin.security.windowDetail", "Window Status Detail")
    }
}
