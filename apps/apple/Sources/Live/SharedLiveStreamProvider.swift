import Foundation
import Shared

/// Production `LiveStreamProvider` backed by the KMP shared core's `SseClient`
/// (`io.teslasync.shared.core.net.sse.SseClient`). Bridges the Kotlin
/// `LiveSubscription` (an `events: Flow<LiveEvent>` + a `connection:
/// StateFlow<Connection>`) into one Swift `AsyncStream<LiveStreamElement>` and
/// decodes each `Shared.LiveEvent` into the Shared-free `LiveFleetEvent`.
///
/// Auth: the current access token is validated (refreshing if expiring, P5)
/// before each connection; a failure surfaces as `.failed(.auth)` so the store
/// runs its single 401-refresh + retry. The token itself is injected into the
/// transport by the KMP `ApiHttpClient` (ADR-008/009).
///
/// > KMP interop note: Kotlin/Native strips the framework's `Shared` base name
/// > from most exported types' Swift names, so the shared-core types are
/// > referenced module-qualified (`Shared.LiveEvent`, `Shared.SseClient`,
/// > `Shared.SignalEnvelope`). A few names whose stripped form would collide
/// > keep the prefix (`Shared.Connection`); the compiler is the source of truth.
public enum SharedLiveStreamProvider {
    /// Shorthand for the verbose Kotlin/Native Swift name of a JSON element;
    /// `LiveEvent` field maps bridge their values as this type.
    private typealias JsonElement = Shared.Kotlinx_serialization_jsonJsonElement

    /// Builds the production provider over a shared `SseClient` and the P5 token
    /// provider. `clock` stamps each event's local arrival time.
    public static func live(
        client: Shared.SseClient,
        tokenProvider: any AuthTokenProviding,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) -> LiveStreamProvider<LiveFleetEvent> {
        // Kotlin/Native handles aren't `Sendable`; box them so they can cross the
        // provider's `@Sendable` task boundaries. Sound because each handle is
        // confined to the single task (or one child task) that owns it.
        let client = SendableHandle(client)
        return LiveStreamProvider { target, _ in
            AsyncStream { continuation in
                let task = Task {
                    // Validate (refresh-if-expiring) before opening; an auth
                    // failure here drives the store's 401 refresh/retry path.
                    do {
                        _ = try await tokenProvider.validAccessToken()
                    } catch {
                        continuation.yield(.failed(.from(error)))
                        continuation.finish()
                        return
                    }

                    let subscription = client.value.subscribe(path: target.path)
                    let connectionFlow = SendableHandle(subscription.connection)
                    let eventsFlow = SendableHandle(subscription.events)
                    await withTaskGroup(of: Void.self) { group in
                        group.addTask {
                            do {
                                for try await raw in FlowBridge.stream(from: connectionFlow.value) {
                                    guard let connection = raw as? Shared.Connection,
                                          let state = LiveConnectionState(connection)
                                    else { continue }
                                    continuation.yield(.connection(state))
                                }
                            } catch {
                                // Connection-state stream ended; the events task surfaces failures.
                            }
                        }
                        group.addTask {
                            do {
                                for try await raw in FlowBridge.stream(from: eventsFlow.value) {
                                    guard let shared = raw as? Shared.LiveEvent else { continue }
                                    continuation.yield(.event(Self.envelope(from: shared, now: clock())))
                                }
                            } catch {
                                continuation.yield(.failed(.from(error)))
                            }
                        }
                        await group.waitForAll()
                    }
                    continuation.finish()
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        }
    }

    // MARK: - Mapping

    private static func envelope(from shared: Shared.LiveEvent, now: Date) -> LiveEnvelope<LiveFleetEvent> {
        let projected = LiveEvent(shared)
        return LiveEnvelope(
            id: projected.id,
            kind: projected.kind,
            receivedAt: now,
            payload: fleetEvent(from: shared, kind: projected.kind)
        )
    }

    private static func fleetEvent(from shared: Shared.LiveEvent, kind: LiveEventKind) -> LiveFleetEvent {
        switch shared {
        case let event as Shared.LiveEventConnected:
            return .connected(clientID: event.clientId)
        case let event as Shared.LiveEventHeartbeat:
            return .heartbeat(time: event.time.flatMap(parseTimestamp))
        case let event as Shared.LiveEventVehicleUpdate:
            let signals = scalarMap(from: event.data)
            return .vehicleUpdate(vehicleID: vehicleID(in: signals), signals: signals)
        case let event as Shared.LiveEventAlert:
            let fields = scalarMap(from: event.data)
            return .alert(LiveAlert(
                id: fields["id"]?.displayValue,
                severity: fields["severity"]?.displayValue,
                message: fields["message"]?.displayValue,
                vehicleID: vehicleID(in: fields)
            ))
        case let event as Shared.LiveEventExportStatus:
            let fields = scalarMap(from: event.data)
            return .exportStatus(
                jobID: fields["job_id"]?.displayValue ?? fields["id"]?.displayValue,
                progress: fields["progress"]?.doubleValue,
                status: fields["status"]?.displayValue
            )
        case let event as Shared.LiveEventAchievementUnlocked:
            let fields = scalarMap(from: event.data)
            return .achievementUnlocked(id: fields["id"]?.displayValue, title: fields["title"]?.displayValue)
        case let event as Shared.LiveEventSignal:
            return .signal(signalSample(from: event.envelope))
        default:
            return .unknown(event: String(describing: kind))
        }
    }

    private static func signalSample(from envelope: Shared.SignalEnvelope) -> LiveSignalSample {
        LiveSignalSample(
            vehicleID: envelope.vehicleId,
            field: envelope.field,
            value: scalar(from: envelope.value),
            timestamp: parseTimestamp(envelope.ts)
        )
    }

    private static func scalar(from value: Shared.SignalValue) -> LiveScalar {
        switch value {
        case let number as Shared.SignalValueNumberValue:
            .number(number.value)
        case let string as Shared.SignalValueStringValue:
            .string(string.value)
        case let boolean as Shared.SignalValueBoolValue:
            .bool(boolean.value)
        case let time as Shared.SignalValueTimeValue:
            .string(time.value)
        default:
            .null
        }
    }

    /// Decodes a shared `LiveEvent` payload (`Map<String, JsonElement>`, bridged
    /// as `[String: JsonElement]`) into a Swift scalar map. Each element's
    /// description is its canonical JSON token, so it decodes uniformly via
    /// `JSONSerialization`. Nested objects/arrays are skipped at this layer;
    /// page consumers that need them decode their own typed shapes.
    private static func scalarMap(from data: [String: JsonElement]) -> [String: LiveScalar] {
        var result: [String: LiveScalar] = [:]
        for (key, element) in data {
            let token = String(describing: element)
            let bytes = Data("[\(token)]".utf8)
            guard let decoded = try? JSONSerialization.jsonObject(with: bytes) as? [Any],
                  let value = decoded.first
            else { continue }
            switch value {
            case let number as NSNumber:
                result[key] = numberScalar(number)
            case let string as String:
                result[key] = .string(string)
            case is NSNull:
                result[key] = .null
            default:
                continue
            }
        }
        return result
    }

    private static func numberScalar(_ number: NSNumber) -> LiveScalar {
        // NSJSONSerialization encodes JSON booleans as the tagged boolean NSNumber.
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return .bool(number.boolValue)
        }
        return .number(number.doubleValue)
    }

    private static func vehicleID(in fields: [String: LiveScalar]) -> Int64? {
        guard let scalar = fields["vehicle_id"], let value = scalar.doubleValue else { return nil }
        return Int64(value)
    }

    private static func parseTimestamp(_ raw: String) -> Date? {
        ISO8601DateFormatter().date(from: raw)
    }
}

/// Wraps a non-`Sendable` Kotlin/Native handle so it can be captured across the
/// `@Sendable` task boundaries of the live stream. Sound because every wrapped
/// handle is confined to a single task (or one child task) and carries no
/// mutable Swift state of its own.
private struct SendableHandle<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) {
        self.value = value
    }
}
