//
//  AutomationCard.swift
//  TeslaSync — P4 feature view · 0082 · AutomationCard (Apple)
//
//  The SwiftUI parity of web/src/features/automations/pages/AutomationCard.tsx — a
//  presentational card for one automation with a status badge, a live "Firing"
//  chip, a pin/toggle/kebab control cluster, the run stats, the auto-disabled
//  warning, conflict callouts, and a destructive delete confirmation. It owns no
//  data and performs no I/O (web parity): the parent maps the shared S8
//  `Automation` holder into `AutomationCardData` and supplies the callbacks. On
//  appear it emits the P1/S11 `view.opened` diagnostics event.
//
//  Every P4 state renders: `loading` (skeleton chrome), `empty` (friendly empty
//  card), `error` (message + retry), and `loaded` (the full card, with the
//  live `isFiring` flag downgraded to a stale/offline chip when the SSE freshness
//  says so). No surface is ever hidden behind a null check.
//

import SwiftUI

public struct AutomationCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        AutomationCardSurface.slug
    }

    private let state: AutomationCardState
    private let connection: AutomationLiveConnection
    private let actions: AutomationCardActions
    private let localize: AutomationCardLocalizer
    private let telemetry: any AutomationCardTelemetry
    private let now: () -> Date

    @State private var confirmDelete = false

    /// Designated initialiser (explicit state — used by the load/empty/error
    /// callers and the previews/tests).
    public init(
        state: AutomationCardState,
        connection: AutomationLiveConnection = .live,
        actions: AutomationCardActions,
        localize: AutomationCardLocalizer = .bundle,
        telemetry: any AutomationCardTelemetry = OSLogAutomationCardTelemetry(),
        now: @escaping () -> Date = { Date() }
    ) {
        self.state = state
        self.connection = connection
        self.actions = actions
        self.localize = localize
        self.telemetry = telemetry
        self.now = now
    }

    /// Web-parity convenience: the card for one resolved automation (web props
    /// `automation` + `isFiring` + `vehicleName`, threaded onto `AutomationCardData`).
    public init(
        automation: AutomationCardData,
        connection: AutomationLiveConnection = .live,
        actions: AutomationCardActions,
        localize: AutomationCardLocalizer = .bundle,
        telemetry: any AutomationCardTelemetry = OSLogAutomationCardTelemetry(),
        now: @escaping () -> Date = { Date() }
    ) {
        self.init(
            state: .loaded(automation),
            connection: connection,
            actions: actions,
            localize: localize,
            telemetry: telemetry,
            now: now
        )
    }

    public var body: some View {
        content
            .task { AutomationCardSurface.reportOpen(to: telemetry) }
            .alert(
                Text(verbatim: confirmContent.title),
                isPresented: $confirmDelete
            ) {
                // Web `ConfirmDialog` (danger): Delete (destructive) + Cancel.
                Button(role: .destructive) {
                    if let id = state.automation?.id { actions.onDelete(id) }
                    confirmDelete = false
                } label: {
                    Text(verbatim: confirmContent.confirmLabel)
                }
                Button(role: .cancel) { confirmDelete = false } label: {
                    Text(verbatim: confirmContent.cancelLabel)
                }
            } message: {
                Text(verbatim: confirmContent.message)
            }
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

    private func loadedCard(_ data: AutomationCardData) -> some View {
        let status = AutomationStatus.project(data)
        let chip = AutomationFreshnessChip.project(isFiring: data.isFiring, connection: connection)
        return TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    AutomationCardHeader(data: data, status: status, chip: chip, localize: localize)
                    AutomationCardControls(
                        data: data,
                        actions: actions,
                        localize: localize,
                        onRequestDelete: { confirmDelete = true }
                    )
                }
                AutomationVehicleRow(data: data, localize: localize)
                AutomationStatRow(data: data, now: now(), localize: localize)
                if data.autoDisabled, let reason = data.autoDisabledReason, !reason.isEmpty {
                    AutomationWarningBanner(reason: reason)
                }
                if !data.conflicts.isEmpty {
                    AutomationConflictsList(conflicts: data.conflicts, localize: localize)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(highlight(for: data, status: status))
    }

    /// Web `ring-2 ring-neon-cyan/50` (firing) and `border-red-500/30`
    /// (auto-disabled) accents, layered on the glass panel.
    @ViewBuilder
    private func highlight(for data: AutomationCardData, status: AutomationStatus) -> some View {
        let shape = RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        if data.isFiring, connection == .live {
            shape.strokeBorder(Color.TS.accent.opacity(0.5), lineWidth: 2)
        } else if status == .autoDisabled {
            shape.strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        }
    }

    // MARK: Load / empty / error chrome (every state renders)

    private var loadingCard: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 160, height: 16)
                    TSSkeleton(width: 64, height: 16, cornerRadius: TSRadius.pill)
                    Spacer(minLength: 0)
                    TSSkeleton(width: 80, height: 24, cornerRadius: TSRadius.pill)
                }
                TSSkeleton(width: 220, height: 12)
                TSSkeleton(width: 280, height: 12)
            }
        }
        .accessibilityLabel(Text(verbatim: localize.string("automations.card.loading", "Loading automation…")))
    }

    private var emptyCard: some View {
        TSGlassPanel {
            TSEmptyState(
                title: LocalizedStringKey("automations.card.empty.title"),
                message: LocalizedStringKey("automations.card.empty.message"),
                systemImage: "bolt.badge.automatic"
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func errorCard(_ message: String?) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: LocalizedStringKey("automations.card.error.title"),
                message: message.map { LocalizedStringKey($0) }
                    ?? LocalizedStringKey("automations.card.error.message"),
                onRetry: actions.onRetry
            )
        }
    }

    // MARK: Delete confirmation content

    private var confirmContent: AutomationDeleteConfirm {
        AutomationDeleteConfirm.build(name: state.automation?.name ?? "", localize: localize)
    }
}
