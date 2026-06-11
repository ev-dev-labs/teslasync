//
//  ActiveFilterChips.swift
//  TeslaSync — P4 shared surface · 0147 · ActiveFilterChips (Apple)
//
//  The public API of the active-filter chip strip — the SwiftUI parity of
//  `components/forms/ActiveFilterChips.tsx`. Like the web component it is driven entirely by its props
//  (`filters`, optional `onClearAll`, `hideWhenEmpty`, `maxVisible`); there is no fetcher. The view binds
//  through ``ActiveFilterChipsModel`` for the once-only `view.opened` telemetry (P1/S11), the overflow
//  popover state, and the polite removal / clear-all announcements (web live region); composes the
//  token-driven chrome (P1/S9) in a wrapping flow layout; and pushes prop changes into the holder via
//  `.onChange` so a reused strip re-renders faithfully. No networking, no Tailwind ports.
//
//  URL-state parity: exactly like the web, the page owns the URL-state. Each chip carries its own
//  `onRemove` (web `descriptor.onRemove`) and the strip optionally takes an `onClearAll`; the strip never
//  rewrites the URL itself — it routes every removal back out through those page-supplied closures.
//

import SwiftUI

// MARK: - ActiveFilterChip (web `FilterChipDescriptor`, with its `onRemove`)

/// One chip the page passes in — the native peer of the web `FilterChipDescriptor`, carrying its
/// `onRemove` closure (web `onRemove: () => void`). `id` matches the web `key` (typically the URL
/// search-param name). The strip splits this into the closure-free ``FilterChipDescriptor`` for its
/// projection and holds the closure in the state-holder, keeping the value types `Equatable`/`Sendable`.
public struct ActiveFilterChip {
    public let id: String
    public let label: String
    public let value: String
    public let onRemove: @MainActor () -> Void

    public init(id: String, label: String, value: String, onRemove: @escaping @MainActor () -> Void) {
        self.id = id
        self.label = label
        self.value = value
        self.onRemove = onRemove
    }

    /// The closure-free value used by the projection.
    var descriptor: FilterChipDescriptor {
        FilterChipDescriptor(id: id, label: label, value: value)
    }
}

// MARK: - ActiveFilterChips (the shared surface)

/// The active-filter chip strip — the SwiftUI parity of `components/forms/ActiveFilterChips.tsx`. Renders
/// one chip per active filter ("Vehicle: Model 3 ×"), an optional "Clear all", and (past `maxVisible`) a
/// "+N more" overflow popover, plus a polite announcement on every removal. Mounted immediately after a
/// filter bar so users always see what is filtering the current view.
public struct ActiveFilterChips: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ActiveFilterChipsSurface.slug

    private let input: ActiveFilterChipsInput
    private let filters: [ActiveFilterChip]
    private let onClearAll: (@MainActor () -> Void)?
    @State private var model: ActiveFilterChipsModel

    /// The prop-style initializer — the parity of `<ActiveFilterChips filters onClearAll hideWhenEmpty
    /// maxVisible>`. `filters` are the active chips (each with its own `onRemove`); `onClearAll` enables
    /// the "Clear all" affordance; `hideWhenEmpty` (default true) renders nothing when empty; `maxVisible`
    /// (default 8) caps the inline chips before the rest collapse into "+N more".
    public init(
        filters: [ActiveFilterChip],
        onClearAll: (@MainActor () -> Void)? = nil,
        hideWhenEmpty: Bool = true,
        maxVisible: Int = 8,
        telemetry: any ActiveFilterChipsTelemetry = OSLogActiveFilterChipsTelemetry(),
        announcer: any ActiveFilterChipsAnnouncer = LiveActiveFilterChipsAnnouncer()
    ) {
        let resolved = ActiveFilterChipsInput(
            filters: filters.map(\.descriptor),
            hasClearAll: onClearAll != nil,
            hideWhenEmpty: hideWhenEmpty,
            maxVisible: maxVisible
        )
        input = resolved
        self.filters = filters
        self.onClearAll = onClearAll
        _model = State(initialValue: ActiveFilterChipsModel(
            input: resolved,
            removeHandlers: Self.handlers(from: filters),
            onClearAll: onClearAll,
            telemetry: telemetry,
            announcer: announcer
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: ActiveFilterChipsModel) {
        input = model.input
        filters = []
        onClearAll = nil
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.projection.isHidden {
                EmptyView()
            } else {
                strip
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput, removeHandlers: Self.handlers(from: filters), onClearAll: onClearAll)
        }
    }

    /// The flow-laid strip — the inline chips, the "+N more" trigger, and "Clear all" (or the friendly
    /// empty placeholder for the kept-empty group), labelled "Active filters" as one VoiceOver group.
    private var strip: some View {
        let projection = model.projection
        return ActiveFilterChipsFlowLayout {
            if projection.isEmpty {
                ActiveFilterChipsEmptyView()
            } else {
                ForEach(projection.visible) { descriptor in
                    FilterChipView(
                        descriptor: descriptor,
                        removeLabel: ActiveFilterChipsStrings.removeAria(label: descriptor.label)
                    ) { model.remove(descriptor) }
                }
                if projection.partition.hasOverflow {
                    ActiveFilterChipsOverflowControl(model: model, overflow: projection.overflow)
                }
                if projection.showsClearAll {
                    ActiveFilterChipsClearAllButton(model: model)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ActiveFilterChipsStrings.activeLabel))
    }

    /// Builds the `id -> onRemove` map the state-holder routes removals through.
    private static func handlers(from filters: [ActiveFilterChip]) -> [String: @MainActor () -> Void] {
        var handlers: [String: @MainActor () -> Void] = [:]
        for chip in filters {
            handlers[chip.id] = chip.onRemove
        }
        return handlers
    }
}
