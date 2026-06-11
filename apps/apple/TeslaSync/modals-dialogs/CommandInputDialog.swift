//
//  CommandInputDialog.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  The vehicle-command input surface — the SwiftUI parity of
//  features/system/components/CommandInputDialog.tsx. The web source is a `Modal` wrapping a command's
//  `inputConfig` form: a header (the command glyph + title + prompt), one or more validated fields, and a
//  Cancel / Send footer that only routes `onSubmit(values)` once every field is valid. The native surface
//  presents that same composition as HIG sheet content (web `Modal` → native sheet): it fades in inside a
//  `TSGlassPanel`, shows the always-on header + freshness chip + close, surfaces a cached-data banner when
//  the bound source is not fresh, and switches over the model's resolved phase so every prompt-required
//  state renders (loading / empty / error / content) — never a blank box. Binds through
//  `CommandInputDialogModel` (P1/S8); no HTTP or command-queue access lives here.
//
//  Dismissal is a queue consequence (web parity): submitting hands the validated values to the injected
//  `CommandInputController`, which dispatches the command; cancelling (or the close "×") rejects it. The
//  presenting host observes the queue and dismisses around this surface. The close "×" routes to cancel,
//  exactly like the web `Modal onClose`.
//

import SwiftUI

/// The command-input surface, binding through `CommandInputDialogModel` (P1/S8). Submitting hands the
/// validated `values` to the controller (web `onSubmit`); cancelling (or the close "×") dismisses without
/// sending (web `onClose`). Both empty the host's command queue, which the presenting host reacts to by
/// dismissing.
public struct CommandInputDialog: View {
    @State private var model: CommandInputDialogModel

    public init(model: CommandInputDialogModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    CommandInputHeader(
                        iconSystemName: model.iconSystemName,
                        title: model.title,
                        prompt: model.prompt,
                        connection: model.connection,
                        closeLabel: model.closeAccessibilityLabel,
                        onClose: handleCancel
                    )
                    if model.connection != .live {
                        CommandInputConnectivityBanner(connection: model.connection)
                    }
                    body(for: model.phase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web modal body under the header: the populated form for `.content`, else the loading / empty /
    /// error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: CommandInputPhase) -> some View {
        switch phase {
        case .loading:
            CommandInputLoadingState()
        case .empty:
            CommandInputEmptyState()
        case let .error(message):
            CommandInputErrorState(message: message) { model.refresh() }
        case .content:
            CommandInputForm(model: model, onCancel: handleCancel, onSubmit: handleSubmit)
        }
    }

    /// Validate-then-submit (web `handleSubmit`). The validation + routing lives in the model; on a valid
    /// form it hands the values to the controller, which dispatches the command and dismisses the host.
    private func handleSubmit() {
        model.submit()
    }

    /// Dismiss without sending (web `onClose` + the `Modal` "×").
    private func handleCancel() {
        model.cancel()
    }
}

// MARK: - Surface identity

public extension CommandInputDialog {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        CommandInputSurface.slug
    }
}
