//
//  ConnectionSegment.Probes.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  The network probe seam the production polling source fetches through — the native peer of the web
//  `useApiHealth` hook's `probe()` (`fetch(`${getApiBase()}/healthz`)` with a 5s `AbortController`
//  timeout, `cache: 'no-store'`, `credentials: 'include'`). ``ConnectionHealthProbe`` returns a
//  ``ConnectionProbeResult`` (ok + measured latency + check time); the web swallows a network failure into
//  `ok: false`, so a probe ALWAYS yields a reading. Comes with a `@Sendable`-closure production adapter
//  (the host wires its `URLSession` over its API base) and a deterministic scripted actor double for tests,
//  so no networking lives in the surface.
//

import Foundation

// MARK: - Health probe seam (web `probe()` → `/healthz`)

/// The seam the polling source probes `/healthz` through — the native peer of the web `useApiHealth`
/// `probe()`. Kept off the view so no networking lives in the surface: the production app injects a
/// ``ClosureConnectionHealthProbe`` wrapping its `URLSession` + API base; tests inject a
/// ``ScriptedConnectionHealthProbe``. The probe never throws — a failure is reported as a result with
/// `ok == false` and the measured time-to-failure, exactly as the web `catch` returns `{ ok: false, … }`.
public protocol ConnectionHealthProbe: Sendable {
    func probe() async -> ConnectionProbeResult
}

/// Adapts a `@Sendable` async closure into a ``ConnectionHealthProbe`` — the production seam. The host
/// passes a closure that hits `${apiBase}/healthz` (with the web's no-store + credentials + 5s timeout
/// semantics), measures the round-trip, and maps the response / failure into a ``ConnectionProbeResult``,
/// so this surface ships without depending on the app's networking layer.
public struct ClosureConnectionHealthProbe: ConnectionHealthProbe {
    private let body: @Sendable () async -> ConnectionProbeResult

    public init(_ body: @escaping @Sendable () async -> ConnectionProbeResult) {
        self.body = body
    }

    public func probe() async -> ConnectionProbeResult {
        await body()
    }
}

/// A deterministic health probe for tests / previews — returns the queued readings in order, then repeats
/// the last one. An actor so the index advances safely across the concurrent probe calls the polling source
/// makes, with no real network and no real time.
public actor ScriptedConnectionHealthProbe: ConnectionHealthProbe {
    private let results: [ConnectionProbeResult]
    private var index = 0
    public private(set) var probeCount = 0

    public init(_ results: [ConnectionProbeResult]) {
        self.results = results
    }

    public func probe() async -> ConnectionProbeResult {
        probeCount += 1
        guard !results.isEmpty else {
            return ConnectionProbeResult(ok: false, latencyMs: 0, checkedAt: Date(timeIntervalSince1970: 0))
        }
        let result = index < results.count ? results[index] : results[results.count - 1]
        index += 1
        return result
    }
}
