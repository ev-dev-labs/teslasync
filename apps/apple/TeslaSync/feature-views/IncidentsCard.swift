//
//  IncidentsCard.swift
//  TeslaSync — P4 feature view · 0247 · IncidentsCard (Apple)
//
//  The composed IncidentsCard surface — the SwiftUI parity of
//  features/system/components/status/IncidentsCard.tsx. The web component renders the
//  active-incidents block above the status chip bar: a header (alert glyph + "Active
//  incidents" + a count badge + a ghost "Log incident" CTA) over a list of compact incident
//  rows, each a link into the per-incident post-mortem timeline. The "Log incident" CTA mounts
//  the manual `IncidentForm` dialog.
//
//  This surface reproduces that composition over the shared P1/S8 read seam (`IncidentsSource`,
//  web `useIncidents({ activeOnly: true })`): the always-visible header, the per-phase body, the
//  staggered rows on a per-minute display clock, and the `IncidentForm` presented as a sheet
//  whose dismissal refetches the list (web list invalidation on create). It binds through
//  `IncidentsCardModel` (no view I/O) and emits the P1/S11 `view.opened` event for the surface
//  slug `IncidentsCard` on appear.
//
//  Parity note (documented, intentional — not silent drift): the web card returns `null` when
//  there are no active incidents; the native surface renders a labeled empty state and keeps the
//  amber "alarm" treatment (ring + tint + count badge) only while incidents are present, per the
//  P4 "every state MUST render — no hidden surfaces" mandate (the ActiveSessionsSection
//  precedent). Every read state — loading / empty / error+retry / content, with the stale +
//  offline branches — renders real chrome.
//

import SwiftUI

/// The active-incidents block — the SwiftUI parity of the web `IncidentsCard`, binding through
/// `IncidentsCardModel` (P1/S8).
public struct IncidentsCard: View {
    @State private var model: IncidentsCardModel
    private let onOpenIncident: (ActiveIncident) -> Void

    /// Binds an explicitly constructed model (production wires it over the shared P1/S8
    /// incidents holder + create seam; previews/tests inject in-memory sources). `onOpenIncident`
    /// is the host's navigation into the incident timeline (web `/system-status/incidents/:id`).
    public init(
        model: IncidentsCardModel,
        onOpenIncident: @escaping (ActiveIncident) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onOpenIncident = onOpenIncident
    }

    /// Convenience: builds the model from the read + create seams (web `useIncidents` +
    /// `useCreateIncident`).
    public init(
        source: any IncidentsSource,
        incidentCreator: any IncidentCreating,
        telemetry: any IncidentsCardTelemetry = OSLogIncidentsCardTelemetry(),
        onOpenIncident: @escaping (ActiveIncident) -> Void = { _ in }
    ) {
        self.init(
            model: IncidentsCardModel(source: source, incidentCreator: incidentCreator, telemetry: telemetry),
            onOpenIncident: onOpenIncident
        )
    }

    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        IncidentsCardSurface.slug
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            card
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .sheet(
            isPresented: logFormBinding,
            onDismiss: { model.handleLogFormDismissed() },
            content: {
                IncidentForm(source: model.incidentCreator, onClose: { model.dismissLogForm() })
            }
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
    }

    // MARK: Card chrome (web `<GlassPanel>` with the amber alarm ring)

    private var card: some View {
        let shape = RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        let alarmed = !model.incidents.isEmpty
        return VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                IncidentsConnectivityBanner(connection: model.connection)
            }
            IncidentsHeader(model: model)
            body(for: model.phase)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            shape.fill(Color.TS.surface)
            if alarmed {
                shape.fill(Color.TS.statusWarning.opacity(0.05))
            }
        }
        .overlay(
            shape.strokeBorder(
                alarmed ? Color.TS.statusWarning.opacity(0.35) : Color.TS.border,
                lineWidth: 1
            )
        )
    }

    /// The per-phase body — every state renders real chrome (web single branch widened with
    /// the prompt-required loading / empty / error envelopes).
    @ViewBuilder
    private func body(for phase: IncidentsCardPhase) -> some View {
        switch phase {
        case .loading:
            IncidentsLoadingState()
        case .empty:
            IncidentsEmptyState()
        case let .error(message):
            IncidentsErrorState(message: message) { model.refresh() }
        case .content:
            IncidentsContent(model: model, onOpen: onOpenIncident)
        }
    }

    /// The sheet presentation binding for the "Log incident" form (web local `open` state).
    private var logFormBinding: Binding<Bool> {
        Binding(get: { model.isPresentingLogForm }, set: { model.isPresentingLogForm = $0 })
    }
}
