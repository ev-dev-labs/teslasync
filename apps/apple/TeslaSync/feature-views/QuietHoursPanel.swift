//
//  QuietHoursPanel.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  Quiet hours / Do-Not-Disturb settings panel — the SwiftUI parity of
//  features/settings/components/QuietHoursPanel.tsx. Fades in on appear (web `<FadeIn>`)
//  inside a GlassPanel-equivalent card, shows the cached-data banner when the bound
//  live-state is not fresh, renders an always-on header (icon + title + "Add window"),
//  switches over the model's resolved phase so every prompt-required state renders
//  (loading / empty / error / content, with the inline-error + stale + offline
//  branches), reveals the add/edit form beneath while a draft is open, and floats the
//  save/delete toast over the top. All CRUD binds through `QuietHoursModel` (P1/S8); no
//  networking lives here.
//

import SwiftUI

/// The quiet-hours / Do-Not-Disturb panel — the SwiftUI parity of the web
/// `QuietHoursPanel`, binding through `QuietHoursModel` (P1/S8).
public struct QuietHoursPanel: View {
    @State private var model: QuietHoursModel

    public init(model: QuietHoursModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.135) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    QuietHoursConnectivityBanner(connection: model.connection)
                }
                QuietHoursHeader(model: model)
                QuietHoursBody(model: model)
                if model.hasDraft {
                    QuietHoursForm(model: model)
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .overlay(alignment: .top) {
            if let toast = model.toast {
                QuietHoursToastView(toast: toast) { model.dismissToast() }
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.top, TSSpacing.sm)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: TSMotion.fastDuration), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }
}

// MARK: - Surface identity

public extension QuietHoursPanel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        QuietHoursSurface.slug
    }
}

// MARK: - Body (web loading / empty / list middle section)

/// The phase-switched middle section between the always-on header and the draft form.
/// The web `isLoading ? Spinner : empty ? EmptyState : <ul>` ladder, widened with the
/// error envelope + the inline list-error above cached rows.
struct QuietHoursBody: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        switch model.phase {
        case .loading:
            QuietHoursLoadingState()
        case let .error(message):
            QuietHoursErrorState(message: message) { model.refresh() }
        case .empty:
            QuietHoursEmptyState()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if let message = model.inlineErrorMessage {
                    QuietHoursInlineError(message: message)
                }
                if !model.items.isEmpty {
                    QuietHoursList(model: model)
                }
            }
        }
    }
}
