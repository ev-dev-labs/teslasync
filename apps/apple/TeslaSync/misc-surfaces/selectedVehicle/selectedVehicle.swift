//
//  selectedVehicle.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  The selectedVehicle surface — the SwiftUI parity of the web selected-vehicle store
//  (store/selectedVehicle.tsx) composed with `useSelectedVehicle()`. A titled header over a
//  glass panel that switches over the resolved selection phase: loading (fleet resolving) /
//  content (the focused vehicle + clear) / empty (no selection — select the first vehicle) /
//  error (failed fleet read → retry), widened with the stale + offline freshness branches so
//  the bound feed is represented in every state — never a blank box. Fades in on appear (web
//  `<FadeIn>` motion) and binds through `SelectedVehicleStoreModel` (P1/S8); no networking
//  lives here.
//

import SwiftUI

/// The selectedVehicle surface — binds through `SelectedVehicleStoreModel` (P1/S8) and renders
/// the resolved selection in every state.
public struct SelectedVehicleStoreView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SelectedVehicleStoreSurface.slug

    @State private var model: SelectedVehicleStoreModel

    public init(model: SelectedVehicleStoreModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SelectedVehicleStoreHeader(title: model.pageTitle, connection: model.connection)
                if model.connection != .live {
                    SelectedVehicleStoreConnectivityBanner(connection: model.connection)
                }
                TSGlassPanel {
                    content
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The phase ladder: loading → content / empty / error. Every branch renders real chrome so
    /// the panel is never blank.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SelectedVehicleStoreLoadingView(label: model.loadingLabel)
        case .content:
            SelectedVehicleStoreSelectedView(
                vehicleName: model.selected?.displayName ?? model.emptyTitle,
                bodyText: model.contentBody,
                idLabel: model.idLabel,
                vehicleId: model.selected?.id ?? model.effectiveId,
                persistenceNote: model.persistenceNote,
                persistence: model.persistence,
                clearLabel: model.clearLabel,
                onClear: { model.clearSelection() }
            )
        case .empty:
            SelectedVehicleStoreEmptyView(
                title: model.emptyTitle,
                message: model.emptyDescription,
                candidateName: model.candidate?.displayName,
                selectLabel: model.selectCandidateLabel,
                onSelectCandidate: { model.selectCandidate() }
            )
        case .error:
            SelectedVehicleStoreErrorView(
                title: model.errorTitle,
                message: model.errorBody,
                retryLabel: model.retryLabel,
                onRetry: { model.refresh() }
            )
        }
    }
}
