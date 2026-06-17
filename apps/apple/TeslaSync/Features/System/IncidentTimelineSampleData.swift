import Foundation

/// A representative local seed used as the `IncidentTimelinePageModel` / preview default until the
/// KMP-backed source is injected at composition time (ADR-004). It is an API-response-shaped fixture
/// (a TimescaleDB connection-pool saturation incident with a four-entry timeline, started ~50 min
/// ago, still open) so the post-mortem body renders its populated success state out of the box.
///
/// It is an `actor` (not a value type like the sibling `SampleSharingTripsDataSource`) because this
/// surface has WRITE paths: `appendUpdate` and `resolveIncident` mutate the stored incident and
/// return the refreshed copy, exactly as the web mutations resolve to the updated `Incident` that
/// the model applies in place. The store is therefore reference state guarded by the actor.
public actor SampleIncidentTimelineDataSource: IncidentTimelineDataSource {
    private var storedByID: [Int64: IncidentTimelineDetail] = [:]
    private let base = Date(timeIntervalSince1970: 1_718_000_000)

    public init() {}

    public func loadIncident(id: Int64) async throws -> IncidentTimelineDetail {
        let incident = storedByID[id] ?? makeSeed(id: id)
        storedByID[id] = incident
        return incident
    }

    public func appendUpdate(
        id: Int64,
        message: String,
        status: IncidentStatus?
    ) async throws -> IncidentTimelineDetail {
        var incident = storedByID[id] ?? makeSeed(id: id)
        let newStatus = status ?? incident.status
        let entry = IncidentTimelineUpdate(
            id: "\(Date().timeIntervalSince1970)-\(incident.updates.count)",
            at: Date(),
            status: newStatus,
            message: message,
            author: "operator"
        )
        incident = rebuild(incident, status: newStatus, updates: incident.updates + [entry])
        storedByID[id] = incident
        return incident
    }

    public func resolveIncident(id: Int64) async throws -> IncidentTimelineDetail {
        var incident = storedByID[id] ?? makeSeed(id: id)
        // The server appends the canonical close-out line and flips the status (web doc comment:
        // "resolving … appends a 'Incident resolved.' line").
        let entry = IncidentTimelineUpdate(
            id: "\(Date().timeIntervalSince1970)-\(incident.updates.count)",
            at: Date(),
            status: .resolved,
            message: "Incident resolved.",
            author: "operator"
        )
        incident = rebuild(
            incident,
            status: .resolved,
            updates: incident.updates + [entry],
            resolvedAt: Date()
        )
        storedByID[id] = incident
        return incident
    }

    private func rebuild(
        _ incident: IncidentTimelineDetail,
        status: IncidentStatus,
        updates: [IncidentTimelineUpdate],
        resolvedAt: Date? = nil
    ) -> IncidentTimelineDetail {
        IncidentTimelineDetail(
            id: incident.id,
            title: incident.title,
            description: incident.description,
            severity: incident.severity,
            status: status,
            source: incident.source,
            affectedComponents: incident.affectedComponents,
            updates: updates,
            startedAt: incident.startedAt,
            resolvedAt: resolvedAt ?? incident.resolvedAt
        )
    }

    private func makeSeed(id: Int64) -> IncidentTimelineDetail {
        let started = base.addingTimeInterval(-3_000)
        let updates = [
            IncidentTimelineUpdate(
                id: "\(id)-0",
                at: started,
                status: .investigating,
                message: "MQTT ingest pod reported a rising fleet-telemetry backlog; on-call paged.",
                author: "alertmanager"
            ),
            IncidentTimelineUpdate(
                id: "\(id)-1",
                at: started.addingTimeInterval(420),
                status: .identified,
                message: "Correlated the backlog with TimescaleDB connection-pool saturation.",
                author: "operator"
            ),
            IncidentTimelineUpdate(
                id: "\(id)-2",
                at: started.addingTimeInterval(1_440),
                status: .monitoring,
                message: "Raised the pool size; the backlog is draining and writes are catching up.",
                author: "operator"
            )
        ]
        return IncidentTimelineDetail(
            id: id,
            title: "Fleet-telemetry ingest backlog",
            description: "Rising MQTT ingest backlog after a TimescaleDB connection-pool saturation. "
                + "Telemetry was buffered by the broker; no vehicle data was lost.",
            severity: .major,
            status: .monitoring,
            source: "auto",
            affectedComponents: ["fleet-telemetry", "signal_log", "api"],
            updates: updates,
            startedAt: started,
            resolvedAt: nil
        )
    }
}

#if DEBUG
    /// Preview/test seam whose load fails — drives the web error / not-found panel (GlassPanel4),
    /// the `error || !incident` branch the page renders as the retryable "not found" state.
    public struct FailingIncidentTimelineDataSource: IncidentTimelineDataSource {
        public struct NotFound: Error {}
        public init() {}

        public func loadIncident(id _: Int64) async throws -> IncidentTimelineDetail {
            throw NotFound()
        }

        public func appendUpdate(
            id _: Int64,
            message _: String,
            status _: IncidentStatus?
        ) async throws -> IncidentTimelineDetail {
            throw NotFound()
        }

        public func resolveIncident(id _: Int64) async throws -> IncidentTimelineDetail {
            throw NotFound()
        }
    }
#endif
