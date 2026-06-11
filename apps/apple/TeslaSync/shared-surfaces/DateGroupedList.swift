//
//  DateGroupedList.swift
//  TeslaSync — P4 shared surface · 0080 · DateGroupedList (Apple)
//
//  The SwiftUI parity of `components/data-display/DateGroupedList.tsx`: a generic, presentational
//  list that clusters items under horizontal-rule date dividers, with an optional per-group summary
//  on the right. Domain-specific aggregation (e.g. "2 drives · 6.2 mi") lives on the caller, so the
//  surface stays free of unit / format / fetch logic — exactly like the web component.
//
//  The view is generic over the item type and takes a `rowContent` builder (the native parity of the
//  web `renderItem` render-prop); the item payload never touches the model. It binds the non-generic
//  `DateGroupedListModel` state-holder (P1/S8) for the localized divider-header projection, the empty
//  decision, and the once-only `view.opened` telemetry (P1/S11); no networking lives in the view.
//
//  States (every one renders — no hidden / blank surface):
//    • populated — one or more groups → divider headers over the caller-rendered rows.
//    • empty     — no groups → a friendly empty state (web renders a blank container; P4 upgrades it).
//  The web source has no fetch, so there is no loading / error / stale / offline axis to reproduce —
//  fabricating a network chip here would be drift, not parity (cf. the Avatar / AnimatedNumber peers).
//

import SwiftUI

/// The date-grouped list — the SwiftUI parity of the web `DateGroupedList<T>`. Generic over the item
/// type, with a `rowContent` builder for each item (the `renderItem` parity); renders the divider
/// headers + rows when populated and a friendly empty state when there are no groups.
public struct DateGroupedList<Item, Row: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        DateGroupedListMeta.surfaceSlug
    }

    private let groups: [DateGroupedListGroup<Item>]
    private let itemSpacing: CGFloat
    private let groupSpacing: CGFloat
    private let itemKey: (Item, Int) -> AnyHashable
    private let rowContent: (Item, Int) -> Row

    @State private var model: DateGroupedListModel

    /// Designated initializer mirroring the web prop signature — the parity of mounting
    /// `<DateGroupedList groups={…} renderItem={…} itemKey={…} itemSpacing={…} groupSpacing={…} />`.
    /// `itemKey` defaults to the index (the web `itemKey ? … : index` fallback); `telemetry` is
    /// injectable (the `os.Logger` default in production, a spy in tests).
    public init(
        groups: [DateGroupedListGroup<Item>],
        itemSpacing: CGFloat = DateGroupedListMeta.defaultItemSpacing,
        groupSpacing: CGFloat = DateGroupedListMeta.defaultGroupSpacing,
        itemKey: @escaping (Item, Int) -> AnyHashable = { _, index in index },
        telemetry: any DateGroupedListTelemetry = OSLogDateGroupedListTelemetry(),
        @ViewBuilder rowContent: @escaping (Item, Int) -> Row
    ) {
        self.groups = groups
        self.itemSpacing = itemSpacing
        self.groupSpacing = groupSpacing
        self.itemKey = itemKey
        self.rowContent = rowContent
        _model = State(initialValue: DateGroupedListModel(
            input: DateGroupedListInput(headers: groups.map(\.header)),
            telemetry: telemetry
        ))
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: headerInput) { _, newInput in model.sync(newInput) }
    }

    /// The non-generic header snapshot derived from the generic groups (item payload dropped) — the
    /// value the model reasons over and the `onChange` key that re-syncs it when groups change.
    private var headerInput: DateGroupedListInput {
        DateGroupedListInput(headers: groups.map(\.header))
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case let .empty(empty):
            DateGroupedListEmptyView(content: empty)
        case let .populated(headers):
            DateGroupedListContent(
                headers: headers,
                groups: groups,
                itemSpacing: itemSpacing,
                groupSpacing: groupSpacing,
                itemKey: itemKey,
                rowContent: rowContent
            )
        }
    }
}
