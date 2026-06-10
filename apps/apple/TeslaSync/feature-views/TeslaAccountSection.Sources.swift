//
//  TeslaAccountSection.Sources.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  The P1/S8 seam implementations the previews + unit/UI tests drive the surface with, plus the
//  production URL opener. The in-memory seams carry no networking and no bundle access — the
//  production app injects real seams over the auth-status holder + the `/auth/*` mutation client; the
//  surface binds through the protocols in TeslaAccountSection.Model.swift either way.
//

import Foundation
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Status source

/// In-memory auth-status source for previews + tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTeslaAccountStatusSource: TeslaAccountStatusSource {
    public var onUpdate: (@MainActor (TeslaAccountStatusInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TeslaAccountStatusInput?

    public init(initial: TeslaAccountStatusInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance — web query refetch resolving).
    public func push(_ input: TeslaAccountStatusInput) {
        onUpdate?(input)
    }
}

// MARK: - Actions (canned)

/// Deterministic mutation source for previews + unit tests. Each of the four mutations resolves to a
/// caller-configured result (defaulting to success), optionally after a delay so the in-flight (busy)
/// state can be observed. Records the per-mutation call counts + the cache-invalidation count so the
/// success/failure paths can be asserted.
@MainActor
public final class InMemoryTeslaAccountActions: TeslaAccountActions {
    public var authURLResult: Result<URL, TeslaAccountError>
    public var refreshResult: Result<Void, TeslaAccountError>
    public var syncResult: Result<Int, TeslaAccountError>
    public var disconnectResult: Result<Void, TeslaAccountError>

    public private(set) var authURLCount = 0
    public private(set) var refreshCount = 0
    public private(set) var syncCount = 0
    public private(set) var disconnectCount = 0
    public private(set) var invalidateCount = 0

    private let delay: Duration?

    public init(
        authURLResult: Result<URL, TeslaAccountError> = .success(TeslaAccountDefaults.authURL),
        refreshResult: Result<Void, TeslaAccountError> = .success(()),
        syncResult: Result<Int, TeslaAccountError> = .success(2),
        disconnectResult: Result<Void, TeslaAccountError> = .success(()),
        delay: Duration? = nil
    ) {
        self.authURLResult = authURLResult
        self.refreshResult = refreshResult
        self.syncResult = syncResult
        self.disconnectResult = disconnectResult
        self.delay = delay
    }

    public func authURL() async throws -> URL {
        authURLCount += 1
        try await sleepIfNeeded()
        return try authURLResult.get()
    }

    public func refreshToken() async throws {
        refreshCount += 1
        try await sleepIfNeeded()
        try refreshResult.get()
    }

    public func syncVehicles() async throws -> Int {
        syncCount += 1
        try await sleepIfNeeded()
        return try syncResult.get()
    }

    public func disconnect() async throws {
        disconnectCount += 1
        try await sleepIfNeeded()
        try disconnectResult.get()
    }

    public func invalidateCaches() {
        invalidateCount += 1
    }

    private func sleepIfNeeded() async throws {
        if let delay {
            try? await Task.sleep(for: delay)
        }
    }
}

// MARK: - Actions (controllable)

/// Mutation source whose completion is driven by the test, so the in-flight (busy) state can be
/// asserted deterministically between a mutation start and its resolution. Each mutation parks on its
/// own continuation until the test resolves it.
@MainActor
public final class ControllableTeslaAccountActions: TeslaAccountActions {
    public private(set) var authURLCount = 0
    public private(set) var refreshCount = 0
    public private(set) var syncCount = 0
    public private(set) var disconnectCount = 0
    public private(set) var invalidateCount = 0

    private var authURLContinuation: CheckedContinuation<URL, Error>?
    private var refreshContinuation: CheckedContinuation<Void, Error>?
    private var syncContinuation: CheckedContinuation<Int, Error>?
    private var disconnectContinuation: CheckedContinuation<Void, Error>?

    public init() {}

    public func authURL() async throws -> URL {
        authURLCount += 1
        return try await withCheckedThrowingContinuation { authURLContinuation = $0 }
    }

    public func refreshToken() async throws {
        refreshCount += 1
        return try await withCheckedThrowingContinuation { refreshContinuation = $0 }
    }

    public func syncVehicles() async throws -> Int {
        syncCount += 1
        return try await withCheckedThrowingContinuation { syncContinuation = $0 }
    }

    public func disconnect() async throws {
        disconnectCount += 1
        return try await withCheckedThrowingContinuation { disconnectContinuation = $0 }
    }

    public func invalidateCaches() {
        invalidateCount += 1
    }

    /// Resolves the in-flight Connect URL request.
    public func completeAuthURL(_ url: URL = TeslaAccountDefaults.authURL) {
        authURLContinuation?.resume(returning: url)
        authURLContinuation = nil
    }

    /// Resolves the in-flight token refresh.
    public func completeRefresh() {
        refreshContinuation?.resume(returning: ())
        refreshContinuation = nil
    }

    /// Resolves the in-flight vehicle sync with a synced count.
    public func completeSync(_ count: Int) {
        syncContinuation?.resume(returning: count)
        syncContinuation = nil
    }

    /// Resolves the in-flight disconnect.
    public func completeDisconnect() {
        disconnectContinuation?.resume(returning: ())
        disconnectContinuation = nil
    }

    /// Fails the in-flight token refresh with a classified error.
    public func failRefresh(_ error: TeslaAccountError) {
        refreshContinuation?.resume(throwing: error)
        refreshContinuation = nil
    }

    /// Fails the in-flight vehicle sync with a classified error.
    public func failSync(_ error: TeslaAccountError) {
        syncContinuation?.resume(throwing: error)
        syncContinuation = nil
    }

    /// Fails the in-flight disconnect with a classified error.
    public func failDisconnect(_ error: TeslaAccountError) {
        disconnectContinuation?.resume(throwing: error)
        disconnectContinuation = nil
    }
}

// MARK: - URL opener (production)

/// Production URL opener (web `window.location.href = data.auth_url`): hands the Tesla OAuth URL to
/// the platform opener — `UIApplication` on iOS / iPadOS, `NSWorkspace` on macOS.
@MainActor
public final class SystemTeslaAccountURLOpener: TeslaAccountURLOpening {
    public init() {}

    public func open(_ url: URL) {
        #if canImport(UIKit)
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        #elseif canImport(AppKit)
            NSWorkspace.shared.open(url)
        #endif
    }
}

// MARK: - Defaults

/// Shared default values for the in-memory seams — kept here so previews + tests reference one canonical
/// Tesla OAuth authorize URL.
public enum TeslaAccountDefaults {
    public static let authURL = URL(string: "https://auth.tesla.com/oauth2/v3/authorize")
        ?? URL(fileURLWithPath: "/")
}
