//
//  SignalHistoryTable.swift
//  TeslaSync — P4 feature view · 0269 · SignalHistoryTable (Apple)
//
//  The composable signal-history table — the SwiftUI parity of
//  features/telemetry/components/SignalHistoryTable.tsx. Renders the web source's
//  regions (the Activity-icon header with the optional "Page X · N total" meta, the
//  paginated value table with raw-payload row expansion) inside a glass panel, plus the
//  P4 leaf contract states. Binds through `SignalHistoryModel` (P1/S8); no networking
//  lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web `loading ? <Skeleton/>`).
//    • data     — the populated DataTable + Pagination (web `rows.length > 0`).
//    • empty    — query resolved with no rows → the web `EmptyState` ("No data"), never
//                 a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer; the web
//                 leaf has no error branch — its parent owns the query — so this is
//                 native chrome for a failed parent fetch surfaced via the source).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

/// The composable signal-history table — the SwiftUI parity of
/// `features/telemetry/components/SignalHistoryTable.tsx`, binding through
/// `SignalHistoryModel` (P1/S8). No networking lives here.
public struct SignalHistoryTable: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SignalHistoryDiagnostics.surface

    @State private var model: SignalHistoryModel

    public init(model: SignalHistoryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    header
                    if model.connection != .live {
                        connectivityBanner
                    }
                    content
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `<Activity/> {title}` + meta + freshness)

private extension SignalHistoryTable {
    var title: String {
        model.resolved.title ?? SHStrings.string("telemetry.signalHistory.title", "Signal Data")
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if model.resolved.showHeaderMeta {
                headerMeta
            }
            freshnessChip
            refreshButton
        }
    }

    /// Web header meta: `{Page} {page} · {fmtInt(totalRows)} {total}`.
    var headerMeta: some View {
        let text = SignalHistoryAccessibility.headerMeta(
            page: model.resolved.page,
            totalRows: model.resolved.totalRows,
            SHStrings.string
        )
        return Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .accessibilityLabel(Text(verbatim: text))
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SHStrings.string("telemetry.signalHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SHStrings.string("telemetry.signalHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SHStrings.string("telemetry.signalHistory.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: SHStrings.string("telemetry.signalHistory.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? SHStrings.string("telemetry.signalHistory.offlineBanner", "Offline — showing last known data")
            : SHStrings.string("telemetry.signalHistory.staleBanner", "Reconnecting — data may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web shell + the P4 leaf contract)

private extension SignalHistoryTable {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            SHLoadingView()
        case .data:
            SHDataView(resolved: model.resolved) { page in model.goToPage(page) }
        case .empty:
            SHEmptyView()
        case let .error(message):
            SHErrorView(message: message) { model.refresh() }
        }
    }
}
