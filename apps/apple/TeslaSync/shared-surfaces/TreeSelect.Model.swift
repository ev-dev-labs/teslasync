//
//  TreeSelect.Model.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The observable state-holder (P1/S8) for the tri-state tree multi-select. The view binds through
//  `TreeSelectModel`; no networking lives in the view. The web `TreeSelect` is a CONTROLLED primitive: the
//  parent owns `selectedIds`, `searchValue`, and the optional `expandedGroupIds`, and receives `onChange`
//  / `onSearchChange` / `onExpandedChange`. The model keeps that contract — a source emits the current
//  snapshot plus the parent's loading / error / connectivity, the model derives the render phase via the
//  pure ``TreeSelectProjection``, threads selection / search / expansion edits through the
//  ``TreeSelectEngine``, writes them back through the source (the web callbacks), voices the selection
//  summary politely (the web sr-only live region), and auto-refreshes once when the feed transitions to
//  stale.
//

import Foundation
import Observation

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `TreeSelectSource`, recomputes the resolved
/// projection, exposes the render `phase` + the filtered tree + the live selection + the expansion set +
/// the `connection` axis, threads leaf / group / select-all / clear / search / expand edits through the
/// pure ``TreeSelectEngine``, writes them back through the source (the web callbacks), voices the selection
/// summary politely (the web sr-only live region), and auto-refreshes once when the feed transitions to
/// stale.
@MainActor
@Observable
public final class TreeSelectModel {
    public private(set) var resolved: TreeSelectResolved = .init(phase: .loading)
    public private(set) var connection: TreeSelectConnection = .live

    /// The effective expanded-group set the rows render against (the web `expandedIds`). Observed so a
    /// toggle re-renders. While searching, ``isExpanded(_:)`` treats every group as open regardless.
    public private(set) var expandedIDs: Set<String> = []

    /// The live search box text the field binds to (the web controlled `searchValue`). Mirrors the
    /// snapshot and is updated as the user types via ``updateSearch(_:)``.
    public private(set) var searchText: String = ""

    /// The most-recent polite live-region text (web sr-only summary). Observed so a UI test can read what
    /// VoiceOver was asked to speak; the real voicing happens through the announcer seam.
    public private(set) var announcement = ""

    public var phase: TreeSelectResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private var current = TreeSelectSnapshot()
    @ObservationIgnored private let source: any TreeSelectSource
    @ObservationIgnored private let telemetry: any TreeSelectTelemetry
    @ObservationIgnored private let announcer: any TreeSelectAnnouncer
    @ObservationIgnored private var announceCounter = 0
    @ObservationIgnored private var hasInitializedExpansion = false
    @ObservationIgnored private var started = false

    public init(
        source: any TreeSelectSource,
        telemetry: any TreeSelectTelemetry = OSLogTreeSelectTelemetry(),
        announcer: any TreeSelectAnnouncer = OSLogTreeSelectAnnouncer()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.announcer = announcer
        source.onUpdate = { [weak self] snapshot in self?.applySnapshot(snapshot) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TreeSelectMeta.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Expansion (web toggleExpanded / isExpanded)

    /// Whether a group's leaves are shown — the web `isExpanded`: always true while searching (so matches
    /// are visible), otherwise membership in the effective expanded set.
    public func isExpanded(_ groupID: String) -> Bool {
        resolved.isSearching || expandedIDs.contains(groupID)
    }

    /// Toggle a group's expansion — the web `toggleExpanded`. A no-op while searching (the open state is
    /// computed). Writes the new set back through the source when expansion is controlled (web
    /// `onExpandedChange`).
    public func toggleExpanded(_ groupID: String) {
        guard !resolved.isSearching else { return }
        if expandedIDs.contains(groupID) {
            expandedIDs.remove(groupID)
        } else {
            expandedIDs.insert(groupID)
        }
        if current.expandedGroupIDs != nil {
            let ordered = current.groups.map(\.id).filter { expandedIDs.contains($0) }
            current.expandedGroupIDs = ordered
            source.commitExpanded(ordered)
        }
    }

    // MARK: Selection (web toggleLeaf / toggleGroup / toggleAllVisible / clearAll)

    /// Toggle a single leaf — the web `toggleLeaf`.
    public func toggleLeaf(_ leafID: String) {
        applySelection(TreeSelectEngine.toggleLeaf(leafID, in: current.selectedIDs))
    }

    /// Toggle a whole group's visible-enabled leaves — the web `toggleGroup`.
    public func toggleGroup(_ groupID: String) {
        applySelection(
            TreeSelectEngine.toggleGroup(
                groupID,
                filtered: resolved.filteredGroups,
                selected: current.selectedIDs
            )
        )
    }

    /// Toggle every visible-enabled leaf — the web `toggleAllVisible` ("Select visible" while searching).
    public func toggleAllVisible() {
        applySelection(
            TreeSelectEngine.toggleAllVisible(filtered: resolved.filteredGroups, selected: current.selectedIDs)
        )
    }

    /// Clear the entire selection — the web `clearAll`.
    public func clearAll() {
        applySelection([])
    }

    // MARK: Search (web onSearchChange)

    /// Update the search box — recomputes the filtered projection and writes the value back (web
    /// `onSearchChange`).
    public func updateSearch(_ text: String) {
        current.searchValue = text
        searchText = text
        resolved = TreeSelectProjection.resolve(current)
        source.commitSearch(text)
    }

    /// Clear the search box — the web search clear button.
    public func clearSearch() {
        updateSearch("")
    }

    // MARK: Derived row helpers (web per-group / per-leaf render data)

    /// The tri-state for a group header (web `allGroupSelected` / `someGroupSelected`).
    public func groupCheckState(_ group: TreeSelectGroup) -> TreeSelectCheckState {
        TreeSelectEngine.groupCheckState(group, selected: resolved.selected)
    }

    /// How many leaves in a group are selected (web `groupSelectedCount`, all leaves).
    public func groupSelectedCount(_ group: TreeSelectGroup) -> Int {
        TreeSelectEngine.selectedCount(of: group.leaves.map(\.id), in: resolved.selected)
    }

    /// Whether a leaf is selected.
    public func isLeafSelected(_ leafID: String) -> Bool {
        resolved.selected.contains(leafID)
    }

    /// The current screen-reader summary text (web sr-only live region content).
    public var summaryText: String {
        if resolved.isSearching {
            return TreeSelectStrings.summaryVisible(
                selected: resolved.selectedTotal,
                total: resolved.totalLeafCount,
                visible: resolved.visibleLeafCount
            )
        }
        return TreeSelectStrings.summary(selected: resolved.selectedTotal, total: resolved.totalLeafCount)
    }

    // MARK: Private

    private func applySelection(_ next: [String]) {
        guard next != current.selectedIDs else { return }
        current.selectedIDs = next
        resolved = TreeSelectProjection.resolve(current)
        source.commitSelection(next)
        voiceSummary()
    }

    private func applySnapshot(_ snapshot: TreeSelectSnapshot) {
        current = snapshot
        searchText = snapshot.searchValue
        resolved = TreeSelectProjection.resolve(snapshot)
        seedExpansion(from: snapshot)
        let previous = connection
        connection = snapshot.connection
        if snapshot.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Seed / refresh the expanded set from the snapshot. Controlled expansion (the host passes
    /// `expandedGroupIds`) is mirrored on every snapshot; uncontrolled expansion is owned by the model and
    /// initialized once to "all collapsed" (the web default), then preserved across host re-emits.
    private func seedExpansion(from snapshot: TreeSelectSnapshot) {
        if let controlled = snapshot.expandedGroupIDs {
            expandedIDs = Set(controlled)
        } else if !hasInitializedExpansion {
            expandedIDs = []
        }
        hasInitializedExpansion = true
    }

    /// Voice the selection summary politely — append the rotating zero-width padding so the assistive
    /// technology re-reads an identical consecutive summary, and post it (the web sr-only live region).
    private func voiceSummary() {
        announceCounter += 1
        let padded = summaryText + TreeSelectEngine.announcementPadding(sequence: announceCounter)
        announcement = padded
        announcer.announce(padded)
    }
}
