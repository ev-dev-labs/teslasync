//
//  TOTPEnrollmentSection.Source.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  The in-memory `TOTPEnrollmentSource` that previews + unit tests drive the
//  surface with (the production app supplies a real implementation over the
//  shared P1/S8 state holders). Seeds an optional initial status snapshot on
//  `start()`, lets a test push further snapshots via `push(_:)`, and returns
//  caller-configured mutation outcomes while recording call counts. No network,
//  no real store. Also defines the deterministic sample enrollment used by both.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial status
/// snapshot on `start()`, lets a test push further snapshots via `push(_:)`, and
/// returns caller-configured mutation outcomes while recording call counts. No
/// network, no real store.
@MainActor
public final class InMemoryTOTPEnrollmentSource: TOTPEnrollmentSource {
    public var onUpdate: (@MainActor (TOTPEnrollmentUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var enrollCount = 0
    public private(set) var verifiedCodes: [String] = []
    public private(set) var revokeCount = 0
    public private(set) var regenerateCount = 0

    /// The enrollment returned by `enroll()` (web mutation result).
    public var enrollResult: TOTPEnrollmentData
    /// When non-nil, `verify(code:)` throws it; otherwise it succeeds.
    public var verifyFailure: TOTPVerifyError?
    /// The codes returned by `regenerateBackupCodes()`.
    public var regenerateResult: [String]
    /// When non-nil, `enroll()` / `revoke()` / `regenerate()` throw it.
    public var actionFailure: Error?

    private let initial: TOTPEnrollmentUpdate?

    public init(
        initial: TOTPEnrollmentUpdate? = nil,
        enrollResult: TOTPEnrollmentData = .preview,
        verifyFailure: TOTPVerifyError? = nil,
        regenerateResult: [String] = ["regen-1111", "regen-2222"],
        actionFailure: Error? = nil
    ) {
        self.initial = initial
        self.enrollResult = enrollResult
        self.verifyFailure = verifyFailure
        self.regenerateResult = regenerateResult
        self.actionFailure = actionFailure
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func enroll() async throws -> TOTPEnrollmentData {
        enrollCount += 1
        if let actionFailure { throw actionFailure }
        return enrollResult
    }

    public func verify(code: String) async throws {
        verifiedCodes.append(code)
        if let verifyFailure { throw verifyFailure }
    }

    public func revoke() async throws {
        revokeCount += 1
        if let actionFailure { throw actionFailure }
    }

    public func regenerateBackupCodes() async throws -> [String] {
        regenerateCount += 1
        if let actionFailure { throw actionFailure }
        return regenerateResult
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: TOTPEnrollmentUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Sample enrollment

public extension TOTPEnrollmentData {
    /// A deterministic sample enrollment for previews + the in-memory source.
    static let preview = TOTPEnrollmentData(
        secret: "JBSWY3DPEHPK3PXP",
        otpauthURI: "otpauth://totp/TeslaSync:owner?secret=JBSWY3DPEHPK3PXP&issuer=TeslaSync",
        qrDataURI: "data:image/png;base64,iVBORw0KGgo=",
        backupCodes: [
            "11aa-22bb", "33cc-44dd", "55ee-66ff",
            "77gg-88hh", "99ii-00jj", "abcd-efgh"
        ],
        expiresAt: nil
    )
}
