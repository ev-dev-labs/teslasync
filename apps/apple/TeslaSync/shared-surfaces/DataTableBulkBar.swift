//
//  DataTableBulkBar.swift
//  TeslaSync — P4 shared surface · 0209 · DataTableBulkBar (Apple)
//
//  The public API of the table selection toolbar — the SwiftUI parity of
//  `components/ui/DataTableBulkBar.tsx`. Like the web component it is driven entirely by its props
//  (`count`, `onClear`, and the optional bulk-action `children` slot); there is no fetcher. The view
//  binds through ``DataTableBulkBarModel`` for the clear routing, the once-only `view.opened` telemetry
//  (P1/S11), and the polite "{{count}} selected" announcement (the native peer of the web count span's
//  `aria-live="polite"`); composes the token-driven chrome (P1/S9); and pushes prop changes into the
//  holder via `.onChange` so a reused toolbar re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The table selection toolbar — the SwiftUI parity of `components/ui/DataTableBulkBar.tsx`. When at
/// least one row is selected it renders a tinted bar with a polite "{{count}} selected" label, the
/// caller's bulk-action buttons (the `actions` slot, web `children`), and a "Clear selection" button;
/// when nothing is selected it renders nothing (web `count <= 0` → `return null`). Mount it directly
/// above a selectable ``DataTable`` so bulk actions appear only while a selection exists.
public struct DataTableBulkBar<Actions: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        DataTableBulkBarSurface.slug
    }

    private let input: DataTableBulkBarInput
    private let onClear: (@MainActor () -> Void)?
    private let actions: Actions
    @State private var model: DataTableBulkBarModel

    /// The prop-style initializer — the parity of `<DataTableBulkBar count onClear>{children}</…>`.
    /// `count` is the number of selected rows (the bar hides at `<= 0`); `onClear` clears the selection
    /// (web `onClear`); the `actions` builder is the bulk-action slot (web `children`) and defaults to
    /// `EmptyView`, so a bare `DataTableBulkBar(count:onClear:)` renders just the count + clear button.
    public init(
        count: Int,
        onClear: @escaping @MainActor () -> Void,
        telemetry: any DataTableBulkBarTelemetry = OSLogDataTableBulkBarTelemetry(),
        announcer: any DataTableBulkBarAnnouncer = LiveDataTableBulkBarAnnouncer(),
        @ViewBuilder actions: () -> Actions = { EmptyView() }
    ) {
        let resolved = DataTableBulkBarInput(count: count, hasActions: Actions.self != EmptyView.self)
        input = resolved
        self.onClear = onClear
        self.actions = actions()
        _model = State(initialValue: DataTableBulkBarModel(
            input: resolved,
            onClear: onClear,
            telemetry: telemetry,
            announcer: announcer
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded count).
    public init(model: DataTableBulkBarModel, @ViewBuilder actions: () -> Actions = { EmptyView() }) {
        input = model.input
        onClear = nil
        self.actions = actions()
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.projection.isHidden {
                EmptyView()
            } else {
                DataTableBulkBarBar(model: model, actions: actions)
            }
        }
        .onAppear {
            model.start()
            model.announceSelectionIfVisible()
        }
        .onChange(of: input) { _, newInput in
            model.update(newInput, onClear: onClear)
        }
    }
}
