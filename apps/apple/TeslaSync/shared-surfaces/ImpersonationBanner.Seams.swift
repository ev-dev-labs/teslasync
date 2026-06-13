//
//  ImpersonationBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  The dependency seams the ImpersonationBanner view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S8 source protocol, the gateway protocol (the native parity of
//  the web `useImpersonationStatus` query + the `useEndImpersonation` mutation), the closure-backed
//  gateway the production `.live(gateway:)` wires the embedder's real transport through, the
//  production polling source, and the in-memory source for previews / tests.
//
//  Parity note: the web banner owns its data through a 30s-polled query plus an idempotent end
//  mutation. This surface keeps the transport out of the view (P1/S8): the production
//  `DefaultImpersonationBannerSource` polls the injected `ImpersonationBannerGateway`, preserves the
//  last known status across refetches (so a background poll never flashes the skeleton over a live
//  banner), surfaces a transport failure as the cached value behind an `offline` chip, marks the feed
//  `stale` when a poll is overdue, and runs the end mutation — optimistically clearing to inactive,
//  exactly as the web mutation primes the cache to `{ mode: 'inactive' }` before the refetch settles.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app uses `DefaultImpersonationBannerSource` over
/// the injected gateway; previews and tests use `InMemoryImpersonationBannerSource`. The view never
/// polls status or fires the mutation directly.
@MainActor
public protocol ImpersonationBannerSource: AnyObject {
    var onUpdate: (@MainActor (ImpersonationBannerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Runs the end mutation and re-emits the resulting status (web `endMut.mutate()`).
    func endImpersonation()
}

// MARK: - Gateway seam (web `useImpersonationStatus` + `useEndImpersonation`)

/// A gateway failure, split so the source can route a transport drop to the `offline` chip (keeping
/// the cached status visible) while a server / validation error surfaces as the retryable error tile.
public enum ImpersonationBannerGatewayError: Error, Sendable, Equatable {
    case offline(message: String)
    case failure(message: String)
}

/// The transport seam the source drives — the native parity of the web impersonation hooks. The
/// production app injects a gateway backed by the shared-core API client (the `/admin/impersonate`
/// status read normalised to `unavailable` on the open-mode 501, and the idempotent
/// `/admin/impersonate/end` mutation); tests inject a recording double. Non-isolated + `Sendable` so a
/// real implementation can do its work off the main actor.
public protocol ImpersonationBannerGateway: Sendable {
    /// Loads the current status (web `useImpersonationStatus` queryFn). Throws
    /// `ImpersonationBannerGatewayError` to distinguish a transport drop from a server error.
    func loadStatus() async throws -> ImpersonationBannerStatus
    /// Ends the active impersonation session (web `useEndImpersonation` mutationFn). Idempotent.
    func endImpersonation() async throws
}

/// A gateway built from two closures — the seam the embedder hands its real transport through at
/// `.live(gateway:)`, the native parity of the web host wiring `request()` into the hooks. No default
/// transport lives here: the surface owns the orchestration, the embedder owns the I/O.
public struct ClosureImpersonationBannerGateway: ImpersonationBannerGateway {
    private let loadStatusAction: @Sendable () async throws -> ImpersonationBannerStatus
    private let endAction: @Sendable () async throws -> Void

    public init(
        loadStatus: @escaping @Sendable () async throws -> ImpersonationBannerStatus,
        endImpersonation: @escaping @Sendable () async throws -> Void
    ) {
        loadStatusAction = loadStatus
        endAction = endImpersonation
    }

    public func loadStatus() async throws -> ImpersonationBannerStatus {
        try await loadStatusAction()
    }

    public func endImpersonation() async throws {
        try await endAction()
    }
}

// MARK: - Default source (production — polled gateway + end mutation)

/// The production source. Polls the `ImpersonationBannerGateway` (web `refetchInterval: 30_000`),
/// preserves the last known status across refetches, classifies a transport drop as `offline` and a
/// server error as the error phase, marks the feed `stale` when a poll is overdue, and runs the end
/// mutation — optimistically clearing to inactive then confirming with a reload. No view logic lives
/// here.
@MainActor
public final class DefaultImpersonationBannerSource: ImpersonationBannerSource {
    public var onUpdate: (@MainActor (ImpersonationBannerInput) -> Void)?

    private let gateway: any ImpersonationBannerGateway
    private let pollInterval: TimeInterval
    private let staleAfter: TimeInterval
    private let now: @Sendable () -> Date

    private var lastStatus: ImpersonationBannerStatus = .inactive
    private var hasLoadedOnce = false
    private var lastLoadedAt: Date?
    private var isEnding = false
    private var loadTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?

    public init(
        gateway: any ImpersonationBannerGateway,
        pollInterval: TimeInterval = 30,
        staleAfter: TimeInterval = 60,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.gateway = gateway
        self.pollInterval = pollInterval
        self.staleAfter = staleAfter
        self.now = now
    }

    public func start() {
        emit(isLoading: !hasLoadedOnce, connection: .live)
        beginLoad()
        beginPolling()
    }

    public func stop() {
        loadTask?.cancel()
        loadTask = nil
        pollTask?.cancel()
        pollTask = nil
    }

    public func refresh() {
        beginLoad()
    }

    public func endImpersonation() {
        guard !isEnding else { return }
        isEnding = true
        emit(isLoading: false, connection: .live)
        Task { @MainActor [weak self] in
            guard let self else { return }
            try? await gateway.endImpersonation()
            lastStatus = .inactive
            lastLoadedAt = now()
            isEnding = false
            emit(isLoading: false, connection: .live)
            beginLoad()
        }
    }

    private func beginLoad() {
        loadTask?.cancel()
        loadTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let status = try await gateway.loadStatus()
                hasLoadedOnce = true
                lastStatus = status
                lastLoadedAt = now()
                emit(isLoading: false, connection: .live)
            } catch is CancellationError {
                return
            } catch let error as ImpersonationBannerGatewayError {
                self.handle(error)
            } catch {
                handle(.offline(message: error.localizedDescription))
            }
        }
    }

    private func handle(_ error: ImpersonationBannerGatewayError) {
        hasLoadedOnce = true
        switch error {
        case .offline:
            emit(isLoading: false, connection: .offline)
        case let .failure(message):
            emit(isLoading: false, errorMessage: message, connection: .live)
        }
    }

    private func beginPolling() {
        pollTask?.cancel()
        let nanos = UInt64(max(0, pollInterval) * 1_000_000_000)
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: nanos)
                guard let self, !Task.isCancelled else { break }
                if isStale() {
                    emit(isLoading: false, connection: .stale)
                } else {
                    beginLoad()
                }
            }
        }
    }

    private func isStale() -> Bool {
        guard let lastLoadedAt else { return false }
        return now().timeIntervalSince(lastLoadedAt) > staleAfter
    }

    private func emit(
        isLoading: Bool,
        errorMessage: String? = nil,
        connection: ImpersonationBannerConnection
    ) {
        onUpdate?(ImpersonationBannerInput(
            status: lastStatus,
            isLoading: isLoading,
            errorMessage: errorMessage,
            isEnding: isEnding,
            connection: connection
        ))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, counting the lifecycle calls so the model
/// contract can be asserted without a gateway or real polling.
@MainActor
public final class InMemoryImpersonationBannerSource: ImpersonationBannerSource {
    public var onUpdate: (@MainActor (ImpersonationBannerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var endCount = 0

    private let initial: ImpersonationBannerInput?

    public init(initial: ImpersonationBannerInput? = nil) {
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

    public func endImpersonation() {
        endCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: ImpersonationBannerInput) {
        onUpdate?(input)
    }
}

// MARK: - Production factory

public extension ImpersonationBannerModel {
    /// The production model — wires the polling source over the embedder's real impersonation
    /// gateway. The app mounts `ImpersonationBanner(model: .live(gateway:))` at the very top of its
    /// chrome (web `<Layout>` mounts the banner above every other operational banner so the
    /// impersonation context dominates).
    ///
    /// - Parameter gateway: the embedder's transport for the status read + end mutation, the native
    ///   parity of the web hooks wiring `request()` — supplied by the app's API layer.
    static func live(
        gateway: any ImpersonationBannerGateway,
        telemetry: any ImpersonationBannerTelemetry = OSLogImpersonationBannerTelemetry()
    ) -> ImpersonationBannerModel {
        ImpersonationBannerModel(
            source: DefaultImpersonationBannerSource(gateway: gateway),
            telemetry: telemetry
        )
    }
}
