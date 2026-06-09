//
//  DoorWindowStatusWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0037 · DoorWindowStatusWidget (Apple)
//
//  The cached → view-ready projection: the two rows of four `DoorWindowStatusCell`s
//  (the doors grid + the windows grid, web `doorCells`/`windowCells` `useMemo`),
//  the open-count rollups the compact badges use, the compact-badge phrasing, and
//  the VoiceOver summary builders. Pure + dependency-free; the raw signal parsing
//  it composes lives in DoorWindowStatusWidget.Adapter.swift.
//

import Foundation

// MARK: - One projected cell (web `StatusCell`)

/// One cell in a 2-column status grid — the native port of the web `StatusCell`,
/// carrying its stable id, the resolved (localized) label + value, the spoken
/// accessibility value, and the status. `Identifiable` + `Equatable` so SwiftUI
/// can diff the grid and the projection can be asserted in tests.
public struct DoorWindowStatusCell: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let accessibilityValue: String
    public let status: DoorWindowCellStatus

    public init(
        id: String,
        label: String,
        value: String,
        accessibilityValue: String,
        status: DoorWindowCellStatus
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.accessibilityValue = accessibilityValue
        self.status = status
    }
}

// MARK: - Projection (web `doorCells` / `windowCells` useMemo + the counts)

/// The fully-resolved view model the grids render: the doors row, the windows
/// row, and the two open-counts the compact badges use. Built once per update.
public struct DoorWindowProjection: Equatable, Sendable {
    public let doorCells: [DoorWindowStatusCell]
    public let windowCells: [DoorWindowStatusCell]
    public let openDoorCount: Int
    public let openWindowCount: Int

    public init(
        doorCells: [DoorWindowStatusCell],
        windowCells: [DoorWindowStatusCell],
        openDoorCount: Int,
        openWindowCount: Int
    ) {
        self.doorCells = doorCells
        self.windowCells = windowCells
        self.openDoorCount = openDoorCount
        self.openWindowCount = openWindowCount
    }

    /// The no-data projection (web `if (!securityData)` branch — drives the
    /// widget's empty state). Empty rows, zero counts.
    public static let empty = DoorWindowProjection(
        doorCells: [],
        windowCells: [],
        openDoorCount: 0,
        openWindowCount: 0
    )
}

/// Builds the doors + windows cell rows and the open-counts from the cached
/// latest event, resolving every label/value through the injected localizer (so
/// it is bundle-free in tests). Returns `.empty` when there is no event — exactly
/// the web `if (!securityData)` branch.
public enum DoorWindowCellsBuilder {
    public static func build(
        latest: DoorWindowLatestInput?,
        localize: (String, String) -> String
    ) -> DoorWindowProjection {
        guard let latest else { return .empty }

        let doors = DoorWindowSignalParser.parseDoorStates(latest.doorState)
        let windows = DoorWindowSignalParser.windowStates(from: latest)

        return DoorWindowProjection(
            doorCells: cells(prefix: "door", states: doors, localize: localize),
            windowCells: cells(prefix: "window", states: windows, localize: localize),
            openDoorCount: DoorWindowSignalParser.openCount(doors: doors),
            openWindowCount: DoorWindowSignalParser.openCount(windows: windows)
        )
    }

    /// Projects one four-corner state set into ordered status cells (web
    /// `positions.map(...)`), keyed `"<prefix>-<pos>"`.
    private static func cells(
        prefix: String,
        states: DoorWindowStates,
        localize: (String, String) -> String
    ) -> [DoorWindowStatusCell] {
        DoorWindowPosition.allCases.map { position in
            let state = states[position]
            return DoorWindowStatusCell(
                id: "\(prefix)-\(position.rawValue)",
                label: localize(position.labelKey, position.labelFallback),
                value: state.valueLabel(localize: localize),
                accessibilityValue: state.accessibilityValue(localize: localize),
                status: state.gridStatus
            )
        }
    }
}

// MARK: - Compact badge text (web 1×1 badge labels)

/// The two computed badge strings of the web compact (1×1) layout, lifted out so
/// the count → phrase mapping is unit-testable and shared by the badge view + the
/// accessibility summary.
public enum DoorWindowBadgeText {
    /// Web: `openDoorCount === 0 ? 'Doors ✓' : '<n> door(s) open'`.
    public static func doors(openCount: Int, localize: (String, String) -> String) -> String {
        openCount == 0
            ? localize("widget.doorWindow.doorsAllClosed", "Doors ✓")
            : "\(openCount.formatted()) \(localize("widget.doorWindow.doorsOpen", "door(s) open"))"
    }

    /// Web: `openWindowCount === 0 ? 'Windows ✓' : '<n> window(s) open'`.
    public static func windows(openCount: Int, localize: (String, String) -> String) -> String {
        openCount == 0
            ? localize("widget.doorWindow.windowsAllClosed", "Windows ✓")
            : "\(openCount.formatted()) \(localize("widget.doorWindow.windowsOpen", "window(s) open"))"
    }

    /// The badge tone: success when nothing is open, warning otherwise (web
    /// `variant={openCount === 0 ? 'success' : 'warning'}`).
    public static func tone(openCount: Int) -> TSTone {
        openCount == 0 ? .success : .warning
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the cells, the section grids, and the compact
/// badge row. Pure + public so the spoken content can be unit-tested without
/// rendering the view.
public enum DoorWindowAccessibility {
    /// Per-cell label, e.g. "Front Left, Closed".
    public static func cellSummary(for cell: DoorWindowStatusCell) -> String {
        "\(cell.label), \(cell.accessibilityValue)"
    }

    /// One section's summary, e.g. "Doors. Front Left: Closed. Front Right: …".
    public static func sectionSummary(
        titleKey: String,
        titleFallback: String,
        cells: [DoorWindowStatusCell],
        localize: (String, String) -> String
    ) -> String {
        let title = localize(titleKey, titleFallback)
        guard !cells.isEmpty else { return title }
        let body = cells
            .map { "\($0.label): \($0.accessibilityValue)" }
            .joined(separator: ". ")
        return "\(title). \(body)"
    }

    /// The compact-badge summary (web 1×1 layout), e.g. "Doors ✓. 2 window(s)
    /// open" — reusing the same localized count phrasing the badges render.
    public static func compactSummary(
        openDoorCount: Int,
        openWindowCount: Int,
        localize: (String, String) -> String
    ) -> String {
        "\(DoorWindowBadgeText.doors(openCount: openDoorCount, localize: localize)). " +
            "\(DoorWindowBadgeText.windows(openCount: openWindowCount, localize: localize))"
    }
}
