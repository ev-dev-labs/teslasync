//
//  selectedVehicle.Tests.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  Adapter + store + accessibility coverage for the selectedVehicle surface:
//    • `SelectedVehicleStoreIdParser` — the web `loadInitial` / `parseId` parity (finite,
//      positive → value; everything else → nil; overflow rejected, not trapped).
//    • `SelectedVehicleStoreResolver` — the URL > store > first precedence, the write-back
//      decisions (URL adoption + first-vehicle default), and the render projection across
//      loading / loaded (content + empty) / failed.
//    • `SelectedVehicleStoreCopy` — the "{{name}}" interpolations + persistence notes.
//    • `SelectedVehicleStoreAccessibility` — the per-phase VoiceOver summary content.
//    • `SelectedVehicleStore` — the web `SelectedVehicleProvider` parity: hydrate, set, clear,
//      cross-scene sync, in-session-only (ephemeral) + no-provider (disconnected) fallbacks.
//
//  Pure, bundle-free: copy resolves through an identity localizer. State-holder (view-model)
//  coverage lives in selectedVehicle.ModelTests.swift.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy
/// without a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum SelectedVehicleStoreSample {
    static let fleet: [SelectedVehicleStoreSummary] = [
        SelectedVehicleStoreSummary(id: 1, displayName: "Midnight Model 3"),
        SelectedVehicleStoreSummary(id: 2, displayName: "Pearl Model Y")
    ]
}

// MARK: - Id parser (web loadInitial / parseId)

final class SelectedVehicleStoreIdParserTests: XCTestCase {
    func testNilAndEmptyResolveToNil() {
        XCTAssertNil(SelectedVehicleStoreIdParser.parse(nil))
        XCTAssertNil(SelectedVehicleStoreIdParser.parse(""))
        XCTAssertNil(SelectedVehicleStoreIdParser.parse("   "))
    }

    func testGarbageResolvesToNil() {
        XCTAssertNil(SelectedVehicleStoreIdParser.parse("not-a-number"))
    }

    func testNonPositiveResolvesToNil() {
        XCTAssertNil(SelectedVehicleStoreIdParser.parse("0"))
        XCTAssertNil(SelectedVehicleStoreIdParser.parse("-5"))
    }

    func testPositiveIntegerParses() {
        XCTAssertEqual(SelectedVehicleStoreIdParser.parse("42"), 42)
    }

    func testWhitespaceIsTrimmed() {
        XCTAssertEqual(SelectedVehicleStoreIdParser.parse("  7  "), 7)
    }

    func testIntegralDecimalParses() {
        XCTAssertEqual(SelectedVehicleStoreIdParser.parse("42.0"), 42)
    }

    func testOverflowingMagnitudeIsRejectedNotTrapped() {
        XCTAssertNil(SelectedVehicleStoreIdParser.parse("1e309"))
    }
}

// MARK: - Resolver: precedence + write-back

final class SelectedVehicleStoreResolverTests: XCTestCase {
    func testEffectiveIdPrefersUrlThenStoreThenFirst() {
        XCTAssertEqual(
            SelectedVehicleStoreResolver.effectiveId(urlId: 3, storedId: 2, firstVehicleId: 1),
            3
        )
        XCTAssertEqual(
            SelectedVehicleStoreResolver.effectiveId(urlId: nil, storedId: 2, firstVehicleId: 1),
            2
        )
        XCTAssertEqual(
            SelectedVehicleStoreResolver.effectiveId(urlId: nil, storedId: nil, firstVehicleId: 1),
            1
        )
        XCTAssertNil(
            SelectedVehicleStoreResolver.effectiveId(urlId: nil, storedId: nil, firstVehicleId: nil)
        )
    }

    func testUrlAdoptionWritesOnlyWhenUrlDiffers() {
        XCTAssertEqual(SelectedVehicleStoreResolver.urlAdoption(urlId: 5, storedId: 2), 5)
        XCTAssertNil(SelectedVehicleStoreResolver.urlAdoption(urlId: 2, storedId: 2))
        XCTAssertNil(SelectedVehicleStoreResolver.urlAdoption(urlId: nil, storedId: 2))
    }

    func testFirstVehicleDefaultOnlyWhenStoreEmpty() {
        XCTAssertEqual(
            SelectedVehicleStoreResolver.firstVehicleDefault(storedId: nil, firstVehicleId: 1),
            1
        )
        XCTAssertNil(SelectedVehicleStoreResolver.firstVehicleDefault(storedId: 2, firstVehicleId: 1))
        XCTAssertNil(SelectedVehicleStoreResolver.firstVehicleDefault(storedId: nil, firstVehicleId: nil))
    }
}

// MARK: - Resolver: render projection

final class SelectedVehicleStoreProjectionTests: XCTestCase {
    func testLoadingFleetResolvesLoading() {
        let projection = SelectedVehicleStoreResolver.build(storedId: nil, urlId: nil, fleet: .loading)
        XCTAssertEqual(projection.phase, .loading)
        XCTAssertNil(projection.selected)
    }

    func testFailedFleetResolvesErrorWithMessage() {
        let projection = SelectedVehicleStoreResolver.build(
            storedId: 1,
            urlId: nil,
            fleet: .failed(message: "Network unreachable")
        )
        XCTAssertEqual(projection.phase, .error("Network unreachable"))
        XCTAssertEqual(projection.errorMessage, "Network unreachable")
    }

    func testEmptyFleetResolvesEmptyWithNoCandidate() {
        let projection = SelectedVehicleStoreResolver.build(storedId: nil, urlId: nil, fleet: .loaded([]))
        XCTAssertEqual(projection.phase, .empty)
        XCTAssertNil(projection.candidate)
        XCTAssertNil(projection.selected)
    }

    func testStoredSelectionResolvesContent() {
        let projection = SelectedVehicleStoreResolver.build(
            storedId: 2,
            urlId: nil,
            fleet: .loaded(SelectedVehicleStoreSample.fleet)
        )
        XCTAssertEqual(projection.phase, .content)
        XCTAssertEqual(projection.selected?.id, 2)
        XCTAssertEqual(projection.effectiveId, 2)
    }

    func testEmptyStoreDefaultsToFirstVehicleContent() {
        let projection = SelectedVehicleStoreResolver.build(
            storedId: nil,
            urlId: nil,
            fleet: .loaded(SelectedVehicleStoreSample.fleet)
        )
        XCTAssertEqual(projection.phase, .content)
        XCTAssertEqual(projection.selected?.id, 1)
    }

    func testUrlOverridesStore() {
        let projection = SelectedVehicleStoreResolver.build(
            storedId: 1,
            urlId: 2,
            fleet: .loaded(SelectedVehicleStoreSample.fleet)
        )
        XCTAssertEqual(projection.selected?.id, 2)
    }

    func testUnmatchedStoredIdResolvesEmptyWithCandidate() {
        let projection = SelectedVehicleStoreResolver.build(
            storedId: 99,
            urlId: nil,
            fleet: .loaded(SelectedVehicleStoreSample.fleet)
        )
        XCTAssertEqual(projection.phase, .empty)
        XCTAssertEqual(projection.candidate?.id, 1)
        XCTAssertEqual(projection.effectiveId, 99)
    }
}

// MARK: - Copy interpolation

final class SelectedVehicleStoreCopyTests: XCTestCase {
    func testSelectionBodyInterpolatesName() {
        XCTAssertEqual(
            SelectedVehicleStoreCopy.selectionBody(name: "Midnight Model 3", localize: passthroughLocalize),
            "Midnight Model 3 is your focused vehicle across TeslaSync."
        )
    }

    func testSelectCandidateLabelInterpolatesName() {
        XCTAssertEqual(
            SelectedVehicleStoreCopy.selectCandidateLabel(name: "Pearl Model Y", localize: passthroughLocalize),
            "Select Pearl Model Y"
        )
    }

    func testPersistenceNotePerState() {
        XCTAssertEqual(
            SelectedVehicleStoreCopy.persistenceNote(.persisted, localize: passthroughLocalize),
            "Saved on this device."
        )
        XCTAssertTrue(
            SelectedVehicleStoreCopy.persistenceNote(.ephemeral, localize: passthroughLocalize)
                .contains("session only")
        )
        XCTAssertTrue(
            SelectedVehicleStoreCopy.persistenceNote(.disconnected, localize: passthroughLocalize)
                .contains("isn't being tracked")
        )
    }
}

// MARK: - Accessibility summaries

final class SelectedVehicleStoreAccessibilityTests: XCTestCase {
    private func summary(storedId: Int?, fleet: SelectedVehicleStoreFleetState) -> String {
        SelectedVehicleStoreAccessibility.summary(
            for: SelectedVehicleStoreResolver.build(storedId: storedId, urlId: nil, fleet: fleet),
            localize: passthroughLocalize
        )
    }

    func testLoadingSummary() {
        XCTAssertEqual(summary(storedId: nil, fleet: .loading), "Loading your vehicles…")
    }

    func testContentSummaryIncludesVehicleName() {
        let label = summary(storedId: 2, fleet: .loaded(SelectedVehicleStoreSample.fleet))
        XCTAssertTrue(label.contains("Selected vehicle"))
        XCTAssertTrue(label.contains("Pearl Model Y"))
    }

    func testEmptySummaryIncludesTitleAndDescription() {
        let label = summary(storedId: nil, fleet: .loaded([]))
        XCTAssertTrue(label.contains("No vehicle selected"))
        XCTAssertTrue(label.contains("Add a vehicle to your fleet"))
    }

    func testErrorSummaryIncludesTitleAndMessage() {
        let label = summary(storedId: nil, fleet: .failed(message: "Network unreachable"))
        XCTAssertTrue(label.contains("Couldn't load your vehicles"))
        XCTAssertTrue(label.contains("Network unreachable"))
    }
}

// MARK: - Store (web SelectedVehicleProvider parity)

@MainActor
final class SelectedVehicleStoreTests: XCTestCase {
    func testStartsNilWhenStorageEmpty() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage())
        XCTAssertNil(store.vehicleId)
        XCTAssertEqual(store.persistence, .persisted)
    }

    func testHydratesFromStorageOnInit() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 42))
        XCTAssertEqual(store.vehicleId, 42)
    }

    func testSetVehicleIdUpdatesAndPersists() {
        let storage = InMemorySelectedVehicleStorage()
        let store = SelectedVehicleStore(storage: storage)
        store.setVehicleId(7)
        XCTAssertEqual(store.vehicleId, 7)
        XCTAssertEqual(storage.read(), 7)
    }

    func testSetVehicleIdNilClearsPersistedValue() {
        let storage = InMemorySelectedVehicleStorage(initial: 7)
        let store = SelectedVehicleStore(storage: storage)
        store.setVehicleId(nil)
        XCTAssertNil(store.vehicleId)
        XCTAssertNil(storage.read())
    }

    func testRespondsToCrossSceneStorageChanges() {
        let storage = InMemorySelectedVehicleStorage()
        let store = SelectedVehicleStore(storage: storage)
        store.startObservingExternalChanges()
        XCTAssertNil(store.vehicleId)
        storage.simulateExternalChange(to: 99)
        XCTAssertEqual(store.vehicleId, 99)
        storage.simulateExternalChange(to: nil)
        XCTAssertNil(store.vehicleId)
        store.stopObservingExternalChanges()
    }

    func testUnavailableStorageKeepsSelectionInSessionAsEphemeral() {
        let store = SelectedVehicleStore(storage: UnavailableSelectedVehicleStorage())
        XCTAssertEqual(store.persistence, .ephemeral)
        store.setVehicleId(5)
        XCTAssertEqual(store.vehicleId, 5)
        XCTAssertEqual(store.persistence, .ephemeral)
    }

    func testDisconnectedStoreIsNoOp() {
        let store = SelectedVehicleStore.disconnected()
        XCTAssertNil(store.vehicleId)
        XCTAssertEqual(store.persistence, .disconnected)
        store.setVehicleId(3)
        XCTAssertNil(store.vehicleId)
        XCTAssertEqual(store.persistence, .disconnected)
    }

    func testUserDefaultsStorageRoundTripsAndRejectsGarbage() throws {
        let suiteName = "selectedVehicle.test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let storage = UserDefaultsSelectedVehicleStorage(defaults: defaults, key: "k")

        XCTAssertNil(storage.read())
        storage.write(42)
        XCTAssertEqual(storage.read(), 42)
        defaults.set("not-a-number", forKey: "k")
        XCTAssertNil(storage.read())
        defaults.set("0", forKey: "k")
        XCTAssertNil(storage.read())
        storage.write(nil)
        XCTAssertNil(storage.read())
    }
}
