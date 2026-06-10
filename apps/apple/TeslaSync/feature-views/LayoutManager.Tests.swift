//
//  LayoutManager.Tests.swift
//  TeslaSync — P4 feature view · 0125 · LayoutManager (Apple)
//
//  Unit coverage for the LayoutManager surface: the Adapter projections (tab
//  active flag + icon fallback, the drag/keyboard reorder math, the context-menu
//  item set + Delete gate, the `name.trim()` commit guard, the New-Layout
//  intent), the state accessors, the VoiceOver summaries, the i18n key parity
//  (referenced == the web keys), and the P1/S11 `view.opened` telemetry. No
//  network, no real store, no rendering host — the pure projections are exercised
//  directly.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum LayoutManagerFixture {
    static func layout(
        id: String,
        name: String = "Layout",
        icon: String? = nil,
        isDefault: Bool = false
    ) -> SavedLayoutData {
        SavedLayoutData(id: id, name: name, icon: icon, isDefault: isDefault)
    }

    static let layouts: [SavedLayoutData] = [
        layout(id: "a", name: "Overview", icon: "📊", isDefault: true),
        layout(id: "b", name: "Trips", icon: "🛣️"),
        layout(id: "c", name: "Charging")
    ]

    static func tabs(activeID: String) -> [LayoutTab] {
        LayoutTabProjection.tabs(from: layouts, activeID: activeID)
    }
}

// MARK: - Adapter: tab projection + icon fallback

@MainActor final class LayoutTabProjectionTests: XCTestCase {
    func testProjectionPreservesOrderAndDerivesActive() {
        let tabs = LayoutManagerFixture.tabs(activeID: "b")
        XCTAssertEqual(tabs.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(tabs.map(\.isActive), [false, true, false])
        XCTAssertEqual(tabs.map(\.name), ["Overview", "Trips", "Charging"])
    }

    func testIconFallbackMatchesWebNilCoalescing() {
        // Explicit icon is kept; nil falls back to the web default 📊.
        XCTAssertEqual(LayoutGlyph.icon(for: LayoutManagerFixture.layout(id: "x", icon: "⚡️")), "⚡️")
        XCTAssertEqual(LayoutGlyph.icon(for: LayoutManagerFixture.layout(id: "x", icon: nil)), "📊")
        XCTAssertEqual(LayoutGlyph.defaultIcon, "📊")
        let tabs = LayoutManagerFixture.tabs(activeID: "a")
        XCTAssertEqual(tabs[2].icon, "📊", "Charging has no icon → default glyph")
    }

    func testDefaultFlagThreadsThrough() {
        let tabs = LayoutManagerFixture.tabs(activeID: "a")
        XCTAssertTrue(tabs[0].isDefault)
        XCTAssertFalse(tabs[1].isDefault)
    }
}

// MARK: - Adapter: reorder math (web onReorder)

@MainActor final class LayoutReorderTests: XCTestCase {
    func testEdgeGuards() {
        XCTAssertFalse(LayoutReorder.canMoveLeft(index: 0))
        XCTAssertTrue(LayoutReorder.canMoveLeft(index: 1))
        XCTAssertTrue(LayoutReorder.canMoveRight(index: 0, count: 3))
        XCTAssertFalse(LayoutReorder.canMoveRight(index: 2, count: 3))
        XCTAssertFalse(LayoutReorder.canMoveRight(index: 0, count: 1))
    }

    func testDropMoveResolvesFromAndTo() {
        let tabs = LayoutManagerFixture.tabs(activeID: "a")
        // Drag "c" (index 2) onto index 0 → move (2, 0).
        XCTAssertEqual(
            LayoutReorder.dropMove(draggedID: "c", toIndex: 0, tabs: tabs),
            LayoutReorderMove(from: 2, to: 0)
        )
        // Drag "a" (index 0) onto index 1 → move (0, 1).
        XCTAssertEqual(
            LayoutReorder.dropMove(draggedID: "a", toIndex: 1, tabs: tabs),
            LayoutReorderMove(from: 0, to: 1)
        )
    }

    func testDropMoveIgnoresNoOpAndUnknown() {
        let tabs = LayoutManagerFixture.tabs(activeID: "a")
        XCTAssertNil(LayoutReorder.dropMove(draggedID: "b", toIndex: 1, tabs: tabs), "same index is a no-op")
        XCTAssertNil(LayoutReorder.dropMove(draggedID: "zzz", toIndex: 0, tabs: tabs), "unknown id")
        XCTAssertNil(LayoutReorder.dropMove(draggedID: "a", toIndex: 9, tabs: tabs), "out-of-range target")
    }
}

// MARK: - Adapter: context menu (web Rename/Duplicate/Settings/Delete)

@MainActor final class LayoutMenuTests: XCTestCase {
    func testMenuOrderMatchesWeb() {
        XCTAssertEqual(LayoutMenuItemKind.order, [.rename, .duplicate, .settings, .delete])
    }

    func testMenuLabelKeysAreExactWebKeys() {
        XCTAssertEqual(LayoutMenuItemKind.rename.labelKey, "dashboard.rename")
        XCTAssertEqual(LayoutMenuItemKind.duplicate.labelKey, "dashboard.duplicate")
        XCTAssertEqual(LayoutMenuItemKind.settings.labelKey, "dashboard.settings")
        XCTAssertEqual(LayoutMenuItemKind.delete.labelKey, "dashboard.delete")
    }

    func testMenuLabelFallbacksAndGlyphs() {
        XCTAssertEqual(LayoutMenuItemKind.rename.labelFallback, "Rename")
        XCTAssertEqual(LayoutMenuItemKind.delete.labelFallback, "Delete")
        XCTAssertEqual(LayoutMenuItemKind.rename.systemImage, "pencil")
        XCTAssertEqual(LayoutMenuItemKind.duplicate.systemImage, "doc.on.doc")
        XCTAssertEqual(LayoutMenuItemKind.settings.systemImage, "gearshape")
        XCTAssertEqual(LayoutMenuItemKind.delete.systemImage, "trash")
        XCTAssertTrue(LayoutMenuItemKind.delete.isDestructive)
        XCTAssertFalse(LayoutMenuItemKind.rename.isDestructive)
    }

    func testDeleteGatedOnDefaultLayout() {
        // Web `disabled={!!ctxDash.isDefault}` — only Delete, only on the default.
        XCTAssertFalse(LayoutMenuItemKind.isEnabled(.delete, isDefault: true))
        XCTAssertTrue(LayoutMenuItemKind.isEnabled(.delete, isDefault: false))
        XCTAssertTrue(LayoutMenuItemKind.isEnabled(.rename, isDefault: true))
        XCTAssertTrue(LayoutMenuItemKind.isEnabled(.settings, isDefault: true))
        XCTAssertTrue(LayoutMenuItemKind.isEnabled(.duplicate, isDefault: true))
    }
}

// MARK: - Adapter: name input + create intent

@MainActor final class LayoutNameInputTests: XCTestCase {
    func testSanitizeTrims() {
        XCTAssertEqual(LayoutNameInput.sanitized("  Road Trips  "), "Road Trips")
        XCTAssertEqual(LayoutNameInput.sanitized("\n\tMixed\t"), "Mixed")
    }

    func testCommittableMatchesWebTruthyTrim() {
        XCTAssertTrue(LayoutNameInput.isCommittable("Trips"))
        XCTAssertFalse(LayoutNameInput.isCommittable("   "))
        XCTAssertFalse(LayoutNameInput.isCommittable(""))
    }

    func testCreateIntentResolvesTemplatesVsInline() {
        XCTAssertEqual(LayoutCreateIntent.resolve(hasTemplates: true), .openTemplates)
        XCTAssertEqual(LayoutCreateIntent.resolve(hasTemplates: false), .inlineCreate)
    }

    func testActionsHasTemplatesReflectsOptionalCallback() {
        let withTemplates = LayoutManagerActions(
            onSwitch: { _ in }, onCreate: { _ in }, onRename: { _, _ in }, onDelete: { _ in },
            onReorder: { _, _ in }, onDuplicate: { _ in }, onOpenSettings: { _ in },
            onOpenTemplates: {}
        )
        let withoutTemplates = LayoutManagerActions(
            onSwitch: { _ in }, onCreate: { _ in }, onRename: { _, _ in }, onDelete: { _ in },
            onReorder: { _, _ in }, onDuplicate: { _ in }, onOpenSettings: { _ in }
        )
        XCTAssertTrue(withTemplates.hasTemplates)
        XCTAssertFalse(withoutTemplates.hasTemplates)
    }
}

// MARK: - State accessors + connection

@MainActor final class LayoutManagerStateTests: XCTestCase {
    func testLoadedAccessors() {
        let state = LayoutManagerState.loaded(layouts: LayoutManagerFixture.layouts, activeID: "b")
        XCTAssertEqual(state.layouts.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(state.activeID, "b")
    }

    func testNonLoadedAccessors() {
        XCTAssertTrue(LayoutManagerState.loading.layouts.isEmpty)
        XCTAssertNil(LayoutManagerState.loading.activeID)
        XCTAssertTrue(LayoutManagerState.empty.layouts.isEmpty)
        XCTAssertNil(LayoutManagerState.error(message: nil).activeID)
    }

    func testConnectionFlags() {
        XCTAssertTrue(LayoutLiveConnection.stale.isStale)
        XCTAssertFalse(LayoutLiveConnection.stale.isOffline)
        XCTAssertTrue(LayoutLiveConnection.offline.isOffline)
        XCTAssertFalse(LayoutLiveConnection.live.isStale)
        XCTAssertFalse(LayoutLiveConnection.live.isOffline)
    }
}

// MARK: - Accessibility + i18n key parity

@MainActor final class LayoutManagerAccessibilityTests: XCTestCase {
    private let echo = LayoutManagerLocalizer.echo

    func testTabLabelComposesNameAndDefault() {
        let tabs = LayoutManagerFixture.tabs(activeID: "a")
        XCTAssertEqual(LayoutManagerAccessibility.tabLabel(tabs[0], localize: echo), "Overview, default")
        XCTAssertEqual(LayoutManagerAccessibility.tabLabel(tabs[1], localize: echo), "Trips")
    }

    func testReorderActionLabels() {
        XCTAssertEqual(LayoutManagerAccessibility.moveLeftLabel(echo), "Move left")
        XCTAssertEqual(LayoutManagerAccessibility.moveRightLabel(echo), "Move right")
    }

    /// Guards that the inline/menu keys the surface references are exactly the web
    /// keys — a regression here means the folded catalog would miss a string.
    func testWebKeyParity() {
        XCTAssertEqual(LayoutManagerCopy.confirmRename.key, "dashboard.confirmRename")
        XCTAssertEqual(LayoutManagerCopy.cancelRename.key, "dashboard.cancelRename")
        XCTAssertEqual(LayoutManagerCopy.defaultBadge.key, "dashboard.default")
        XCTAssertEqual(LayoutManagerCopy.newName.key, "dashboard.newName")
        XCTAssertEqual(LayoutManagerCopy.confirmCreate.key, "dashboard.confirmCreate")
        XCTAssertEqual(LayoutManagerCopy.cancelCreate.key, "dashboard.cancelCreate")
        XCTAssertEqual(LayoutManagerCopy.newLayout.key, "dashboard.newLayout")
        XCTAssertEqual(LayoutManagerCopy.newName.fallback, "Layout name...")
        XCTAssertEqual(LayoutManagerCopy.newLayout.fallback, "New Layout")
    }

    func testCopyCatalogHasNoEmptyEntries() {
        for entry in LayoutManagerCopy.all {
            XCTAssertFalse(entry.key.isEmpty, "empty key")
            XCTAssertFalse(entry.fallback.isEmpty, "empty fallback for \(entry.key)")
            XCTAssertEqual(entry.resolved(echo), entry.fallback, "echo localizer yields fallback")
        }
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor final class LayoutManagerTelemetryTests: XCTestCase {
    private final class Recorder: LayoutManagerTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [String] = []
        var surfaces: [String] {
            lock.lock(); defer { lock.unlock() }
            return stored
        }

        func viewOpened(surface: String) {
            lock.lock(); stored.append(surface); lock.unlock()
        }
    }

    @MainActor
    func testReportOpenEmitsSlug() {
        let recorder = Recorder()
        LayoutManagerSurface.reportOpen(to: recorder)
        XCTAssertEqual(recorder.surfaces, ["LayoutManager"])
        XCTAssertEqual(LayoutManager.surfaceSlug, "LayoutManager")
    }
}
