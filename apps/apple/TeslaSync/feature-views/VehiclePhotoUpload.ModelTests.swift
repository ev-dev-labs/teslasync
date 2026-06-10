//
//  VehiclePhotoUpload.ModelTests.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  Lifecycle + binding coverage for `VehiclePhotoUploadModel`: the `view.opened` telemetry
//  (once + idempotent), the start/stop/refresh plumbing to the source, the snapshot →
//  meta/image/connection/phase application, the validate → upload flow (success toast +
//  refresh, rejection toast with no request, backend-failure toast), the delete-confirm
//  flow (open/cancel, success toast + refresh, failure toast), the stale → one-shot
//  auto-refresh transition, and the toast dismiss. Driven by the in-memory source +
//  recording writer double, with no network.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Test doubles

private final class CountingVehiclePhotoTelemetry: VehiclePhotoTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

/// Echo localizer: returns the English fallback verbatim so toast copy is asserted with no
/// loaded catalog (interpolation is then applied by the model).
private let echoLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private func validCandidate() -> VehiclePhotoCandidate {
    VehiclePhotoCandidate(
        data: Data([0xFF, 0xD8, 0xFF, 0xE0, 0x01, 0x02, 0x03, 0x04]),
        filename: "vehicle-photo.jpg",
        mimeType: "image/jpeg"
    )
}

// MARK: - Lifecycle + telemetry

@MainActor
final class VehiclePhotoUploadModelLifecycleTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let source = InMemoryVehiclePhotoSource()
        let telemetry = CountingVehiclePhotoTelemetry()
        let model = VehiclePhotoUploadModel(source: source, telemetry: telemetry)

        model.start()
        model.start()

        XCTAssertEqual(telemetry.opened, [VehiclePhotoSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopStopsSourceAndAllowsRestart() {
        let source = InMemoryVehiclePhotoSource()
        let telemetry = CountingVehiclePhotoTelemetry()
        let model = VehiclePhotoUploadModel(source: source, telemetry: telemetry)

        model.start()
        model.stop()
        model.start()

        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(telemetry.opened.count, 2)
    }

    func testInitialPhaseIsLoading() {
        let model = VehiclePhotoUploadModel(source: InMemoryVehiclePhotoSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryVehiclePhotoSource()
        let model = VehiclePhotoUploadModel(source: source)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Snapshot application

@MainActor
final class VehiclePhotoUploadModelSnapshotTests: XCTestCase {
    func testAppliesMetaImageConnectionAndPhase() {
        let source = InMemoryVehiclePhotoSource()
        let model = VehiclePhotoUploadModel(source: source)
        model.start()

        let bytes = Data([0x89, 0x50, 0x4E, 0x47])
        source.push(VehiclePhotoUpdate(
            status: .loaded,
            meta: VehiclePhotoMeta(hasPhoto: true, uploadedAt: "2024-05-01T10:00:00Z"),
            imageData: bytes,
            connection: .offline
        ))

        XCTAssertTrue(model.hasPhoto)
        XCTAssertEqual(model.displayImageData, bytes)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
    }

    func testEmptyResolvesToEmptyPhase() {
        let source = InMemoryVehiclePhotoSource()
        let model = VehiclePhotoUploadModel(source: source)
        model.start()

        source.push(VehiclePhotoUpdate(status: .loaded, meta: .absent))

        XCTAssertFalse(model.hasPhoto)
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailureResolvesToError() {
        let source = InMemoryVehiclePhotoSource()
        let model = VehiclePhotoUploadModel(source: source)
        model.start()

        source.push(VehiclePhotoUpdate(status: .failed("offline"), meta: .absent))

        XCTAssertEqual(model.phase, .error("offline"))
    }

    func testStaleTransitionTriggersOneShotRefresh() {
        let source = InMemoryVehiclePhotoSource()
        let model = VehiclePhotoUploadModel(source: source)
        model.start()

        source.push(VehiclePhotoUpdate(status: .loaded, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale does not re-trigger the auto-refresh.
        source.push(VehiclePhotoUpdate(status: .loaded, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // A live episode re-arms the one-shot.
        source.push(VehiclePhotoUpdate(status: .loaded, connection: .live))
        source.push(VehiclePhotoUpdate(status: .loaded, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPrimaryLabelReflectsPhotoPresence() {
        let source = InMemoryVehiclePhotoSource()
        let model = VehiclePhotoUploadModel(source: source, localize: echoLocalize)
        model.start()

        source.push(VehiclePhotoUpdate(status: .loaded, meta: .absent))
        XCTAssertEqual(model.primaryLabel, "Choose photo")

        source.push(VehiclePhotoUpdate(
            status: .loaded,
            meta: VehiclePhotoMeta(hasPhoto: true),
            imageData: Data([0xFF, 0xD8, 0xFF])
        ))
        XCTAssertEqual(model.primaryLabel, "Replace photo")
    }
}

// MARK: - Upload flow (web `startUpload`)

@MainActor
final class VehiclePhotoUploadModelUploadTests: XCTestCase {
    func testValidUploadRaisesSuccessToastAndRefreshes() async {
        let source = InMemoryVehiclePhotoSource()
        let writer = RecordingVehiclePhotoWriter(uploadResult: .success)
        let model = VehiclePhotoUploadModel(source: source, writer: writer, localize: echoLocalize)

        await model.choose(validCandidate())

        let uploads = await writer.uploadCount
        XCTAssertEqual(uploads, 1)
        XCTAssertEqual(model.toast?.kind, .success)
        XCTAssertEqual(model.toast?.message, "Photo uploaded.")
        XCTAssertFalse(model.isUploading)
        XCTAssertNil(model.localPreview)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testRejectedFileRaisesErrorToastAndSkipsUpload() async {
        let source = InMemoryVehiclePhotoSource()
        let writer = RecordingVehiclePhotoWriter()
        let model = VehiclePhotoUploadModel(source: source, writer: writer, localize: echoLocalize)

        let badCandidate = VehiclePhotoCandidate(
            data: Data([0x47, 0x49, 0x46]), filename: "anim.gif", mimeType: "image/gif"
        )
        await model.choose(badCandidate)

        let uploads = await writer.uploadCount
        XCTAssertEqual(uploads, 0)
        XCTAssertEqual(model.toast?.kind, .error)
        XCTAssertEqual(model.toast?.message, "Unsupported image type: image/gif")
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testUploadFailureRaisesBackendMessageAndClearsPreview() async {
        let source = InMemoryVehiclePhotoSource()
        let writer = RecordingVehiclePhotoWriter(uploadResult: .failure("Upload failed (413)"))
        let model = VehiclePhotoUploadModel(source: source, writer: writer, localize: echoLocalize)

        await model.choose(validCandidate())

        XCTAssertEqual(model.toast?.kind, .error)
        XCTAssertEqual(model.toast?.message, "Upload failed (413)")
        XCTAssertNil(model.localPreview)
        XCTAssertFalse(model.isUploading)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testUploadFailureWithEmptyMessageUsesFallback() async {
        let source = InMemoryVehiclePhotoSource()
        let writer = RecordingVehiclePhotoWriter(uploadResult: .failure(""))
        let model = VehiclePhotoUploadModel(source: source, writer: writer, localize: echoLocalize)

        await model.choose(validCandidate())

        XCTAssertEqual(model.toast?.message, "Photo upload failed.")
    }
}

// MARK: - Delete flow (web `handleRemove` + `ConfirmDialog`)

@MainActor
final class VehiclePhotoUploadModelDeleteTests: XCTestCase {
    func testRequestRemoveOpensAndCancelCloses() {
        let model = VehiclePhotoUploadModel(source: InMemoryVehiclePhotoSource())

        model.requestRemove()
        XCTAssertTrue(model.pendingRemove)

        model.cancelRemove()
        XCTAssertFalse(model.pendingRemove)
    }

    func testConfirmRemoveSuccessRaisesToastAndRefreshes() async {
        let source = InMemoryVehiclePhotoSource()
        let writer = RecordingVehiclePhotoWriter(deleteResult: .success)
        let model = VehiclePhotoUploadModel(source: source, writer: writer, localize: echoLocalize)

        await model.confirmRemove()

        let deletes = await writer.deleteCount
        XCTAssertEqual(deletes, 1)
        XCTAssertEqual(model.toast?.kind, .success)
        XCTAssertEqual(model.toast?.message, "Photo removed.")
        XCTAssertFalse(model.isRemoving)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConfirmRemoveFailureRaisesErrorToast() async {
        let source = InMemoryVehiclePhotoSource()
        let writer = RecordingVehiclePhotoWriter(deleteResult: .failure("Delete failed (500)"))
        let model = VehiclePhotoUploadModel(source: source, writer: writer, localize: echoLocalize)

        await model.confirmRemove()

        XCTAssertEqual(model.toast?.kind, .error)
        XCTAssertEqual(model.toast?.message, "Delete failed (500)")
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Toast dismiss

@MainActor
final class VehiclePhotoUploadModelToastTests: XCTestCase {
    func testDismissToastClears() async {
        let writer = RecordingVehiclePhotoWriter(uploadResult: .success)
        let model = VehiclePhotoUploadModel(
            source: InMemoryVehiclePhotoSource(), writer: writer, localize: echoLocalize
        )

        await model.choose(validCandidate())
        XCTAssertNotNil(model.toast)

        model.dismissToast()
        XCTAssertNil(model.toast)
    }
}
