//
//  EventHistoryTable.swift
//  TeslaSync — P4 feature view · 0042 · EventHistoryTable (Apple)
//
//  The composable Security Event History table — the SwiftUI parity of
//  features/admin/components/security-access/EventHistoryTable.tsx. Binds through
//  `EventHistoryModel` (P1/S8) and renders every state the web source has: loading
//  (initial fetch skeleton) · data (the populated table) · empty (the DataTable's
//  empty message) — plus a native error/retry branch (the P4 states contract's
//  QueryError-equivalent) for a failed parent query. No networking lives here.
//
//  States note: the web leaf is purely presentational (its only hook is
//  `useTranslation`; `history` + `isLoading` arrive as props from its parent's
//  security-history query), so there is no stale/offline chrome at this level —
//  connectivity is the parent query's concern, and a failure flows through `error`.
//

import SwiftUI

/// The composable Security Event History table — the SwiftUI parity of
/// `features/admin/components/security-access/EventHistoryTable.tsx`, binding through
/// `EventHistoryModel` (P1/S8). No networking lives here.
public struct EventHistoryTable: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = EventHistoryDiagnostics.surface

    @State private var model: EventHistoryModel

    public init(model: EventHistoryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.3) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    title
                    content
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The section heading (web `<h2>Security Event History</h2>`).
    private var title: some View {
        Text(verbatim: EHStrings.string("admin.security.eventHistory", "Security Event History"))
            .font(Font.TS.section)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }

    /// The body switches over the resolved render branch (web `isLoading ? skeleton :
    /// table`, with the table's data/empty split + the native error branch).
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            EHLoadingView()
        case .data:
            EHEventsTable(rows: model.rows)
        case .empty:
            EHEmptyView()
        case let .error(message):
            EHErrorView(message: message) { model.refresh() }
        }
    }
}
