//
//  ResetSection.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  The Reset-to-defaults settings surface — the production-polished, Apple-idiomatic
//  SwiftUI parity of web/src/features/settings/components/ResetSection.tsx. Renders the
//  by-section reset list, the read-only deny-list, and the destructive danger zone inside
//  stacked glass panels, binding through `ResetSectionModel` (P1/S8); the section-list
//  status banner, the loading skeleton, the per-section + danger-zone confirmation sheets,
//  and the success/failure toast cover every state the web source + the P4 states contract
//  require. No networking, no store access, and no English literals live in the view.
//

import SwiftUI

/// The Reset settings section — the SwiftUI parity of the web `ResetSection`. Always
/// rendered (web contract); the loading skeleton shows only until the resettable-section
/// list first resolves, after which the always-usable controls (incl. the global danger
/// zone) are revealed.
public struct ResetSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ResetDiagnostics.surface

    @State private var model: ResetSectionModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over the two P1/S8 seams).
    public init(model: ResetSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { toastOverlay }
            .animation(reduceMotion ? nil : .spring(duration: TSMotion.normalDuration), value: model.toast)
            .sheet(item: activeSheet) { sheet in
                switch sheet {
                case let .section(row):
                    ResetSectionConfirmSheet(row: row, model: model)
                case .all:
                    ResetAllConfirmSheet(model: model)
                }
            }
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(ResetStrings.text("settingsReset.a11y", "Reset to defaults"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ResetSkeleton()
        case .ready:
            loaded
        }
    }

    private var loaded: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let banner = ResetAdapter.statusBanner(status: model.status, freshness: model.freshness) {
                ResetStatusBannerView(banner: banner) { model.refresh() }
            }
            TSFadeIn(delay: 0.24) {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    ResetBySectionPanel(model: model)
                    ResetDeniedPanel(denied: model.denied)
                    ResetDangerZonePanel(model: model)
                }
            }
        }
    }

    // MARK: Toast

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast = model.toast {
            ResetToastView(toast: toast) { model.dismissToast() }
                .padding(.bottom, TSSpacing.xl)
                .padding(.horizontal, TSSpacing.lg)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: toast.id) {
                    try? await Task.sleep(for: .seconds(3))
                    model.dismissToast()
                }
        }
    }

    // MARK: Confirmation sheets (single presentation host)

    /// The mutually-exclusive confirmation sheet currently presented (web's two
    /// `ConfirmDialog`s). Driven by one `.sheet(item:)` so the per-section and danger-zone
    /// dialogs never fight over a shared presentation slot.
    private enum ActiveSheet: Identifiable {
        case section(ResetSectionRow)
        case all

        var id: String {
            switch self {
            case let .section(row): "section-\(row.id)"
            case .all: "all"
            }
        }
    }

    private var activeSheet: Binding<ActiveSheet?> {
        Binding(
            get: {
                if let row = model.pendingSection { return .section(row) }
                if model.resetAllPresented { return .all }
                return nil
            },
            set: { newValue in
                guard newValue == nil else { return }
                if model.pendingSection != nil { model.cancelResetSection() }
                if model.resetAllPresented { model.cancelResetAll() }
            }
        )
    }
}
