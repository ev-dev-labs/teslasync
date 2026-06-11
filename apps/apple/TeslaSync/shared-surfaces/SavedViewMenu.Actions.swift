//
//  SavedViewMenu.Actions.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The dialog + mutation orchestration for `SavedViewMenuModel`, split into an extension for the lint
//  length budget. These are the native parity of the web component's handlers: opening the save /
//  rename / delete / manage dialogs (each closing the popover first, web `setOpen(false)`), and the
//  create / update / delete / setDefault mutation calls that close their dialog on success (web
//  `onSuccess`). Pin / default toggles keep the popover open (web `handleTogglePin` /
//  `handleToggleDefault` do not call `setOpen(false)`).
//

import Foundation

public extension SavedViewMenuModel {
    // MARK: - Save (web `useCreateSavedView` + SavedViewSaveDialog)

    /// Opens the "Save current view…" dialog, closing the popover first (web footer button →
    /// `setOpen(false); setSaveOpen(true)`).
    func presentSaveDialog() {
        isMenuPresented = false
        isSaveDialogPresented = true
    }

    /// Dismisses the save dialog without saving (web `onClose`).
    func dismissSaveDialog() {
        isSaveDialogPresented = false
    }

    /// Creates a saved view from the current querystring — web `createMut.mutate({ name, route,
    /// query: currentQuery, is_default })` with the dialog closing on success. Trims the name and
    /// guards an empty name + a concurrent save (web disabled `Save` button).
    func save(name: String, makeDefault: Bool) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSaving, let input else { return }
        setSaving(true)
        let success = await mutations.create(
            name: trimmed,
            route: input.route,
            query: input.currentQuery,
            isDefault: makeDefault
        )
        setSaving(false)
        if success { isSaveDialogPresented = false }
    }

    // MARK: - Rename (web `useUpdateSavedView` + SavedViewRenameDialog)

    /// Opens the rename dialog for a row, closing the popover first (web row pencil →
    /// `setRenameTarget(v); setOpen(false)`).
    func presentRename(_ row: SavedViewRow) {
        isMenuPresented = false
        renameTarget = row
    }

    /// Dismisses the rename dialog (web `onClose`).
    func dismissRename() {
        renameTarget = nil
    }

    /// Renames a saved view — web `updateMut.mutate({ id, route, patch: { name } })`. A no-op rename
    /// (empty or unchanged) just closes the dialog, exactly like the web `handleSubmit` early return.
    func rename(_ row: SavedViewRow, to name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let input else { return }
        guard !trimmed.isEmpty, trimmed != row.name else {
            renameTarget = nil
            return
        }
        guard !isRenaming else { return }
        setRenaming(true)
        let success = await mutations.update(
            id: row.id,
            route: input.route,
            patch: SavedViewPatch(name: trimmed)
        )
        setRenaming(false)
        if success { renameTarget = nil }
    }

    // MARK: - Delete (web `useDeleteSavedView` + ConfirmDialog)

    /// Opens the delete confirmation for a row, closing the popover first (web row trash →
    /// `setDeleteTarget(v); setOpen(false)`).
    func requestDelete(_ row: SavedViewRow) {
        isMenuPresented = false
        deleteTarget = row
    }

    /// Dismisses the delete confirmation without deleting (web `onCancel`).
    func cancelDelete() {
        deleteTarget = nil
    }

    /// Deletes the targeted saved view — web `deleteMut.mutate({ id, route })`, closing the dialog on
    /// success (web `onSuccess: () => setDeleteTarget(null)`).
    func confirmDelete() async {
        guard let target = deleteTarget, let input, !isDeleting else { return }
        setDeleting(true)
        let success = await mutations.delete(id: target.id, route: input.route)
        setDeleting(false)
        if success { deleteTarget = nil }
    }

    // MARK: - Pin / default toggles (web `handleTogglePin` / `handleToggleDefault`)

    /// Toggles a view's pinned flag — web `updateMut.mutate({ id, route, patch: { is_pinned } })`.
    /// The popover stays open (the web toggle does not close it).
    func togglePin(_ row: SavedViewRow) async {
        guard let input else { return }
        _ = await mutations.update(
            id: row.id,
            route: input.route,
            patch: SavedViewPatch(isPinned: !row.isPinned)
        )
    }

    /// Toggles a view's default flag — web `setDefaultMut.mutate({ id, route, isDefault })`. The
    /// popover stays open.
    func toggleDefault(_ row: SavedViewRow) async {
        guard let input else { return }
        _ = await mutations.setDefault(
            id: row.id,
            route: input.route,
            isDefault: !row.isDefault
        )
    }

    // MARK: - Manage dialog (web SavedViewManageDialog)

    /// Opens the "Manage views" dialog, closing the popover first (web header button →
    /// `setOpen(false); setManageOpen(true)`).
    func presentManage() {
        isMenuPresented = false
        isManagePresented = true
    }

    /// Dismisses the manage dialog (web `onClose`).
    func dismissManage() {
        isManagePresented = false
    }
}
