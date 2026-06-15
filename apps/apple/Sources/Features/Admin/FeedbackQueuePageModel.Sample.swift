import Foundation

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling Audit
/// Log's `SampleAuditLogDataSource`). Production replaces it with the feedback API
/// adapter through the seam. Filtering + pagination + the inline update echo are
/// reproduced so previews exercise every control.
public struct SampleFeedbackQueueDataSource: FeedbackQueueDataSource {
    /// Whether the seed reports the GitHub Issues bridge as configured (web
    /// `github_bridge_enabled`) — `true` so the "Forward to GitHub" affordance shows.
    private let bridgeEnabled: Bool

    public init(bridgeEnabled: Bool = true) {
        self.bridgeEnabled = bridgeEnabled
    }

    public func loadFeedback(_ query: FeedbackQuery) async throws -> FeedbackListResult {
        let filtered = Self.seed.filter { entry in
            if let status = query.status, entry.status != status { return false }
            if let category = query.category, entry.category != category { return false }
            return true
        }
        let total = filtered.count
        let window = Array(filtered.dropFirst(query.offset).prefix(query.limit))
        return FeedbackListResult(
            items: window,
            total: total,
            limit: query.limit,
            offset: query.offset,
            githubBridgeEnabled: bridgeEnabled,
            githubRepo: bridgeEnabled ? "ev-dev-labs/teslasync" : nil
        )
    }

    public func updateFeedback(id: Int64, update: FeedbackUpdate) async throws -> FeedbackEntry {
        // The sample is stateless (web invalidates + refetches after a mutation); echo
        // the targeted row with the update applied so the call resolves successfully.
        let base = Self.seed.first { $0.id == id } ?? Self.seed[0]
        return FeedbackEntry(
            id: base.id,
            createdAt: base.createdAt,
            category: base.category,
            title: base.title,
            body: base.body,
            pageRoute: base.pageRoute,
            userAgent: base.userAgent,
            appVersion: base.appVersion,
            userEmail: base.userEmail,
            recentErrors: base.recentErrors,
            consoleTail: base.consoleTail,
            status: update.status ?? base.status,
            githubIssueURL: update.githubIssueURL ?? base.githubIssueURL,
            submitterSubject: base.submitterSubject,
            submitterIP: base.submitterIP
        )
    }

    static let seed: [FeedbackEntry] = [
        FeedbackEntry(
            id: 312,
            createdAt: "2026-06-13T18:04:22Z",
            category: .bug,
            title: "Charging graph y-axis clips above 250 kW",
            body: "On the Supercharger session detail the power curve is cut off at the top —"
                + " peak draw reads 0 kW even though the car pulled 250 kW. Repro on a V3 stall.",
            pageRoute: "/charging/8821",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15",
            appVersion: "2026.6.2+b1dd7ea4",
            userEmail: "casey.driver@example.com",
            recentErrors: "[{\"message\":\"Cannot read properties of undefined (reading 'max')\","
                + "\"source\":\"ChargingDetail.tsx\",\"line\":214}]",
            consoleTail: "[warn] recharts: width(0) and height(0) of chart should be greater than 0\n"
                + "[error] TypeError: undefined is not an object (evaluating 'curve.max')",
            status: .new,
            githubIssueURL: "",
            submitterSubject: "casey.driver@example.com",
            submitterIP: "10.0.4.51"
        ),
        FeedbackEntry(
            id: 309,
            createdAt: "2026-06-12T09:41:08Z",
            category: .feature,
            title: "Add a dark-mode toggle to the watch app",
            body: "The phone app follows the system appearance but the watch complication is"
                + " always light. Would love a manual override.",
            pageRoute: "/settings",
            userAgent: "TeslaSync-iOS/2026.6.1 (iPhone; iOS 18.0)",
            appVersion: "2026.6.1",
            userEmail: "",
            recentErrors: nil,
            consoleTail: nil,
            status: .triaged,
            githubIssueURL: "https://github.com/ev-dev-labs/teslasync/issues/1487",
            submitterSubject: "auth0|6628f0c19a",
            submitterIP: "10.0.4.18"
        ),
        FeedbackEntry(
            id: 304,
            createdAt: "2026-06-10T22:17:55Z",
            category: .other,
            title: "How do I export only one vehicle's drives?",
            body: "The GDPR export bundles the whole fleet. Is there a per-VIN option?",
            pageRoute: "/admin/gdpr-exports",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            appVersion: "2026.6.0",
            userEmail: "fleet.admin@example.com",
            recentErrors: nil,
            consoleTail: nil,
            status: .closed,
            githubIssueURL: "",
            submitterSubject: "fleet.admin@example.com",
            submitterIP: "10.0.4.7"
        )
    ]
}
