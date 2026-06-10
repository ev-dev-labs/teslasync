//
//  TOUSettingsModal.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The Time-of-Use rate-plan modal — the SwiftUI parity of
//  features/battery/components/TOUSettingsModal.tsx. The web source is a `Modal` (size="lg") wrapping a
//  two-tab form: a "Preset Tariff" tab (a `Select` of three utility rate plans + a JSON preview of the
//  chosen one) and a "Custom JSON" tab (a `Textarea` for a pasted `tou_settings` blob), with a shared
//  error line and a Cancel / "Update Rate Plan" footer that POSTs through `useUpdateTOUSettings` and
//  closes on success. The native surface reproduces that exactly as an Apple modal: a pinned header
//  (icon + title + freshness chip + close), a scrolling form body, and a pinned footer — switching over
//  the model's resolved phase so every prompt-required state renders (loading / empty / error / content,
//  plus the stale / offline freshness + submit pending / error), never a blank box. Binds through
//  `TOUSettingsModel` (P1/S8); no networking lives here. Designed to be presented in a `.sheet`; the
//  view owns dismissal, the model owns the update / cancel seams.
//

import SwiftUI

/// The rate-plan configuration surface, binding through `TOUSettingsModel` (P1/S8). Presented in a sheet
/// by a host; the header close + footer Cancel dismiss (web `handleClose`), and Update commits the
/// chosen tariff (web `handleSubmit`) and dismisses on success. Both dismissals funnel through the
/// model's `didFinish` signal so a pending save can't be cancelled out from under itself.
public struct TOUSettingsModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TOUSettingsSurface.slug

    @State private var model: TOUSettingsModel
    @Environment(\.dismiss) private var dismiss

    public init(model: TOUSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            TOUSettingsHeader(
                connection: model.connection,
                title: model.localize("energy.tou.title", "Update Rate Plan"),
                closeLabel: model.localize("tou.closeAria", "Close"),
                onClose: cancel
            )
            Divider().overlay(Color.TS.border)
            body(for: model.phase)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.didFinish) { _, finished in
            if finished { dismiss() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityDialogLabel))
    }

    /// The body under the header: the populated form for `.content`, else the loading / empty / error
    /// envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: TOUSettingsPhase) -> some View {
        switch phase {
        case .loading:
            TOUSettingsLoadingState()
        case .empty:
            TOUSettingsEmptyState()
        case let .error(message):
            TOUSettingsErrorState(message: message) { model.refresh() }
        case .content:
            TOUSettingsContentView(model: model, onCancel: cancel, onSubmit: submit)
        }
    }

    /// Web `handleClose` — cancel (guarded while the save is pending); the model flips `didFinish`,
    /// driving dismissal through `onChange`.
    private func cancel() {
        model.cancel()
    }

    /// Web `handleSubmit` — validate + POST; on success the model flips `didFinish` and the dialog
    /// dismisses, on a validation/save failure the error line surfaces in place.
    private func submit() {
        model.submit()
    }
}
