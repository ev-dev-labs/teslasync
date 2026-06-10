//
//  VehiclePhotoUpload.Adapter.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  The testable projection core for the vehicle-photo uploader — the SwiftUI parity of
//  features/vehicles/components/VehiclePhotoUpload.tsx. Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view, no networking) so the photo
//  metadata model, the client-side validation (the web `validateVehiclePhotoFile`
//  ladder), the magic-byte MIME sniff, the constraints label (web `{{max}} MB`), the
//  primary-button label ladder (web `Uploading… / Replace photo / Choose photo`), and
//  the picked-file → candidate derivation are all unit tested in isolation.
//
//  Parity note: the web component validates a candidate file against the backend's caps
//  (8 MB, JPEG/PNG) BEFORE firing a doomed upload, builds an instant preview from the
//  picked bytes, and shows a "Replace"/"Choose" CTA plus a "Remove" affordance gated on
//  the photo metadata's `has_photo`. This core reproduces the data + derivations; the
//  chrome lives in the view layer. The web hook hardcodes its validation copy in
//  English; native routes each failure reason through the P1/S10 facade via the
//  reason's key/fallback so the surface holds no hardcoded English in the view layer.
//

import Foundation

// MARK: - Photo metadata (web `VehiclePhotoMeta`)

/// The slice of the web `VehiclePhotoMeta` the uploader consumes: whether a photo exists
/// (`has_photo`, drives the "Remove" affordance + the empty/data branch) and the upload
/// timestamp (`uploaded_at`, the cache-bust identity the web threads through `?v=`).
/// Carried verbatim from the API — no SI conversion applies to identity metadata.
public struct VehiclePhotoMeta: Equatable, Sendable {
    /// Web `has_photo` — the "no photo" signal is `false`, never a 404.
    public let hasPhoto: Bool
    /// Web `uploaded_at` — the ISO instant of the last upload, or `nil` when absent.
    public let uploadedAt: String?

    public init(hasPhoto: Bool, uploadedAt: String? = nil) {
        self.hasPhoto = hasPhoto
        self.uploadedAt = uploadedAt
    }

    /// The web "no photo" default (`has_photo:false`) — the absent-photo metadata.
    public static let absent = VehiclePhotoMeta(hasPhoto: false, uploadedAt: nil)
}

// MARK: - Constraints (web `VEHICLE_PHOTO_*`)

/// The client-side upload caps mirroring the backend — the native port of the web
/// `VEHICLE_PHOTO_MAX_BYTES`, `VEHICLE_PHOTO_ALLOWED_MIME`, and `VEHICLE_PHOTO_FORM_FIELD`.
/// Kept as one value so the validator + the constraints label + the writer agree.
public enum VehiclePhotoConstraints {
    /// Web `VEHICLE_PHOTO_MAX_BYTES` — the 8 MB hard cap (mirrors `MaxUploadBytes`).
    public static let maxBytes = 8 * 1024 * 1024

    /// Web `VEHICLE_PHOTO_ALLOWED_MIME` — JPEG/PNG only (WebP is intentionally absent;
    /// the stdlib decode path has no WebP decoder).
    public static let allowedMimeTypes: Set<String> = ["image/jpeg", "image/jpg", "image/png"]

    /// Web `VEHICLE_PHOTO_FORM_FIELD` — the multipart field name the backend expects.
    public static let formField = "photo"

    /// Web `(VEHICLE_PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(0)` — the megabyte label
    /// interpolated into the constraints string ("up to {{max}} MB").
    public static var maxMegabytesLabel: String {
        String(maxBytes / (1024 * 1024))
    }
}

// MARK: - Validation (web `validateVehiclePhotoFile`)

/// Why a candidate file was rejected — the native mirror of the web
/// `VehiclePhotoValidationError.reason` (`empty | size | mime`). Each reason carries the
/// data the localized message interpolates so the copy resolves through the facade.
public enum VehiclePhotoRejection: Equatable, Sendable {
    /// No file, or a zero-byte file (web `!file` / `file.size <= 0`).
    case empty
    /// Over the byte cap (web `file.size > VEHICLE_PHOTO_MAX_BYTES`).
    case tooLarge(limitMegabytes: String)
    /// A supplied MIME type outside the allowed set (web `file.type && !allowed.has`).
    case unsupportedType(String)

    /// The P1/S10 key for the failure toast (native chrome; the web hook hardcodes these).
    public var messageKey: String {
        switch self {
        case .empty: "vehicles.photos.errors.empty"
        case .tooLarge: "vehicles.photos.errors.tooLarge"
        case .unsupportedType: "vehicles.photos.errors.unsupportedType"
        }
    }

    /// The English fallback for the failure toast — the web hook's literal copy.
    public var messageFallback: String {
        switch self {
        case .empty: "Selected file is empty."
        case .tooLarge: "Photo exceeds {{max}} MB limit."
        case .unsupportedType: "Unsupported image type: {{type}}"
        }
    }

    /// The `{{token}}` + value the localized message interpolates, when any.
    public var interpolation: (token: String, value: String)? {
        switch self {
        case .empty: nil
        case let .tooLarge(limit): ("{{max}}", limit)
        case let .unsupportedType(type): ("{{type}}", type)
        }
    }
}

/// Validates a candidate against the size + MIME caps — the pure port of the web
/// `validateVehiclePhotoFile`. Returns the rejection reason, or `nil` when the file is
/// acceptable. The server still does the authoritative check (web comment).
public enum VehiclePhotoValidator {
    /// - Parameters:
    ///   - byteCount: the candidate's size in bytes (web `file.size`).
    ///   - mimeType: the candidate's MIME type, or `nil` when the source omits it. As on
    ///     the web, an absent type is NOT rejected — only a supplied, unsupported type is.
    public static func validate(byteCount: Int, mimeType: String?) -> VehiclePhotoRejection? {
        guard byteCount > 0 else { return .empty }
        if byteCount > VehiclePhotoConstraints.maxBytes {
            return .tooLarge(limitMegabytes: VehiclePhotoConstraints.maxMegabytesLabel)
        }
        if let mimeType, !mimeType.isEmpty {
            let normalized = mimeType.lowercased()
            if !VehiclePhotoConstraints.allowedMimeTypes.contains(normalized) {
                return .unsupportedType(mimeType)
            }
        }
        return nil
    }
}

// MARK: - MIME sniff (drag-drop raw bytes carry no declared type)

/// Detects an image MIME type from a buffer's leading magic bytes — used when a drag-drop
/// or file source hands over raw bytes with no declared type, so the validator + the
/// upload still get the project's canonical `image/jpeg` / `image/png`. Pure + testable.
public enum VehiclePhotoMagic {
    private static let jpegPrefix: [UInt8] = [0xFF, 0xD8, 0xFF]
    private static let pngPrefix: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

    /// The sniffed MIME type (`image/jpeg` / `image/png`), or `nil` when the bytes match
    /// no known signature.
    public static func mimeType(forLeadingBytes bytes: [UInt8]) -> String? {
        if bytes.starts(with: jpegPrefix) { return "image/jpeg" }
        if bytes.starts(with: pngPrefix) { return "image/png" }
        return nil
    }

    /// Convenience over `Data` — sniffs the first bytes of the buffer.
    public static func mimeType(for data: Data) -> String? {
        mimeType(forLeadingBytes: Array(data.prefix(pngPrefix.count)))
    }
}

// MARK: - Candidate (web `File` handed to the upload)

/// One pickable image — the native mirror of the web `File` passed to `startUpload`:
/// the raw bytes, a filename for the multipart part, and the resolved MIME type. Built
/// from a `PhotosPicker` item or a drag-drop, with the MIME sniffed from the bytes when
/// the source omits it (and a sensible extension chosen to match).
public struct VehiclePhotoCandidate: Equatable, Sendable {
    public let data: Data
    public let filename: String
    public let mimeType: String

    public init(data: Data, filename: String, mimeType: String) {
        self.data = data
        self.filename = filename
        self.mimeType = mimeType
    }

    /// The candidate's size in bytes (web `file.size`).
    public var byteCount: Int {
        data.count
    }

    /// Builds a candidate from raw bytes, resolving the MIME type (declared → sniffed →
    /// empty) and deriving a filename + extension that matches. An empty buffer yields a
    /// candidate the validator rejects as `.empty`.
    public static func make(
        data: Data,
        declaredMimeType: String? = nil,
        suggestedName: String? = nil
    ) -> VehiclePhotoCandidate {
        let resolved = resolveMime(declared: declaredMimeType, data: data)
        let name = filename(suggested: suggestedName, mimeType: resolved)
        return VehiclePhotoCandidate(data: data, filename: name, mimeType: resolved)
    }

    /// declared type when present, else the sniffed type, else empty (the validator
    /// treats empty as "unknown" and defers to the server, matching the web).
    private static func resolveMime(declared: String?, data: Data) -> String {
        if let declared, !declared.isEmpty { return declared.lowercased() }
        return VehiclePhotoMagic.mimeType(for: data) ?? ""
    }

    /// A non-empty filename: the source's suggestion, else "vehicle-photo" plus the
    /// extension implied by the MIME type.
    private static func filename(suggested: String?, mimeType: String) -> String {
        if let suggested, !suggested.trimmingCharacters(in: .whitespaces).isEmpty {
            return suggested
        }
        return "vehicle-photo\(fileExtension(forMimeType: mimeType))"
    }

    /// The dotted file extension for a MIME type (".jpg"/".png"), or "" when unknown.
    private static func fileExtension(forMimeType mimeType: String) -> String {
        switch mimeType.lowercased() {
        case "image/jpeg", "image/jpg": ".jpg"
        case "image/png": ".png"
        default: ""
        }
    }
}

// MARK: - Primary-button label (web ternary ladder)

/// The primary CTA's label resolution — the native port of the web ladder
/// `isUploading ? 'Uploading…' : hasPhoto ? 'Replace photo' : 'Choose photo'`. Returns a
/// key/fallback pair so the view resolves it through the facade; unit tested per branch.
public enum VehiclePhotoPrimaryLabel {
    public static func resolve(isUploading: Bool, hasPhoto: Bool) -> (key: String, fallback: String) {
        if isUploading {
            return ("vehicles.photos.upload.uploading", "Uploading…")
        }
        if hasPhoto {
            return ("vehicles.photos.upload.replace", "Replace photo")
        }
        return ("vehicles.photos.upload.choose", "Choose photo")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the dropzone's VoiceOver summary from already-localized parts, so the spoken
/// content is asserted without rendering the view. Mirrors the surface: the title, the
/// current preview state, and the constraints read as one phrase.
public enum VehiclePhotoAccessibility {
    /// The dropzone's spoken label: "{title}, {statePhrase}, {constraints}", dropping any
    /// empty parts so a bare zone still reads cleanly.
    public static func dropzoneLabel(title: String, statePhrase: String, constraints: String) -> String {
        [title, statePhrase, constraints]
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
