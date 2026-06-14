//
//  VersionSegment.Probes.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The two network probe seams the production polling source fetches through — the native peers of the
//  web component's two `useQuery` calls. ``VersionInfoProbe`` is the `/system/version` hit (web
//  `request<VersionSegmentInfo>('/system/version')`); ``UpdateCheckProbe`` is the `/system/update-check` hit
//  (web `request<UpdateCheckResult>('/system/update-check')`). Each comes with a `@Sendable`-closure
//  production adapter (the host wires its API client) and a deterministic scripted actor double for
//  tests, so no networking lives in the surface. The outcome enums carry an `offline` flag so the
//  polling source can move the freshness axis to `offline` vs `stale` on a failure.
//

import Foundation

// MARK: - Version-info probe (web `/system/version`)

/// The outcome of one `/system/version` probe — the native peer of the web `request<VersionSegmentInfo>` result.
/// `info` carries the parsed ``VersionSegmentInfo`` (web success); `failed` carries a reason plus whether the
/// cause was a lost connection.
public enum VersionInfoProbeOutcome: Sendable, Equatable {
    case info(VersionSegmentInfo)
    case failed(message: String, offline: Bool)
}

/// The seam the polling source probes the running version through — the native peer of the web
/// `request<VersionSegmentInfo>('/system/version')` call. Kept off the view so no networking lives in the
/// surface: the production app injects a ``ClosureVersionInfoProbe`` wrapping its API client; tests
/// inject a ``ScriptedVersionInfoProbe``.
public protocol VersionInfoProbe: Sendable {
    func probe() async -> VersionInfoProbeOutcome
}

/// Adapts a `@Sendable` async closure into a ``VersionInfoProbe`` — the production seam. The host passes
/// a closure that calls its `/system/version` client and maps the response (or the failure) into a
/// ``VersionInfoProbeOutcome``, so this surface ships without depending on the app's networking layer.
public struct ClosureVersionInfoProbe: VersionInfoProbe {
    private let body: @Sendable () async -> VersionInfoProbeOutcome

    public init(_ body: @escaping @Sendable () async -> VersionInfoProbeOutcome) {
        self.body = body
    }

    public func probe() async -> VersionInfoProbeOutcome {
        await body()
    }
}

/// A deterministic version probe for tests/previews — returns the queued outcomes in order, then repeats
/// the last one. An actor so the index advances safely across the concurrent probe calls the polling
/// source makes, with no real network and no real time.
public actor ScriptedVersionInfoProbe: VersionInfoProbe {
    private let outcomes: [VersionInfoProbeOutcome]
    private var index = 0
    public private(set) var probeCount = 0

    public init(_ outcomes: [VersionInfoProbeOutcome]) {
        self.outcomes = outcomes
    }

    public func probe() async -> VersionInfoProbeOutcome {
        probeCount += 1
        guard !outcomes.isEmpty else {
            return .failed(message: "no scripted outcome", offline: false)
        }
        let outcome = index < outcomes.count ? outcomes[index] : outcomes[outcomes.count - 1]
        index += 1
        return outcome
    }
}

// MARK: - Update-check probe (web `/system/update-check`)

/// The outcome of one `/system/update-check` probe — the native peer of the web
/// `request<UpdateCheckResult>` result. `result` carries the parsed ``UpdateCheckResult`` (web success);
/// `failed` carries a reason plus the connection cause. Unlike the version probe, an update-check failure
/// is non-fatal to the segment (the web still renders the version), so the source keeps the last result.
public enum UpdateCheckProbeOutcome: Sendable, Equatable {
    case result(UpdateCheckResult)
    case failed(message: String, offline: Bool)
}

/// The seam the polling source probes the update check through — the native peer of the web
/// `request<UpdateCheckResult>('/system/update-check')` call. Production injects a
/// ``ClosureUpdateCheckProbe`` over its API client; tests inject a ``ScriptedUpdateCheckProbe``.
public protocol UpdateCheckProbe: Sendable {
    func probe() async -> UpdateCheckProbeOutcome
}

/// Adapts a `@Sendable` async closure into an ``UpdateCheckProbe`` — the production seam. The host passes
/// a closure that calls its `/system/update-check` client and maps the response (or failure) into an
/// ``UpdateCheckProbeOutcome``.
public struct ClosureUpdateCheckProbe: UpdateCheckProbe {
    private let body: @Sendable () async -> UpdateCheckProbeOutcome

    public init(_ body: @escaping @Sendable () async -> UpdateCheckProbeOutcome) {
        self.body = body
    }

    public func probe() async -> UpdateCheckProbeOutcome {
        await body()
    }
}

/// A deterministic update-check probe for tests/previews — returns the queued outcomes in order, then
/// repeats the last. An actor so the index advances safely across concurrent probe calls.
public actor ScriptedUpdateCheckProbe: UpdateCheckProbe {
    private let outcomes: [UpdateCheckProbeOutcome]
    private var index = 0
    public private(set) var probeCount = 0

    public init(_ outcomes: [UpdateCheckProbeOutcome]) {
        self.outcomes = outcomes
    }

    public func probe() async -> UpdateCheckProbeOutcome {
        probeCount += 1
        guard !outcomes.isEmpty else {
            return .failed(message: "no scripted outcome", offline: false)
        }
        let outcome = index < outcomes.count ? outcomes[index] : outcomes[outcomes.count - 1]
        index += 1
        return outcome
    }
}
