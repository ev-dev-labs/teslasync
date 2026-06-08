//
//  ActionBuilder.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  The composable automation ActionBuilder — the SwiftUI parity of
//  features/automations/pages/ActionBuilder.tsx. Binds through `ActionBuilderModel`
//  (P1/S8) and renders the ordered list of action cards (each a `GlassPanel` with a
//  numbered type select, the kind-specific fields, and move/remove controls) above the
//  "Add Action" button. When there are no actions it shows a friendly inline empty
//  state rather than a blank box. No networking lives here — edits flow to the host via
//  the model's `onChange`.
//

import SwiftUI

/// The ActionBuilder surface (web `ActionBuilder`). State lives in
/// `ActionBuilderModel`; the host supplies the actions, channels, and `onChange`.
public struct ActionBuilder: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ActionBuilderSurface.slug

    @State private var model: ActionBuilderModel

    public init(model: ActionBuilderModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.rows.isEmpty {
                ActionBuilderEmptyState()
            } else {
                ForEach(Array(model.rows.enumerated()), id: \.element.id) { item in
                    row(for: item.element, at: item.offset)
                }
            }
            addButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { model.start() }
        .accessibilityElement(children: .contain)
    }

    private func row(for identified: IdentifiedAction, at index: Int) -> some View {
        ActionBuilderRow(
            index: index,
            action: identified.action,
            showTypeLabel: index == 0,
            channelOptions: model.channelOptions,
            canMoveUp: index > 0,
            canMoveDown: index < model.rows.count - 1,
            onChangeKind: { model.changeKind(id: identified.id, to: $0) },
            onChangeAction: { model.replaceAction(id: identified.id, with: $0) },
            onMoveUp: { model.moveAction(id: identified.id, .up) },
            onMoveDown: { model.moveAction(id: identified.id, .down) },
            onRemove: { model.removeAction(id: identified.id) }
        )
    }

    private var addButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.addAction() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .semibold))
                        .accessibilityHidden(true)
                    ActionBuilderStrings.text("automations.builder.addAction", "Add Action")
                }
            }
        )
        .accessibilityLabel(ActionBuilderStrings.text("automations.builder.addAction", "Add Action"))
    }
}

// MARK: - Action card (web per-action GlassPanel row)

/// One action editor card (web `GlassPanel` row): the numbered index, the action-type
/// select (label only on the first row), the kind-specific fields, and the
/// move-up/move-down/remove controls.
struct ActionBuilderRow: View {
    let index: Int
    let action: AutomationAction
    let showTypeLabel: Bool
    let channelOptions: [ChannelOption]
    let canMoveUp: Bool
    let canMoveDown: Bool
    let onChangeKind: (AutomationActionKind) -> Void
    let onChangeAction: (AutomationAction) -> Void
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            indexLabel
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ActionLabeledPicker(
                    labelKey: showTypeLabel ? "automations.builder.actionType" : nil,
                    labelFallback: "Action Type",
                    accessibilityKey: "automations.builder.actionType",
                    accessibilityFallback: "Action Type",
                    options: typeOptions,
                    selection: kindBinding
                )
                ActionFields(action: action, channelOptions: channelOptions, onChange: onChangeAction)
            }
            ActionRowControls(
                canMoveUp: canMoveUp,
                canMoveDown: canMoveDown,
                onMoveUp: onMoveUp,
                onMoveDown: onMoveDown,
                onRemove: onRemove
            )
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: rowLabel))
    }

    private var rowLabel: String {
        ActionBuilderAccessibility.rowLabel(index: index, localize: ActionBuilderStrings.localize)
    }

    private var indexLabel: some View {
        Text(verbatim: "\(index + 1).")
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .padding(.top, showTypeLabel ? TSSpacing.x2xl : TSSpacing.xs)
            .accessibilityHidden(true)
    }

    private var typeOptions: [ActionLabeledOption<AutomationActionKind>] {
        ActionCatalog.actionTypes.map { kind in
            ActionLabeledOption(tag: kind, label: ActionBuilderStrings.string(kind.labelKey, kind.fallback))
        }
    }

    private var kindBinding: Binding<AutomationActionKind> {
        Binding(get: { action.kind }, set: { onChangeKind($0) })
    }
}

// MARK: - Empty state (never a blank box)

/// The inline empty state shown when there are no actions yet (the web renders only
/// the add button; native adds a friendly hint so the surface is never a blank box).
struct ActionBuilderEmptyState: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                ActionBuilderStrings.text("automations.builder.emptyTitle", "No actions yet")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                ActionBuilderStrings.text(
                    "automations.builder.emptyMessage",
                    "Add an action to define what this automation does."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}
