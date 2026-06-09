//
//  IncidentForm.Previews.swift
//  TeslaSync — P4 feature view · 0246 · IncidentForm (Apple)
//
//  Xcode previews for each surface state (empty / filled editing + in-flight "Logging…" +
//  validation / success / offline / generic-failure toasts). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope. No networking — the model is
//  driven by the in-memory source + the DEBUG preview seams.
//

#if DEBUG
    import Foundation
    import SwiftUI

    @MainActor
    private func previewModel(
        fill: Bool = false,
        outcome: IncidentSubmitOutcome? = nil,
        submitting: Bool = false
    ) -> IncidentFormModel {
        let model = IncidentFormModel(source: InMemoryIncidentCreator())
        model.start()
        if fill {
            model.previewFill(
                title: "Wall connector restart at 14:00",
                components: "tesla, telemetry",
                message: "Investigating an intermittent wall-connector dropout."
            )
            model.severity = .major
            model.status = .identified
        }
        if submitting {
            model.previewSetSubmitting()
        }
        if let outcome {
            model.previewApply(outcome)
        }
        return model
    }

    private func framed(_ view: some View) -> some View {
        view.frame(width: 480, height: 560)
    }

    #Preview("Empty (editing)") {
        framed(IncidentForm(model: previewModel(), onClose: {}))
    }

    #Preview("Filled (editing)") {
        framed(IncidentForm(model: previewModel(fill: true), onClose: {}))
    }

    #Preview("Submitting") {
        framed(IncidentForm(model: previewModel(fill: true, submitting: true), onClose: {}))
    }

    #Preview("Validation toast") {
        framed(IncidentForm(model: previewModel(outcome: .validationFailed), onClose: {}))
    }

    #Preview("Success toast") {
        framed(IncidentForm(model: previewModel(fill: true, outcome: .succeeded), onClose: {}))
    }

    #Preview("Offline toast") {
        framed(IncidentForm(model: previewModel(fill: true, outcome: .offline), onClose: {}))
    }

    #Preview("Failure toast") {
        framed(IncidentForm(
            model: previewModel(fill: true, outcome: .failed(message: "title already exists")),
            onClose: {}
        ))
    }
#endif
