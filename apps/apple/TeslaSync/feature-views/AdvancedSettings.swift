//
//  AdvancedSettings.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  The "Restore confirmation prompts" panel — the SwiftUI parity of
//  features/settings/components/AdvancedSettings.tsx. Binds through `AdvancedSettingsModel` (P1/S8); no
//  persistence I/O lives here. Reproduces the web composition (a `FadeIn`-wrapped `GlassPanel` with the
//  `IconBox` header + the two-branch body) and switches over the bound model's phase so every
//  prompt-required state renders (loading / content / empty / error) inside the stale / offline
//  freshness envelope — never a blank box.
//

import SwiftUI

/// The "Restore confirmation prompts" panel. Surfaces every action id the user previously silenced via
/// a confirm dialog's "Don't ask again" checkbox and lets them re-enable individual prompts (web
/// `handleRestore`) or all at once (web `handleRestoreAll`).
public struct AdvancedSettings: View {
    @State private var model: AdvancedSettingsModel

    public init(model: AdvancedSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.24) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    AdvancedSettingsHeader(
                        connection: model.connection,
                        showsRestoreAll: showsRestoreAll,
                        onRestoreAll: { model.restoreAll() }
                    )
                    if model.connection != .live {
                        AdvancedSettingsConnectivityBanner(connection: model.connection)
                    }
                    phaseBody
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The header's "Restore all" action mirrors the web `silenced.length > 0` guard — shown only when
    /// the resolved list actually has rows.
    private var showsRestoreAll: Bool {
        if case .content = model.phase { return model.hasSilencedPrompts }
        return false
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch model.phase {
        case .loading:
            AdvancedSettingsLoadingView()
        case .empty:
            AdvancedSettingsEmptyView()
        case let .error(message):
            AdvancedSettingsErrorView(message: message) { model.refresh() }
        case .content:
            SilencedPromptList(
                rows: model.projection.rows,
                listSummary: model.listAccessibilitySummary,
                restoreLabel: { model.restoreAccessibilityLabel(for: $0) },
                onRestore: { model.restore($0) }
            )
        }
    }
}
