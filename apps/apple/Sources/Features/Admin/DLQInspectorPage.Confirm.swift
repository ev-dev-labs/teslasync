import SwiftUI

/// Shared modal scaffold for the DLQ sheets (the inspect drawer + the replay confirmation):
/// a titled header, a scrolling body, and a trailing-aligned footer of actions. Reproduces
/// the web `Drawer` / `ConfirmDialog` chrome as an HIG-native sheet, adaptive across macOS
/// (sized window) and iOS (content-sized sheet).
struct DLQSheetScaffold<Content: View, Footer: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: TSSpacing.md)
            }
            .padding(TSSpacing.lg)
            Divider().overlay(Color.TS.border)
            ScrollView {
                content()
                    .padding(TSSpacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider().overlay(Color.TS.border)
            HStack(spacing: TSSpacing.sm) {
                footer()
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.surface)
        #if os(macOS)
            .frame(minWidth: 520, minHeight: 420)
        #endif
    }
}

/// The replay confirmation for `DLQInspectorPage` (web `ConfirmDialog`). Confirms a
/// republish of the open entry to its source topic — a logged, rate-limited action — with
/// the web message + Cancel / Replay actions, presented as an HIG sheet stacked on the
/// drawer. The dialog cannot be dismissed while the replay is in flight, and a non-gate
/// failure (web mutation toast) surfaces inline so the operator can retry. All copy resolves
/// from `Localizable.xcstrings`; state binds to the `@Observable` `DLQInspectorPageModel`.
struct DLQReplayConfirmSheet: View {
    @Bindable var model: DLQInspectorPageModel
    let target: DLQEntrySummary

    var body: some View {
        DLQSheetScaffold(title: String(localized: "admin.dlq.confirm.title")) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                Text(verbatim: Self.message(for: target.id))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let replayError = model.replayError {
                    Text(verbatim: replayError)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } footer: {
            Spacer(minLength: 0)
            TSButton("common.cancel", variant: .secondary) {
                model.cancelReplay()
            }
            .disabled(model.isReplaying)
            TSButton("admin.dlq.confirm.confirm", variant: .primary, isLoading: model.isReplaying) {
                Task { await model.confirmReplay() }
            }
            .disabled(model.isReplaying)
        }
        .interactiveDismissDisabled(model.isReplaying)
    }

    /// Web `'This will republish entry #{{id}}…'` resolved with the entry id.
    static func message(for id: Int64) -> String {
        String(format: String(localized: "admin.dlq.confirm.message"), String(id))
    }
}
