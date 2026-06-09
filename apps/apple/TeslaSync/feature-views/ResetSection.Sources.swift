//
//  ResetSection.Sources.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  The in-memory P1/S8 seam implementations the previews + unit/UI tests drive the surface
//  with. They carry no networking and no bundle access — the production app injects real
//  seams over the backend section registry + the `/settings/reset` mutation client; the
//  surface binds through the protocols in ResetSection.Model.swift either way.
//

import Foundation

// MARK: - Catalog source

/// In-memory resettable-section source for previews + tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryResetSectionsSource: ResetSectionsSource {
    public var onUpdate: (@MainActor (ResetSectionsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ResetSectionsUpdate?

    public init(initial: ResetSectionsUpdate? = ResetSectionsUpdate(status: .loaded)) {
        self.initial = initial
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

    /// Test/preview affordance: emit a fresh snapshot (web `query` refetch resolving).
    public func push(_ update: ResetSectionsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Reset mutation source (canned)

/// Deterministic reset source for previews + unit tests. Returns a canned receipt (or
/// throws a classified error) from both mutations, optionally after a delay so the
/// in-flight (busy) state can be observed. Records the call counts + the last section id
/// so the success path can be asserted.
@MainActor
public final class InMemorySettingsResetting: SettingsResetting {
    /// The canned result each mutation yields.
    public enum Outcome: Sendable {
        case success(SettingsResetReceipt)
        case failure(SettingsResetError)
    }

    public private(set) var resetSectionCount = 0
    public private(set) var resetAllCount = 0
    public private(set) var invalidateCount = 0
    public private(set) var lastSection: String?

    private let outcome: Outcome
    private let delay: Duration?

    public init(
        outcome: Outcome = .success(SettingsResetReceipt(reset: 3, sections: ["general"])),
        delay: Duration? = nil
    ) {
        self.outcome = outcome
        self.delay = delay
    }

    public func resetSection(_ section: String) async throws -> SettingsResetReceipt {
        resetSectionCount += 1
        lastSection = section
        return try await resolve()
    }

    public func resetAll() async throws -> SettingsResetReceipt {
        resetAllCount += 1
        return try await resolve()
    }

    public func invalidateCaches() {
        invalidateCount += 1
    }

    private func resolve() async throws -> SettingsResetReceipt {
        if let delay {
            try? await Task.sleep(for: delay)
        }
        switch outcome {
        case let .success(receipt):
            return receipt
        case let .failure(error):
            throw error
        }
    }
}

// MARK: - Reset mutation source (controllable)

/// Reset source whose completion is driven by the test, so the in-flight (busy) state can
/// be asserted deterministically between the mutation start and its resolution.
@MainActor
public final class ControllableSettingsResetting: SettingsResetting {
    public private(set) var resetSectionCount = 0
    public private(set) var resetAllCount = 0
    public private(set) var invalidateCount = 0
    public private(set) var lastSection: String?

    private var continuation: CheckedContinuation<SettingsResetReceipt, Error>?

    public init() {}

    public func resetSection(_ section: String) async throws -> SettingsResetReceipt {
        resetSectionCount += 1
        lastSection = section
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    public func resetAll() async throws -> SettingsResetReceipt {
        resetAllCount += 1
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    public func invalidateCaches() {
        invalidateCount += 1
    }

    /// Resolves the in-flight reset with a receipt.
    public func complete(_ receipt: SettingsResetReceipt = SettingsResetReceipt(reset: 1, sections: ["general"])) {
        continuation?.resume(returning: receipt)
        continuation = nil
    }

    /// Fails the in-flight reset with a classified error.
    public func fail(_ error: SettingsResetError) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
