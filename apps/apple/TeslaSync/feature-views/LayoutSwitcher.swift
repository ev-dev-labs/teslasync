//
//  LayoutSwitcher.swift
//  TeslaSync — P4 feature view · 0126 · LayoutSwitcher (Apple)
//
//  The SwiftUI parity of web/src/features/dashboard/components/LayoutSwitcher.tsx —
//  a compact dropdown for switching between saved dashboard layouts, with the
//  inline Edit / Save-as / Reset cluster and the layout menu (radio list +
//  new-from-current + pin/unpin + reset + footer hint). It owns no data and
//  performs no I/O (web parity): the parent maps the shared S8 holders
//  (`useSelectedVehicle` + the saved-dashboard collection) into
//  `LayoutSwitcherData` and supplies the callbacks. The web `useConfirm` reset
//  dialog and the `window.prompt` save-as flow are realised natively as SwiftUI
//  `.alert`s, and the web custom dropdown (with its manual click-outside / Escape
//  handlers) becomes a native `.popover` that dismisses itself per the HIG.
//
//  Every P4 state renders: `loading` (skeleton trigger), `empty` (friendly empty
//  trigger), `error` (message + retry), and `loaded` (the full switcher, with the
//  collection's stale/offline freshness surfaced as a trigger chip). No surface
//  is ever hidden behind a null check.
//

import SwiftUI

public struct LayoutSwitcher: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        LayoutSwitcherSurface.slug
    }

    let state: LayoutSwitcherState
    let connection: LayoutSwitcherConnection
    let actions: LayoutSwitcherActions
    let localize: LayoutSwitcherLocalizer
    let telemetry: any LayoutSwitcherTelemetry

    @Environment(\.horizontalSizeClass) var horizontalSizeClass
    @State var isMenuOpen = false
    @State var showResetConfirm = false
    @State var showSaveAsPrompt = false
    @State var saveAsName = ""

    /// Designated initialiser (explicit state — used by the load/empty/error
    /// callers and the previews/tests).
    public init(
        state: LayoutSwitcherState,
        connection: LayoutSwitcherConnection = .live,
        actions: LayoutSwitcherActions,
        localize: LayoutSwitcherLocalizer = .bundle,
        telemetry: any LayoutSwitcherTelemetry = OSLogLayoutSwitcherTelemetry()
    ) {
        self.state = state
        self.connection = connection
        self.actions = actions
        self.localize = localize
        self.telemetry = telemetry
    }

    /// Web-parity convenience: the switcher for a resolved set of layouts (web
    /// props threaded onto `LayoutSwitcherData`).
    public init(
        data: LayoutSwitcherData,
        connection: LayoutSwitcherConnection = .live,
        actions: LayoutSwitcherActions,
        localize: LayoutSwitcherLocalizer = .bundle,
        telemetry: any LayoutSwitcherTelemetry = OSLogLayoutSwitcherTelemetry()
    ) {
        self.init(
            state: .loaded(data),
            connection: connection,
            actions: actions,
            localize: localize,
            telemetry: telemetry
        )
    }

    public var body: some View {
        content
            .task { LayoutSwitcherSurface.reportOpen(to: telemetry) }
    }

    @ViewBuilder
    var content: some View {
        switch state {
        case .loading:
            loadingTrigger
        case .empty:
            emptyTrigger
        case let .error(message):
            errorTrigger(message)
        case let .loaded(data):
            loadedSwitcher(LayoutSwitcherLoaded(data: data, localize: localize, actions: actions))
        }
    }

    // MARK: Loaded switcher (web control body)

    func loadedSwitcher(_ context: LayoutSwitcherLoaded) -> some View {
        HStack(spacing: TSSpacing.xs) {
            triggerButton(context)
            if showsToolbar {
                LayoutSwitcherToolbar(
                    editMode: context.editMode,
                    editLabel: LayoutEditLabel.build(editMode: context.editMode, localize: localize),
                    hasEditToggle: actions.onToggleEdit != nil,
                    localize: localize,
                    onToggleEdit: { actions.onToggleEdit?() },
                    onSaveAs: { beginSaveAs(active: context.active) },
                    onReset: { showResetConfirm = true }
                )
            }
        }
        .reset(isPresented: $showResetConfirm, localize: localize, onConfirm: actions.onReset)
        .saveAs(
            isPresented: $showSaveAsPrompt,
            name: $saveAsName,
            localize: localize,
            onConfirm: { commitSaveAs(active: context.active) }
        )
    }

    func triggerButton(_ context: LayoutSwitcherLoaded) -> some View {
        Button { isMenuOpen.toggle() } label: {
            LayoutSwitcherTrigger(
                activeName: context.activeName,
                dirty: context.dirty,
                pinnedLabel: context.pinnedLabel,
                freshness: LayoutFreshnessChip.project(connection),
                localize: localize
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: localize.string("layout.switcherLabel", "Switch dashboard layout")))
        .accessibilityValue(Text(verbatim: context.accessibilityValue(localize: localize)))
        .accessibilityAddTraits(.isButton)
        .popover(isPresented: $isMenuOpen) {
            LayoutSwitcherDropdown(
                rows: context.rows,
                pinControl: context.pinControl,
                localize: localize,
                onSelect: { id in
                    isMenuOpen = false
                    actions.onSwitch(id)
                },
                onNewFromCurrent: { beginSaveAs(active: context.active) },
                onPinToggle: {
                    performPinToggle(active: context.active, selectedVehicleID: context.selectedVehicleID)
                },
                onReset: {
                    isMenuOpen = false
                    showResetConfirm = true
                }
            )
            .presentationCompactAdaptation(.popover)
        }
    }
}

// MARK: - Loaded context (the resolved web-body projections)

/// The resolved projections for the loaded switcher, computed once so the view
/// stays a thin renderer and the parameter lists stay small.
struct LayoutSwitcherLoaded {
    let active: SavedDashboardSummary?
    let rows: [LayoutRow]
    let activeName: String
    let pinnedLabel: String?
    let pinControl: LayoutPinControl?
    let dirty: Bool
    let editMode: Bool
    let selectedVehicleID: Int64?

    init(data: LayoutSwitcherData, localize: LayoutSwitcherLocalizer, actions: LayoutSwitcherActions) {
        active = LayoutSwitcherProjection.active(data.dashboards, activeID: data.activeID)
        rows = LayoutSwitcherProjection.rows(
            data.dashboards,
            activeID: data.activeID,
            selectedVehicleID: data.selectedVehicleID
        )
        activeName = LayoutSwitcherProjection.activeName(active, localize: localize)
        pinnedLabel = LayoutSwitcherProjection.pinnedLabel(active: active, vehicle: data.selectedVehicle)
        pinControl = actions.onPinToVehicle == nil
            ? nil
            : LayoutSwitcherProjection.pinControl(active: active, selectedVehicleID: data.selectedVehicleID)
        dirty = data.dirty
        editMode = data.editMode
        selectedVehicleID = data.selectedVehicleID
    }

    func accessibilityValue(localize: LayoutSwitcherLocalizer) -> String {
        LayoutSwitcherAccessibility.triggerLabel(
            activeName: activeName,
            dirty: dirty,
            pinnedLabel: pinnedLabel,
            localize: localize
        )
    }
}

// MARK: - Chrome + actions (every state renders; web `handleSaveAs`/`handlePinToggle`)

extension LayoutSwitcher {
    var showsToolbar: Bool {
        horizontalSizeClass != .compact
    }

    var loadingTrigger: some View {
        HStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 48, height: 12)
            TSSkeleton(width: 96, height: 14)
            TSSkeleton(width: 14, height: 14, cornerRadius: TSRadius.sm)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityLabel(Text(verbatim: localize.string("layout.loading", "Loading layouts…")))
    }

    var emptyTrigger: some View {
        chrome(
            systemImage: "rectangle.on.rectangle.slash",
            tint: Color.TS.textMuted,
            text: localize.string("layout.empty", "No saved layouts")
        ) { EmptyView() }
    }

    func errorTrigger(_ message: String?) -> some View {
        chrome(
            systemImage: "exclamationmark.triangle.fill",
            tint: Color.TS.statusDanger,
            text: message ?? localize.string("layout.error", "Couldn’t load layouts")
        ) {
            TSButton(variant: .ghost, size: .small, action: actions.onRetry) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.clockwise")
                    Text(verbatim: localize.string("layout.retry", "Retry"))
                }
            }
            .accessibilityLabel(Text(verbatim: localize.string("layout.retry", "Retry")))
        }
    }

    func chrome(
        systemImage: String,
        tint: Color,
        text: String,
        @ViewBuilder trailing: () -> some View
    ) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
            Text(verbatim: text)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            trailing()
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    func beginSaveAs(active: SavedDashboardSummary?) {
        isMenuOpen = false
        saveAsName = LayoutSwitcherProjection.saveAsSuggestion(active: active, localize: localize)
        showSaveAsPrompt = true
    }

    func commitSaveAs(active: SavedDashboardSummary?) {
        let outcome = LayoutSwitcherProjection.saveAsOutcome(
            name: saveAsName,
            active: active,
            hasDuplicate: actions.onDuplicate != nil
        )
        switch outcome {
        case .none:
            break
        case let .duplicate(id):
            actions.onDuplicate?(id)
        case let .create(name):
            _ = actions.onCreate(name)
        }
    }

    func performPinToggle(active: SavedDashboardSummary?, selectedVehicleID: Int64?) {
        isMenuOpen = false
        guard let outcome = LayoutSwitcherProjection.pinOutcome(
            active: active,
            selectedVehicleID: selectedVehicleID
        ) else { return }
        switch outcome {
        case let .unpin(id):
            actions.onPinToVehicle?(id, nil)
        case let .pin(id, vehicleID):
            actions.onPinToVehicle?(id, vehicleID)
        }
    }
}

// MARK: - Alert presenters (web `useConfirm` + `window.prompt`)

private extension View {
    /// The web reset `ConfirmDialog` (danger): a destructive Reset + Cancel.
    func reset(
        isPresented: Binding<Bool>,
        localize: LayoutSwitcherLocalizer,
        onConfirm: @escaping () -> Void
    ) -> some View {
        let confirm = LayoutResetConfirm.build(localize: localize)
        return alert(Text(verbatim: confirm.title), isPresented: isPresented) {
            Button(role: .destructive, action: onConfirm) {
                Text(verbatim: confirm.confirmLabel)
            }
            Button(role: .cancel) {} label: {
                Text(verbatim: confirm.cancelLabel)
            }
        } message: {
            Text(verbatim: confirm.message)
        }
    }

    /// The web save-as `window.prompt`: a named text field + Save + Cancel.
    func saveAs(
        isPresented: Binding<Bool>,
        name: Binding<String>,
        localize: LayoutSwitcherLocalizer,
        onConfirm: @escaping () -> Void
    ) -> some View {
        alert(
            Text(verbatim: localize.string("layout.saveAsPrompt", "Name for the new layout:")),
            isPresented: isPresented
        ) {
            TextField(text: name) {
                Text(verbatim: localize.string("layout.newLayoutDefault", "New Layout"))
            }
            Button(action: onConfirm) {
                Text(verbatim: localize.string("layout.saveAsConfirm", "Save"))
            }
            Button(role: .cancel) {} label: {
                Text(verbatim: localize.string("common.cancel", "Cancel"))
            }
        }
    }
}
