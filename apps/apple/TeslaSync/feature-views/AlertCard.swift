//
//  AlertCard.swift
//  TeslaSync — P4 feature view · 0179 · AlertCard (Apple)
//
//  The SwiftUI parity of web/src/features/notifications/components/AlertCard.tsx —
//  a single alert row with a severity icon box, the title + message drill-through
//  block, the unread status dot, the meta chips (relative time, severity, type,
//  the acknowledged badge, and the live freshness chip), and the trailing action
//  cluster (View context / Audit timeline / Acknowledge|Reopened / Mark read). It
//  owns no data and performs no I/O (web parity): the parent maps the shared S8
//  `Alert` holder into `AlertCardData` and supplies the callbacks. On appear it
//  emits the P1/S11 `view.opened` diagnostics event.
//
//  Every P4 state renders: `loading` (skeleton chrome), `empty` (friendly empty
//  card), `error` (message + retry), and `loaded` (the full card, with the inbox
//  stream's stale/offline freshness surfaced as a chip). No surface is ever hidden
//  behind a null check.
//

import SwiftUI

public struct AlertCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        AlertCardSurface.slug
    }

    private let state: AlertCardState
    private let connection: AlertLiveConnection
    private let actions: AlertCardActions
    private let localize: AlertCardLocalizer
    private let telemetry: any AlertCardTelemetry
    private let now: () -> Date

    /// Designated initialiser (explicit state — used by the load/empty/error
    /// callers and the previews/tests).
    public init(
        state: AlertCardState,
        connection: AlertLiveConnection = .live,
        actions: AlertCardActions,
        localize: AlertCardLocalizer = .bundle,
        telemetry: any AlertCardTelemetry = OSLogAlertCardTelemetry(),
        now: @escaping () -> Date = { Date() }
    ) {
        self.state = state
        self.connection = connection
        self.actions = actions
        self.localize = localize
        self.telemetry = telemetry
        self.now = now
    }

    /// Web-parity convenience: the card for one resolved alert (web prop `alert`,
    /// threaded onto `AlertCardData`).
    public init(
        alert: AlertCardData,
        connection: AlertLiveConnection = .live,
        actions: AlertCardActions,
        localize: AlertCardLocalizer = .bundle,
        telemetry: any AlertCardTelemetry = OSLogAlertCardTelemetry(),
        now: @escaping () -> Date = { Date() }
    ) {
        self.init(
            state: .loaded(alert),
            connection: connection,
            actions: actions,
            localize: localize,
            telemetry: telemetry,
            now: now
        )
    }

    public var body: some View {
        content
            .task { AlertCardSurface.reportOpen(to: telemetry) }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            loadingCard
        case .empty:
            emptyCard
        case let .error(message):
            errorCard(message)
        case let .loaded(data):
            loadedCard(data)
        }
    }

    // MARK: Loaded card (web card body)

    private func loadedCard(_ data: AlertCardData) -> some View {
        let severity = AlertSeverity.normalize(data.severity)
        let drill = AlertDrillthrough.resolve(data)
        let freshness = AlertFreshnessChip.project(connection)
        let ackAction = AlertAckAction.resolve(data)
        let currentTime = now()
        return TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                AlertCardIconBox(type: data.type, severity: severity)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    AlertCardHeaderRow(
                        data: data,
                        severity: severity,
                        drill: drill,
                        now: currentTime,
                        localize: localize,
                        onViewContext: actions.onViewContext
                    )
                    AlertCardMetaRow(
                        data: data,
                        severity: severity,
                        freshness: freshness,
                        now: currentTime,
                        localize: localize
                    )
                    AlertCardActionsRow(
                        data: data,
                        drill: drill,
                        ackAction: ackAction,
                        actions: actions,
                        localize: localize
                    )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(unreadHighlight(for: data, severity: severity))
    }

    /// Web unread accent (`tokens.border` + soft `tokens.bg`) layered on the glass
    /// panel when the alert is unread.
    @ViewBuilder
    private func unreadHighlight(for data: AlertCardData, severity: AlertSeverity) -> some View {
        if !data.isRead {
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(severity.tone.color.opacity(0.4), lineWidth: 1)
        }
    }

    // MARK: Load / empty / error chrome (every state renders)

    private var loadingCard: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSSkeleton(width: 40, height: 40, cornerRadius: TSRadius.md)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 200, height: 14)
                    TSSkeleton(width: 280, height: 12)
                    HStack(spacing: TSSpacing.sm) {
                        TSSkeleton(width: 56, height: 16, cornerRadius: TSRadius.pill)
                        TSSkeleton(width: 72, height: 16, cornerRadius: TSRadius.pill)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityLabel(Text(verbatim: localize.string("alerts.card.loading", "Loading alert…")))
    }

    private var emptyCard: some View {
        TSGlassPanel {
            TSEmptyState(
                title: LocalizedStringKey("alerts.card.empty.title"),
                message: LocalizedStringKey("alerts.card.empty.message"),
                systemImage: "bell.slash"
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func errorCard(_ message: String?) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: LocalizedStringKey("alerts.card.error.title"),
                message: message.map { LocalizedStringKey($0) }
                    ?? LocalizedStringKey("alerts.card.error.message"),
                onRetry: actions.onRetry
            )
        }
    }
}
