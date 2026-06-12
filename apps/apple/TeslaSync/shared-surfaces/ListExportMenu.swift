//
//  ListExportMenu.swift
//  TeslaSync — P4 shared surface · 0155 · ListExportMenu (Apple)
//
//  The list-export menu — the SwiftUI parity of `web/src/components/forms/ListExportMenu.tsx`. A
//  Download-icon trigger that opens a popover offering an optional export-scope chooser
//  ("Visible (N)" / "Selected (M)", shown only when there is a selection) followed by the two file
//  formats ("Download as CSV" / "Download as JSON"); whichever format is picked receives the chosen
//  scope. The web component hand-rolls a popover with outside-click / Escape dismissal and
//  `role="menu"` semantics; the native parity uses SwiftUI's `.popover`, the HIG-idiomatic counterpart
//  — it provides anchored presentation, keyboard activation, and outside-tap / Escape dismissal for
//  free, so we reproduce the web popover behaviour (incl. the two-step "pick scope, then pick format"
//  flow that stays open across the scope choice) without porting the web open-state plumbing.
//
//  Binds through `ListExportMenuModel` (the `@MainActor` owner of the host export callbacks); no
//  networking and no data-fetch state holder live in the view (the web control's only hook is
//  `useTranslation`). The local scope `@State` mirrors the web `useState` + selection-empties effect.
//  Emits `view.opened` once on first appearance (P1/S11).
//

import SwiftUI

// MARK: - ListExportMenu (the shared surface)

/// The list-export menu — the SwiftUI parity of `ListExportMenu.tsx`. A Download-icon `.popover`
/// trigger over the optional scope chooser + the CSV / JSON format actions, binding through
/// `ListExportMenuModel`.
public struct ListExportMenu: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ListExportMenuMeta.surfaceSlug

    @State private var model: ListExportMenuModel
    @State private var scope: ListExportScope
    @State private var isPresented = false

    private let selectedCount: Int
    private let visibleCount: Int?
    private let availability: ListExportAvailability

    /// Designated initializer binding a pre-built model. `selectedCount` gates + seeds the scope
    /// chooser (web `selectedCount` prop), `visibleCount` feeds the "Visible (N)" label (web
    /// `visibleCount` prop), and `availability` is the typed split of the web `disabled` prop.
    public init(
        model: ListExportMenuModel,
        selectedCount: Int = 0,
        visibleCount: Int? = nil,
        availability: ListExportAvailability = .ready
    ) {
        _model = State(initialValue: model)
        _scope = State(initialValue: ListExportMenuLogic.initialScope(selectedCount: selectedCount))
        self.selectedCount = selectedCount
        self.visibleCount = visibleCount
        self.availability = availability
    }

    /// Convenience initializer wiring the host export callbacks directly — the parity of mounting
    /// `<ListExportMenu onExportCsv={…} onExportJson={…} selectedCount visibleCount disabled />`. Each
    /// callback receives the effective scope the user chose.
    public init(
        onExportCsv: @escaping @MainActor (ListExportScope) -> Void,
        onExportJson: @escaping @MainActor (ListExportScope) -> Void,
        selectedCount: Int = 0,
        visibleCount: Int? = nil,
        availability: ListExportAvailability = .ready,
        telemetry: any ListExportMenuTelemetry = OSLogListExportMenuTelemetry()
    ) {
        self.init(
            model: ListExportMenuModel(
                onExportCsv: onExportCsv,
                onExportJson: onExportJson,
                telemetry: telemetry
            ),
            selectedCount: selectedCount,
            visibleCount: visibleCount,
            availability: availability
        )
    }

    public var body: some View {
        ListExportMenuTrigger(availability: availability) {
            if ListExportMenuLogic.canOpen(availability: availability) {
                isPresented = true
            }
        }
        .disabled(availability.isDisabled)
        .popover(isPresented: $isPresented, arrowEdge: .top) {
            ListExportMenuPopoverContent(
                scope: $scope,
                selectedCount: selectedCount,
                visibleCount: visibleCount,
                onExport: performExport
            )
            .presentationCompactAdaptation(.popover)
        }
        .onChange(of: selectedCount) { _, newValue in
            // Web `useEffect`: when the selection empties mid-menu, snap `selected` back to `visible`
            // so the chosen scope can never be unselectable.
            scope = ListExportMenuLogic.correctedScope(scope, selectedCount: newValue)
        }
        .onAppear { model.markAppeared() }
    }

    /// Closes the popover and hands the chosen format the effective scope — the web item `onClick`
    /// (`close(); void onExport{Csv,Json}(scope)`).
    private func performExport(_ format: ListExportFormat) {
        let effective = ListExportMenuLogic.effectiveScope(scope, selectedCount: selectedCount)
        isPresented = false
        model.export(format, scope: effective)
    }
}
