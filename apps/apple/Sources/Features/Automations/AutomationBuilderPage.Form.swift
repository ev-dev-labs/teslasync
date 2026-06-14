import SwiftUI

// The success-state body of `AutomationBuilderPage` (web `PageContainer` children): the
// edit-conflict + draft-recovery banners, the four `FormSection`s, the conflict warnings, the
// save-error banner, the Save / Test Run / Cancel action bar, and the preset-hint panel
// (GlassPanel3). Each visible string resolves from `Localizable.xcstrings`.

struct AutomationBuilderFormView: View {
    let model: AutomationBuilderPageModel
    let onClose: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if model.hasEditConflict {
                AutomationBuilderEditConflictBanner(onDismiss: { model.dismissEditConflict() })
            }
            if model.hasDraft, !model.mode.isEdit {
                AutomationBuilderDraftBanner(onDiscard: { model.discardDraft() })
            }
            AutomationBuilderGeneralSection(model: model)
            AutomationBuilderTriggerSection(model: model)
            AutomationBuilderConditionsSection(model: model)
            AutomationBuilderActionsSection(model: model)
            AutomationBuilderConflictsSection(conflicts: model.conflicts)
            if let message = model.saveError {
                AutomationBuilderSaveErrorBanner(message: message)
            }
            AutomationBuilderActionsBar(model: model, onClose: onClose, onCancel: onCancel)
            if model.showsPresetHint {
                AutomationBuilderPresetHintPanel()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Action bar (web Save / Test Run / Cancel + "Test run started!")

struct AutomationBuilderActionsBar: View {
    let model: AutomationBuilderPageModel
    let onClose: () -> Void
    let onCancel: () -> Void

    var body: some View {
        FlexibleRow {
            TSButton(variant: .primary, isLoading: model.isSaving, action: save) {
                Label(model.saveButtonKey, systemImage: "checkmark")
            }
            if model.testRunTargetID != nil {
                TSButton(variant: .secondary, isLoading: model.isTestRunning, action: testRun) {
                    Label("automations.builder.testRun", systemImage: "play.circle")
                }
            }
            TSButton(variant: .ghost, action: onCancel) {
                Label("automations.builder.cancel", systemImage: "xmark")
            }
            if model.testRunStarted {
                Label("automations.builder.testRunStarted", systemImage: "bolt.fill")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
    }

    private func save() {
        Task { if await model.save() { onClose() } }
    }

    private func testRun() {
        Task { await model.testRun() }
    }
}

/// Wraps the action controls in a wrapping `HStack` (web `flex flex-wrap items-center gap-3`).
private struct FlexibleRow<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.md) { content() }
            VStack(alignment: .leading, spacing: TSSpacing.sm) { content() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Preset hint (GlassPanel3, web `!isEdit` hint)

struct AutomationBuilderPresetHintPanel: View {
    var body: some View {
        TSGlassPanel {
            Text("automations.builder.presetHint")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Banners (web AlertBanner / EditConflictBanner / DraftRecoveryBanner)

/// Web save-error `AlertBanner variant="danger"` — the `saveError` title plus the failure detail.
struct AutomationBuilderSaveErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("automations.builder.saveError")
                    .font(Font.TS.bodySm).fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusDanger.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// Web `DraftRecoveryBanner` — surfaces the restored autosaved automation draft, dismiss = discard.
struct AutomationBuilderDraftBanner: View {
    let onDiscard: () -> Void

    var body: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "arrow.uturn.backward",
            title: "draft.noun.automation",
            onDismiss: onDiscard
        )
    }
}

/// Web `EditConflictBanner` — warns that another tab is editing this same automation resource.
struct AutomationBuilderEditConflictBanner: View {
    let onDismiss: () -> Void

    var body: some View {
        TSAlertBanner(
            tone: .danger,
            systemImage: "exclamationmark.arrow.triangle.2.circlepath",
            title: "editConflict.resource.automation",
            onDismiss: onDismiss
        )
    }
}
