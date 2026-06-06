import SwiftUI

/// One timeline entry.
public struct TSTimelineEntry: Identifiable {
    public let id: String
    public let title: LocalizedStringKey
    public let detail: LocalizedStringKey?
    public let timestamp: String
    public let tone: TSTone
    public let systemImage: String?

    public init(
        id: String,
        title: LocalizedStringKey,
        detail: LocalizedStringKey? = nil,
        timestamp: String,
        tone: TSTone = .accent,
        systemImage: String? = nil
    ) {
        self.id = id
        self.title = title
        self.detail = detail
        self.timestamp = timestamp
        self.tone = tone
        self.systemImage = systemImage
    }
}

/// Vertical connected timeline (web `Timeline`).
public struct TSTimeline: View {
    private let entries: [TSTimelineEntry]

    public init(entries: [TSTimelineEntry]) {
        self.entries = entries
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.id) { offset, entry in
                TSTimelineItem(entry: entry, isLast: offset == entries.count - 1)
            }
        }
    }
}

/// A single timeline row with its connector (web `TimelineItem`).
public struct TSTimelineItem: View {
    private let entry: TSTimelineEntry
    private let isLast: Bool

    public init(entry: TSTimelineEntry, isLast: Bool = false) {
        self.entry = entry
        self.isLast = isLast
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(spacing: 0) {
                Circle().fill(entry.tone.color).frame(width: 10, height: 10)
                if !isLast {
                    Rectangle().fill(Color.TS.border).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack {
                    Text(entry.title).font(Font.TS.bodySm).fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer()
                    TSCaption(LocalizedStringKey(entry.timestamp))
                }
                if let detail = entry.detail {
                    Text(detail).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                }
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.md)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Recent activity feed (web `RecentActivityFeed`).
public struct TSRecentActivityFeed: View {
    private let entries: [TSTimelineEntry]

    public init(entries: [TSTimelineEntry]) {
        self.entries = entries
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(entries) { entry in
                HStack(spacing: TSSpacing.md) {
                    TSIconBox(systemName: entry.systemImage ?? "circle.fill", tone: entry.tone)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                        if let detail = entry.detail {
                            Text(detail).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                        }
                    }
                    Spacer()
                    TSCaption(LocalizedStringKey(entry.timestamp))
                }
            }
        }
    }
}

/// A date-grouped section of rows (web `DateGroupedList`).
public struct TSDateGroupedList<Row: View>: View {
    private let groups: [TSDateGroup]
    private let row: (String) -> Row

    public init(groups: [TSDateGroup], @ViewBuilder row: @escaping (String) -> Row) {
        self.groups = groups
        self.row = row
    }

    public var body: some View {
        LazyVStack(alignment: .leading, spacing: TSSpacing.md, pinnedViews: [.sectionHeaders]) {
            ForEach(groups) { group in
                Section {
                    ForEach(group.itemIDs, id: \.self) { itemID in
                        row(itemID)
                    }
                } header: {
                    TSLabel(LocalizedStringKey(group.dateLabel))
                        .padding(.vertical, TSSpacing.xs)
                }
            }
        }
    }
}

/// A date bucket of row identifiers for `TSDateGroupedList`.
public struct TSDateGroup: Identifiable {
    public let id: String
    public let dateLabel: String
    public let itemIDs: [String]

    public init(id: String, dateLabel: String, itemIDs: [String]) {
        self.id = id
        self.dateLabel = dateLabel
        self.itemIDs = itemIDs
    }
}

/// Bulk-action toolbar shown above a selection (web `BulkActionsToolbar`).
public struct TSBulkActionsToolbar<Actions: View>: View {
    private let selectedCount: Int
    private let onClear: () -> Void
    private let actions: () -> Actions

    public init(selectedCount: Int, onClear: @escaping () -> Void, @ViewBuilder actions: @escaping () -> Actions) {
        self.selectedCount = selectedCount
        self.onClear = onClear
        self.actions = actions
    }

    public var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text("table.selectedCount \(selectedCount)").font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
            Spacer()
            actions()
            Button("table.clearSelection", action: onClear)
                .buttonStyle(.plain)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.accent)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

/// A saved view entry.
public struct TSSavedView: Identifiable {
    public let id: String
    public let name: LocalizedStringKey

    public init(id: String, name: LocalizedStringKey) {
        self.id = id
        self.name = name
    }
}

/// Saved-view picker menu (web `SavedViewMenu`).
public struct TSSavedViewMenu: View {
    private let views: [TSSavedView]
    private let onSelect: (TSSavedView) -> Void
    private let onSaveCurrent: () -> Void

    public init(
        views: [TSSavedView],
        onSelect: @escaping (TSSavedView) -> Void,
        onSaveCurrent: @escaping () -> Void
    ) {
        self.views = views
        self.onSelect = onSelect
        self.onSaveCurrent = onSaveCurrent
    }

    public var body: some View {
        Menu {
            ForEach(views) { view in
                Button(view.name) { onSelect(view) }
            }
            Divider()
            Button("savedView.saveCurrent", systemImage: "plus", action: onSaveCurrent)
        } label: {
            Label("savedView.title", systemImage: "bookmark")
        }
    }
}

/// A compact history row (web `HistoryListRow`).
public struct TSHistoryListRow: View {
    private let title: LocalizedStringKey
    private let subtitle: LocalizedStringKey?
    private let timestamp: String
    private let onTap: (() -> Void)?

    public init(
        title: LocalizedStringKey,
        subtitle: LocalizedStringKey? = nil,
        timestamp: String,
        onTap: (() -> Void)? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.timestamp = timestamp
        self.onTap = onTap
    }

    public var body: some View {
        Button {
            onTap?()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                    if let subtitle {
                        Text(subtitle).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                    }
                }
                Spacer()
                TSCaption(LocalizedStringKey(timestamp))
                if onTap != nil {
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(Color.TS.textMuted)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(onTap == nil)
    }
}
