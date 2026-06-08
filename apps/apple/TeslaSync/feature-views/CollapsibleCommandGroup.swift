//
//  CollapsibleCommandGroup.swift
//  TeslaSync — P4 feature view · 0224 · CollapsibleCommandGroup (Apple)
//
//  Native, Apple-idiomatic parity of the web `CollapsibleCommandGroup`
//  (features/system/components/CollapsibleCommandGroup.tsx).
//
//  A presentational disclosure container that groups a category's command tiles
//  behind a toggle. Like the web source it owns no data — the only state it holds
//  is the per-(vehicle, category) open flag, which it persists exactly the way the
//  web mirrors `sessionStorage`: here through SwiftUI `@SceneStorage`, whose
//  per-scene, non-durable lifetime is the native analogue of `sessionStorage`.
//  The cache/loading/error/stale/offline states belong to whatever command tiles
//  the caller embeds, not to this container (the same contract as `ToolCard`).
//
//  Composition (web parity):
//    • a ghost toggle button — category glyph + uppercased label + `({count})` +
//      a chevron that rotates 180° when open;
//    • when open, a `TSFadeIn`-wrapped adaptive grid of the caller's tiles
//      (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`), or a friendly empty
//      state when the group has no commands (P4 leaf "never a blank box").
//
//  On appear it emits the P1/S11 `view.opened` diagnostics event with
//  ``CollapsibleCommandGroupSurface/slug``.
//

import SwiftUI

public struct CollapsibleCommandGroup<Content: View>: View {
    private let projection: CollapsibleCommandGroupProjection
    private let defaultOpen: Bool
    private let telemetry: any CollapsibleCommandGroupTelemetry
    private let content: Content

    /// Per-(vehicle, category) open flag. `@SceneStorage` is the native analogue
    /// of the web `sessionStorage`: scene-scoped and non-durable. An empty string
    /// means "never toggled" (web `stored === null`) and defers to `defaultOpen`.
    @SceneStorage private var storedFlag: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Designated initialiser.
    /// - Parameters:
    ///   - category: the command category this group represents (web `category`).
    ///   - vehicleID: the owning vehicle (web `vehicleId`); part of the storage key.
    ///   - commandCount: the number of commands in the group (web `count`).
    ///   - defaultOpen: the initial open state when nothing is persisted (web `defaultOpen`).
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    ///   - content: the caller-supplied command tiles (web `children`).
    public init(
        category: CollapsibleCommandCategory,
        vehicleID: Int,
        commandCount: Int,
        defaultOpen: Bool = false,
        telemetry: any CollapsibleCommandGroupTelemetry = OSLogCollapsibleCommandGroupTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        let resolved = CollapsibleCommandGroupAdapter.project(
            category: category,
            vehicleID: vehicleID,
            commandCount: commandCount
        )
        projection = resolved
        self.defaultOpen = defaultOpen
        self.telemetry = telemetry
        self.content = content()
        _storedFlag = SceneStorage(wrappedValue: "", resolved.storageKey)
    }

    /// The resolved open state (web `stored !== null ? stored === 'true' : defaultOpen`).
    private var isExpanded: Bool {
        CollapsibleCommandGroupAdapter.resolveExpansion(
            stored: storedFlag.isEmpty ? nil : storedFlag,
            defaultOpen: defaultOpen
        )
    }

    private var gridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            toggleButton
            if isExpanded {
                expandedContent
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { CollapsibleCommandGroupSurface.reportOpen(to: telemetry) }
    }

    // MARK: Toggle (web `<ControlButton variant="ghost" … aria-expanded>`)

    private var toggleButton: some View {
        Button(action: toggle) {
            CollapsibleCommandGroupHeaderContent(
                projection: projection,
                isExpanded: isExpanded,
                reduceMotion: reduceMotion
            )
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
        .accessibilityValue(Text(verbatim: projection.accessibilityValue(expanded: isExpanded)))
        .accessibilityHint(Text(verbatim: CollapsibleCommandGroupStrings.string(
            "collapsibleGroup.a11y.toggleHint",
            "Double tap to show or hide the commands"
        )))
    }

    private func toggle() {
        let next = CollapsibleCommandGroupAdapter.flag(forExpanded: !isExpanded)
        if reduceMotion {
            storedFlag = next
        } else {
            withAnimation(.easeInOut(duration: TSMotion.normalDuration)) {
                storedFlag = next
            }
        }
    }

    // MARK: Expanded body (web `open && <FadeIn><div class="grid …">{children}`)

    private var expandedContent: some View {
        TSFadeIn {
            Group {
                if projection.isEmpty {
                    CollapsibleCommandGroupEmptyContent(projection: projection)
                } else {
                    LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.md) {
                        content
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, TSSpacing.xs)
        }
        .transition(reduceMotion ? .identity : .opacity)
    }
}
