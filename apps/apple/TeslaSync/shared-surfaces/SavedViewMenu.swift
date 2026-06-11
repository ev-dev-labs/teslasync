//
//  SavedViewMenu.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The saved-views menu surface — the SwiftUI parity of
//  `web/src/components/data-display/SavedViewMenu.tsx`. The web component renders THREE coordinated
//  elements as one piece: a trigger button whose label collapses to the active view name, a popover of
//  pin / default / rename / delete rows that re-apply a view's querystring, and an "applied" badge
//  that clears the URL. It auto-applies the default view once on mount when the URL has no query. The
//  native parity surface presents that same trio and adds the P4 leaf states so it never collapses to
//  a blank box. Binds through `SavedViewMenuModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton trigger pill.
//    • empty    — feed resolved with no views → friendly empty state + "Save current view…".
//    • error    — feed failure → retry affordance inside the popover (web has no QueryError peer).
//    • loaded   — the trigger + popover rows + the applied badge (the web body).
//    • stale / offline — the orthogonal connection axis → freshness chip beside the trigger with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - SavedViewMenu (the shared surface)

/// The saved-views menu surface — the SwiftUI parity of `SavedViewMenu.tsx`. Renders every state plus
/// the P4 leaf freshness states, binding through `SavedViewMenuModel`.
public struct SavedViewMenu: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SavedViewMenuMeta.surfaceSlug

    @State private var model: SavedViewMenuModel

    /// Designated initializer binding a pre-built model. The host wires the read source (its
    /// `useSavedViews(route)` feed + `currentQuery` + `onApply`) and the mutation seam.
    public init(model: SavedViewMenuModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting
    /// `<SavedViewMenu route currentQuery onApply />` with the production source + mutation hooks.
    public init(
        source: any SavedViewMenuSource,
        mutations: any SavedViewMenuMutating = LiveSavedViewMenuMutations(),
        telemetry: any SavedViewMenuTelemetry = OSLogSavedViewMenuTelemetry()
    ) {
        _model = State(initialValue: SavedViewMenuModel(
            source: source,
            mutations: mutations,
            telemetry: telemetry
        ))
    }

    public var body: some View {
        @Bindable var model = model
        HStack(spacing: TSSpacing.sm) {
            trigger
            if model.connection != .live {
                SavedViewFreshnessChip(connection: model.connection) { model.refresh() }
            }
            SavedViewAppliedBadge(resolved: model.resolved) { model.clearApplied() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .modifier(SavedViewMenuDialogs(model: model))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var trigger: some View {
        @Bindable var model = model
        if model.phase == .loading {
            SavedViewMenuLoadingTrigger()
        } else {
            SavedViewMenuTrigger(resolved: model.resolved) { model.toggleMenu() }
                .popover(isPresented: $model.isMenuPresented, arrowEdge: .top) {
                    SavedViewMenuPopoverContent(model: model)
                }
        }
    }
}

// MARK: - Dialogs (web Save / Rename / Delete / Manage)

/// Attaches the surface's four dialogs to the trigger row: the save sheet, the rename sheet, the
/// manage sheet (web `Modal`s), and the delete confirmation (web `ConfirmDialog`). Kept as a modifier
/// so the entry body stays readable; bound through the model.
private struct SavedViewMenuDialogs: ViewModifier {
    @Bindable var model: SavedViewMenuModel

    func body(content: Content) -> some View {
        content
            .tsModal(isPresented: $model.isSaveDialogPresented, title: saveTitle) {
                SavedViewSaveForm(
                    saving: model.isSaving,
                    onCancel: { model.dismissSaveDialog() },
                    onSave: { name, makeDefault in
                        Task { await model.save(name: name, makeDefault: makeDefault) }
                    }
                )
            }
            .tsModal(isPresented: renamePresented, title: renameTitle) {
                if let target = model.renameTarget {
                    SavedViewRenameForm(
                        initialName: target.name,
                        saving: model.isRenaming,
                        onCancel: { model.dismissRename() },
                        onRename: { name in Task { await model.rename(target, to: name) } }
                    )
                }
            }
            .tsModal(isPresented: $model.isManagePresented, title: manageTitle) {
                SavedViewManageList(
                    resolved: model.resolved,
                    onApply: { row in model.apply(row); model.dismissManage() },
                    onToggleDefault: { row in Task { await model.toggleDefault(row) } },
                    onTogglePin: { row in Task { await model.togglePin(row) } },
                    onRename: { row in model.dismissManage(); model.presentRename(row) },
                    onDelete: { row in model.dismissManage(); model.requestDelete(row) },
                    onClose: { model.dismissManage() }
                )
            }
            .confirmationDialog(
                Text(verbatim: deleteTitle),
                isPresented: deletePresented,
                titleVisibility: .visible,
                presenting: model.deleteTarget
            ) { _ in
                Button(role: .destructive) {
                    Task { await model.confirmDelete() }
                } label: {
                    Text(verbatim: SavedViewMenuStrings.string("common.delete", "Delete"))
                }
                Button(role: .cancel) { model.cancelDelete() } label: {
                    Text(verbatim: SavedViewMenuStrings.string("common.cancel", "Cancel"))
                }
            } message: { target in
                Text(verbatim: SavedViewMenuFormat.deleteConfirmMessage(
                    name: target.name, strings: SavedViewMenuStrings.string
                ))
            }
    }

    private var renamePresented: Binding<Bool> {
        Binding(get: { model.renameTarget != nil }, set: { if !$0 { model.dismissRename() } })
    }

    private var deletePresented: Binding<Bool> {
        Binding(get: { model.deleteTarget != nil }, set: { if !$0 { model.cancelDelete() } })
    }

    private var saveTitle: LocalizedStringKey {
        LocalizedStringKey(SavedViewMenuStrings.string("savedViews.saveCurrent", "Save current view…"))
    }

    private var renameTitle: LocalizedStringKey {
        LocalizedStringKey(SavedViewMenuStrings.string("savedViews.renamePrompt", "Rename view"))
    }

    private var manageTitle: LocalizedStringKey {
        LocalizedStringKey(SavedViewMenuStrings.string("savedViews.manage", "Manage views"))
    }

    private var deleteTitle: String {
        SavedViewMenuStrings.string("savedViews.deleteTitle", "Delete saved view")
    }
}
