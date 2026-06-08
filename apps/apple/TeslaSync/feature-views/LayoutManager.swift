//
//  LayoutManager.swift
//  TeslaSync — P4 feature view · 0125 · LayoutManager (Apple)
//
//  The SwiftUI parity of web/src/features/dashboard/components/LayoutManager.tsx —
//  the dashboard layout switcher: a horizontal strip of saved-layout tabs with an
//  active highlight, tap-to-switch, a Rename/Duplicate/Settings/Delete context
//  menu, inline rename, drag + VoiceOver reorder, and a "New Layout" affordance
//  that either opens the template gallery (web `onOpenTemplates`) or an inline
//  create field. It owns no data and performs no I/O (web parity): the parent
//  dashboard page maps the shared S8 layout holder into `SavedLayoutData` and
//  supplies the callbacks. On appear it emits the P1/S11 `view.opened` event.
//
//  Every P4 state renders: `loading` (skeleton tabs), `empty` (friendly empty +
//  New Layout), `error` (message + retry), and `loaded` (the strip), with the
//  stale/offline chips layered above when the parent's layouts query is no longer
//  fresh. No surface is ever hidden behind a null check.
//

import SwiftUI

public struct LayoutManager: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        LayoutManagerSurface.slug
    }

    private let state: LayoutManagerState
    private let connection: LayoutLiveConnection
    private let actions: LayoutManagerActions
    private let localize: LayoutManagerLocalizer
    private let telemetry: any LayoutManagerTelemetry

    // Local UI state — the web component's useState (editing id, draft names,
    // and whether the inline create field is open). No data lives here.
    @State private var editingID: String?
    @State private var editText = ""
    @State private var isCreating = false
    @State private var createText = ""

    /// Designated initialiser (explicit state — used by the load/empty/error
    /// callers and the previews/tests).
    public init(
        state: LayoutManagerState,
        connection: LayoutLiveConnection = .live,
        actions: LayoutManagerActions,
        localize: LayoutManagerLocalizer = .bundle,
        telemetry: any LayoutManagerTelemetry = OSLogLayoutManagerTelemetry()
    ) {
        self.state = state
        self.connection = connection
        self.actions = actions
        self.localize = localize
        self.telemetry = telemetry
    }

    /// Web-parity convenience: the switcher for a resolved layout set (web props
    /// `dashboards` + `activeId`).
    public init(
        layouts: [SavedLayoutData],
        activeID: String,
        connection: LayoutLiveConnection = .live,
        actions: LayoutManagerActions,
        localize: LayoutManagerLocalizer = .bundle,
        telemetry: any LayoutManagerTelemetry = OSLogLayoutManagerTelemetry()
    ) {
        self.init(
            state: .loaded(layouts: layouts, activeID: activeID),
            connection: connection,
            actions: actions,
            localize: localize,
            telemetry: telemetry
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if connection.isOffline {
                LayoutStatusChip(
                    copy: LayoutManagerCopy.offline,
                    tone: .neutral,
                    systemImage: "wifi.slash",
                    localize: localize
                )
            }
            if connection.isStale {
                LayoutStatusChip(
                    copy: LayoutManagerCopy.stale,
                    tone: .warning,
                    systemImage: "clock.badge.exclamationmark",
                    localize: localize
                )
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { LayoutManagerSurface.reportOpen(to: telemetry) }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            LayoutManagerLoading(localize: localize)
        case .empty:
            emptyContent
        case let .error(message):
            LayoutManagerError(message: message, localize: localize, onRetry: actions.onRetry)
        case let .loaded(layouts, activeID):
            strip(for: LayoutTabProjection.tabs(from: layouts, activeID: activeID))
        }
    }

    // MARK: Loaded strip (web horizontal tab row)

    private func strip(for tabs: [LayoutTab]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                ForEach(Array(tabs.enumerated()), id: \.element.id) { index, tab in
                    tabView(tab: tab, index: index, tabs: tabs)
                }
                newControl
            }
            .padding(.vertical, TSSpacing.xs)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func tabView(tab: LayoutTab, index: Int, tabs: [LayoutTab]) -> some View {
        if editingID == tab.id {
            LayoutInlineEditor(
                text: $editText,
                prompt: "",
                fieldLabel: LayoutManagerCopy.renameField.resolved(localize),
                confirmLabel: LayoutManagerCopy.confirmRename.resolved(localize),
                cancelLabel: LayoutManagerCopy.cancelRename.resolved(localize),
                onCommit: { commitRename(tab.id) },
                onCancel: { editingID = nil }
            )
        } else {
            LayoutTabChip(
                tab: tab,
                localize: localize,
                canMoveLeft: LayoutReorder.canMoveLeft(index: index),
                canMoveRight: LayoutReorder.canMoveRight(index: index, count: tabs.count),
                onTap: { actions.onSwitch(tab.id) },
                onMenu: { handleMenu($0, tab: tab) },
                onMoveLeft: { actions.onReorder(index, index - 1) },
                onMoveRight: { actions.onReorder(index, index + 1) },
                onDrop: { draggedID in handleDrop(draggedID, toIndex: index, tabs: tabs) }
            )
        }
    }

    // MARK: New layout control (web `+ New Layout` / inline create)

    @ViewBuilder
    private var newControl: some View {
        if isCreating {
            LayoutInlineEditor(
                text: $createText,
                prompt: LayoutManagerCopy.newName.resolved(localize),
                fieldLabel: LayoutManagerCopy.newName.resolved(localize),
                confirmLabel: LayoutManagerCopy.confirmCreate.resolved(localize),
                cancelLabel: LayoutManagerCopy.cancelCreate.resolved(localize),
                onCommit: commitCreate,
                onCancel: { isCreating = false }
            )
        } else {
            LayoutNewButton(localize: localize, onTap: startCreate)
        }
    }

    // MARK: Empty (no saved layouts — friendly empty + New Layout)

    private var emptyContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LayoutManagerEmpty(localize: localize)
            newControl
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Intents (web handlers)

    private func handleMenu(_ kind: LayoutMenuItemKind, tab: LayoutTab) {
        switch kind {
        case .rename:
            beginRename(tab)
        case .duplicate:
            actions.onDuplicate(tab.id)
        case .settings:
            actions.onOpenSettings(tab.id)
        case .delete:
            actions.onDelete(tab.id)
        }
    }

    private func beginRename(_ tab: LayoutTab) {
        isCreating = false
        editText = tab.name
        editingID = tab.id
    }

    private func commitRename(_ id: String) {
        if LayoutNameInput.isCommittable(editText) {
            actions.onRename(id, LayoutNameInput.sanitized(editText))
        }
        editingID = nil
    }

    private func handleDrop(_ draggedID: String, toIndex: Int, tabs: [LayoutTab]) {
        if let move = LayoutReorder.dropMove(draggedID: draggedID, toIndex: toIndex, tabs: tabs) {
            actions.onReorder(move.from, move.to)
        }
    }

    private func startCreate() {
        switch LayoutCreateIntent.resolve(hasTemplates: actions.hasTemplates) {
        case .openTemplates:
            actions.onOpenTemplates?()
        case .inlineCreate:
            editingID = nil
            createText = ""
            isCreating = true
        }
    }

    private func commitCreate() {
        if LayoutNameInput.isCommittable(createText) {
            actions.onCreate(LayoutNameInput.sanitized(createText))
        }
        isCreating = false
    }
}
