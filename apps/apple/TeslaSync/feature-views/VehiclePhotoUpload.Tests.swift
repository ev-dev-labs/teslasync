//
//  VehiclePhotoUpload.Tests.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  Adapter + projection coverage for the VehiclePhotoUpload surface:
//    • Validator — the web `validateVehiclePhotoFile` ladder (empty / size / mime), the
//      "absent type is not rejected" rule, and the case-insensitive + jpg-alias handling.
//    • Rejection copy — the key/fallback/interpolation each failure routes through P1/S10.
//    • MIME sniff — the magic-byte detection for raw drag-drop bytes.
//    • Constraints — the 8 MB cap, the "{{max}}" label, the allowed-MIME set, the field.
//    • Candidate — the declared → sniffed MIME resolution + the derived filename.
//    • Primary label — the web `Uploading… / Replace photo / Choose photo` ladder.
//    • Projection — the web preview branch plus the P4 leaf contract across loading /
//      empty / error / data, the local-preview override, and the cached-photo inline error.
//    • Accessibility — the composed dropzone VoiceOver label.
//    • Surface — the `view.opened` slug (P1/S11).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Validation (web `validateVehiclePhotoFile`)

final class VehiclePhotoValidatorTests: XCTestCase {
    func testZeroBytesIsEmpty() {
        XCTAssertEqual(VehiclePhotoValidator.validate(byteCount: 0, mimeType: "image/png"), .empty)
    }

    func testOverCapIsTooLarge() {
        let result = VehiclePhotoValidator.validate(byteCount: 8 * 1024 * 1024 + 1, mimeType: "image/jpeg")
        XCTAssertEqual(result, .tooLarge(limitMegabytes: "8"))
    }

    func testAtCapIsAccepted() {
        XCTAssertNil(VehiclePhotoValidator.validate(byteCount: 8 * 1024 * 1024, mimeType: "image/jpeg"))
    }

    func testUnsupportedTypeIsRejected() {
        XCTAssertEqual(
            VehiclePhotoValidator.validate(byteCount: 1024, mimeType: "image/gif"),
            .unsupportedType("image/gif")
        )
    }

    func testValidJPEGAndPNGAccepted() {
        XCTAssertNil(VehiclePhotoValidator.validate(byteCount: 1024, mimeType: "image/jpeg"))
        XCTAssertNil(VehiclePhotoValidator.validate(byteCount: 1024, mimeType: "image/png"))
    }

    func testJPGAliasAccepted() {
        XCTAssertNil(VehiclePhotoValidator.validate(byteCount: 1024, mimeType: "image/jpg"))
    }

    func testCaseInsensitiveMime() {
        XCTAssertNil(VehiclePhotoValidator.validate(byteCount: 1024, mimeType: "IMAGE/JPEG"))
    }

    func testAbsentMimeIsNotRejected() {
        // web: only a SUPPLIED, unsupported type is rejected — the server is authoritative.
        XCTAssertNil(VehiclePhotoValidator.validate(byteCount: 1024, mimeType: nil))
        XCTAssertNil(VehiclePhotoValidator.validate(byteCount: 1024, mimeType: ""))
    }

    func testSizeCheckPrecedesMime() {
        // An oversized file with a bad type still reports size first (web ladder order).
        XCTAssertEqual(
            VehiclePhotoValidator.validate(byteCount: 9_000_000, mimeType: "image/gif"),
            .tooLarge(limitMegabytes: "8")
        )
    }
}

// MARK: - Rejection copy (routed through P1/S10)

final class VehiclePhotoRejectionCopyTests: XCTestCase {
    func testEmptyCopy() {
        XCTAssertEqual(VehiclePhotoRejection.empty.messageKey, "vehicles.photos.errors.empty")
        XCTAssertEqual(VehiclePhotoRejection.empty.messageFallback, "Selected file is empty.")
        XCTAssertNil(VehiclePhotoRejection.empty.interpolation)
    }

    func testTooLargeCopyInterpolatesMax() {
        let rejection = VehiclePhotoRejection.tooLarge(limitMegabytes: "8")
        XCTAssertEqual(rejection.messageKey, "vehicles.photos.errors.tooLarge")
        XCTAssertEqual(rejection.messageFallback, "Photo exceeds {{max}} MB limit.")
        XCTAssertEqual(rejection.interpolation?.token, "{{max}}")
        XCTAssertEqual(rejection.interpolation?.value, "8")
    }

    func testUnsupportedTypeCopyInterpolatesType() {
        let rejection = VehiclePhotoRejection.unsupportedType("image/webp")
        XCTAssertEqual(rejection.messageKey, "vehicles.photos.errors.unsupportedType")
        XCTAssertEqual(rejection.interpolation?.token, "{{type}}")
        XCTAssertEqual(rejection.interpolation?.value, "image/webp")
    }
}

// MARK: - MIME sniff (drag-drop raw bytes)

final class VehiclePhotoMagicTests: XCTestCase {
    func testJPEGSignature() {
        XCTAssertEqual(VehiclePhotoMagic.mimeType(forLeadingBytes: [0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg")
    }

    func testPNGSignature() {
        let png: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]
        XCTAssertEqual(VehiclePhotoMagic.mimeType(forLeadingBytes: png), "image/png")
    }

    func testUnknownSignature() {
        XCTAssertNil(VehiclePhotoMagic.mimeType(forLeadingBytes: [0x00, 0x01, 0x02, 0x03]))
    }

    func testDataConvenience() {
        XCTAssertEqual(VehiclePhotoMagic.mimeType(for: Data([0xFF, 0xD8, 0xFF])), "image/jpeg")
    }
}

// MARK: - Constraints (web `VEHICLE_PHOTO_*`)

final class VehiclePhotoConstraintsTests: XCTestCase {
    func testMaxBytesMirrorsBackend() {
        XCTAssertEqual(VehiclePhotoConstraints.maxBytes, 8 * 1024 * 1024)
    }

    func testMaxMegabytesLabel() {
        XCTAssertEqual(VehiclePhotoConstraints.maxMegabytesLabel, "8")
    }

    func testAllowedMimeSet() {
        XCTAssertEqual(VehiclePhotoConstraints.allowedMimeTypes, ["image/jpeg", "image/jpg", "image/png"])
    }

    func testFormField() {
        XCTAssertEqual(VehiclePhotoConstraints.formField, "photo")
    }
}

// MARK: - Candidate (web `File` derivation)

final class VehiclePhotoCandidateTests: XCTestCase {
    func testUsesDeclaredMimeAndDerivesExtension() {
        let candidate = VehiclePhotoCandidate.make(data: Data([0x00, 0x01]), declaredMimeType: "image/png")
        XCTAssertEqual(candidate.mimeType, "image/png")
        XCTAssertEqual(candidate.filename, "vehicle-photo.png")
    }

    func testSniffsMimeWhenUndeclared() {
        let candidate = VehiclePhotoCandidate.make(data: Data([0xFF, 0xD8, 0xFF, 0xE0]))
        XCTAssertEqual(candidate.mimeType, "image/jpeg")
        XCTAssertEqual(candidate.filename, "vehicle-photo.jpg")
    }

    func testKeepsSuggestedName() {
        let candidate = VehiclePhotoCandidate.make(
            data: Data([0xFF, 0xD8, 0xFF]),
            suggestedName: "front.jpg"
        )
        XCTAssertEqual(candidate.filename, "front.jpg")
    }

    func testByteCountReflectsData() {
        XCTAssertEqual(VehiclePhotoCandidate.make(data: Data([1, 2, 3])).byteCount, 3)
        XCTAssertEqual(VehiclePhotoCandidate.make(data: Data()).byteCount, 0)
    }

    func testUnknownBytesYieldEmptyMimeAndNoExtension() {
        let candidate = VehiclePhotoCandidate.make(data: Data([0x00, 0x11, 0x22]))
        XCTAssertEqual(candidate.mimeType, "")
        XCTAssertEqual(candidate.filename, "vehicle-photo")
    }
}

// MARK: - Primary label ladder (web ternary)

final class VehiclePhotoPrimaryLabelTests: XCTestCase {
    func testUploadingWins() {
        let descriptor = VehiclePhotoPrimaryLabel.resolve(isUploading: true, hasPhoto: true)
        XCTAssertEqual(descriptor.key, "vehicles.photos.upload.uploading")
        XCTAssertEqual(descriptor.fallback, "Uploading…")
    }

    func testReplaceWhenHasPhoto() {
        let descriptor = VehiclePhotoPrimaryLabel.resolve(isUploading: false, hasPhoto: true)
        XCTAssertEqual(descriptor.key, "vehicles.photos.upload.replace")
    }

    func testChooseWhenNoPhoto() {
        let descriptor = VehiclePhotoPrimaryLabel.resolve(isUploading: false, hasPhoto: false)
        XCTAssertEqual(descriptor.key, "vehicles.photos.upload.choose")
    }
}

// MARK: - Projection (web preview branch + P4 leaf contract)

final class VehiclePhotoProjectionTests: XCTestCase {
    func testInitialLoading() {
        let phase = VehiclePhotoProjection.resolvePhase(
            status: .loading, hasPhoto: false, hasImageData: false, hasLocalPreview: false
        )
        XCTAssertEqual(phase, .loading)
    }

    func testEmptyWhenResolvedWithoutPhoto() {
        let phase = VehiclePhotoProjection.resolvePhase(
            status: .loaded, hasPhoto: false, hasImageData: false, hasLocalPreview: false
        )
        XCTAssertEqual(phase, .empty)
    }

    func testDataWhenPhotoBytesPresent() {
        let phase = VehiclePhotoProjection.resolvePhase(
            status: .loaded, hasPhoto: true, hasImageData: true, hasLocalPreview: false
        )
        XCTAssertEqual(phase, .data)
    }

    func testLocalPreviewOverridesToData() {
        let phase = VehiclePhotoProjection.resolvePhase(
            status: .loaded, hasPhoto: false, hasImageData: false, hasLocalPreview: true
        )
        XCTAssertEqual(phase, .data)
    }

    func testErrorWhenFirstLoadFailsWithNothingCached() {
        let phase = VehiclePhotoProjection.resolvePhase(
            status: .failed("boom"), hasPhoto: false, hasImageData: false, hasLocalPreview: false
        )
        XCTAssertEqual(phase, .error("boom"))
    }

    func testCachedPhotoSurvivesFailedReload() {
        let phase = VehiclePhotoProjection.resolvePhase(
            status: .failed("stale read"), hasPhoto: true, hasImageData: true, hasLocalPreview: false
        )
        XCTAssertEqual(phase, .data)
        XCTAssertEqual(
            VehiclePhotoProjection.inlineErrorMessage(phase: phase, status: .failed("stale read")),
            "stale read"
        )
    }

    func testPhotoMetadataWithoutBytesIsLoading() {
        let phase = VehiclePhotoProjection.resolvePhase(
            status: .loaded, hasPhoto: true, hasImageData: false, hasLocalPreview: false
        )
        XCTAssertEqual(phase, .loading)
    }

    func testInlineErrorNilWhenNotData() {
        XCTAssertNil(VehiclePhotoProjection.inlineErrorMessage(phase: .empty, status: .failed("x")))
    }

    func testInlineErrorNilWhenMessageEmpty() {
        XCTAssertNil(VehiclePhotoProjection.inlineErrorMessage(phase: .data, status: .failed("")))
    }
}

// MARK: - Accessibility (dropzone VoiceOver label)

final class VehiclePhotoAccessibilityTests: XCTestCase {
    func testDropzoneLabelJoinsParts() {
        let label = VehiclePhotoAccessibility.dropzoneLabel(
            title: "Vehicle photo",
            statePhrase: "Vehicle photo preview",
            constraints: "JPEG or PNG — up to 8 MB"
        )
        XCTAssertEqual(label, "Vehicle photo, Vehicle photo preview, JPEG or PNG — up to 8 MB")
    }

    func testDropzoneLabelDropsEmptyParts() {
        let label = VehiclePhotoAccessibility.dropzoneLabel(
            title: "Vehicle photo", statePhrase: "", constraints: ""
        )
        XCTAssertEqual(label, "Vehicle photo")
    }
}

// MARK: - Surface identity (P1/S11 view.opened)

final class VehiclePhotoSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(VehiclePhotoSurface.slug, "VehiclePhotoUpload")
    }

    func testViewSurfaceSlugMatchesSurface() {
        XCTAssertEqual(VehiclePhotoUpload.surfaceSlug, VehiclePhotoSurface.slug)
    }
}
