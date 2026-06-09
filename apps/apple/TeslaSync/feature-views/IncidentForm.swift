//
//  IncidentForm.swift
//  TeslaSync — P4 feature view · 0246 · IncidentForm (Apple)
//
//  The composed IncidentForm surface — the SwiftUI parity of
//  features/system/components/status/IncidentForm.tsx. A manual incident-logging dialog:
//  the web `<Modal title="Log an incident">` becomes a self-contained, sheet-presentable
//  card with a title + close affordance, the controlled form (title / severity / status /
//  affected components / initial message), and the Cancel + primary "Log incident" actions
//  (the button flips to "Logging…" and disables while the create is in flight). It binds
//  through `IncidentFormModel` (P1/S8); no networking lives in the view. On appear it emits
//  the P1/S11 `view.opened` diagnostics event for the surface slug `IncidentForm`.
//
//  Every state renders (no hidden surface): the always-visible form, the in-flight
//  ("Logging…") submit, the client-side title-too-short validation toast, the offline +
//  generic create-failure toasts, and the success toast that raises the dismiss signal the
//  host honors (web `onClose()`). The submit is re-entrancy guarded so a double-tap can't
//  fire two creates, and a successful create invalidates the incidents list (web query
//  invalidation).
//

import SwiftUI

// MARK: - Focusable fields (web `useId` associations + `autoFocus`)

/// The focusable text fields, so the title can take focus on appear (web `autoFocus`) and
/// the keyboard "next/done" flow is coherent.
public enum IncidentFormField: Hashable, Sendable {
    case title
    case components
    case message
}

public struct IncidentForm: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        IncidentFormSurface.slug
    }

    private let onClose: () -> Void

    @State private var model: IncidentFormModel
    @FocusState private var focusedField: IncidentFormField?

    /// Binds an explicitly constructed model (production wires it over the shared P1/S8
    /// create-incident holder; previews/tests inject in-memory sources).
    public init(model: IncidentFormModel, onClose: @escaping () -> Void) {
        _model = State(initialValue: model)
        self.onClose = onClose
    }

    /// Convenience: builds the model from the create-incident seam (web `useCreateIncident`).
    public init(
        source: any IncidentCreating,
        telemetry: any IncidentFormTelemetry = OSLogIncidentFormTelemetry(),
        onClose: @escaping () -> Void
    ) {
        self.init(model: IncidentFormModel(source: source, telemetry: telemetry), onClose: onClose)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                Divider().overlay(Color.TS.border)
                fields
                if let toast = model.toast {
                    IncidentToastView(toast: toast) { model.dismissToast() }
                        .animation(.easeInOut(duration: TSMotion.normalDuration), value: toast.id)
                }
                Divider().overlay(Color.TS.border)
                IncidentActionsBar(
                    model: model,
                    onCancel: onClose,
                    onSubmit: { Task { await model.submit() } }
                )
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg)
        .task {
            model.start()
            focusedField = .title
        }
        .onChange(of: model.shouldDismiss) { _, shouldDismiss in
            if shouldDismiss { onClose() }
        }
        .task(id: model.toast?.id) { await autoDismissToast() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(IFView.text(IncidentFormText.surfaceA11y))
    }

    // MARK: Header (web `<Modal title="Log an incident">` chrome)

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            TSPanelTitle(IFView.key(IncidentFormText.title))
            Spacer(minLength: TSSpacing.sm)
            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .disabled(model.isSubmitDisabled)
            .accessibilityLabel(IFView.text(IncidentFormText.close))
        }
    }

    // MARK: Fields (web controlled form body)

    private var fields: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            IncidentTitleField(model: model, focus: $focusedField)
            IncidentSeverityStatusFields(model: model)
            IncidentComponentsField(model: model, focus: $focusedField)
            IncidentMessageField(model: model, focus: $focusedField)
        }
    }

    /// Clears the toast after a short delay (web `useToast` auto-dismiss). Re-armed on each
    /// new toast via `.task(id:)`; cancellation (a newer toast) skips the clear.
    private func autoDismissToast() async {
        guard model.toast != nil else { return }
        try? await Task.sleep(for: .seconds(4))
        if !Task.isCancelled {
            model.dismissToast()
        }
    }
}
