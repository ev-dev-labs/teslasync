import Foundation
import Shared

/// Production `LiveStreamProvider` backed by the KMP shared core's `SseClient`
/// (`io.teslasync.shared.core.net.sse.SseClient`). Bridges the Kotlin
/// `LiveSubscription` (an `events: Flow<LiveEvent>` + a `connection:
/// StateFlow<Connection>`) into one Swift `AsyncStream<LiveStreamElement>` and
/// decodes each `SharedLiveEvent` into the Shared-free `LiveFleetEvent`.
///
/// Auth: the current access token is validated (refreshing if expiring, P5)
/// before each connection; a failure surfaces as `.failed(.auth)` so the store
/// runs its single 401-refresh + retry. The token itself is injected into the
/// transport by the KMP `ApiHttpClient` (ADR-008/009).
///
/// > KMP interop note: Kotlin/Native exports framework types with the
/// > framework-name prefix (`Connection` → `SharedConnection`, the `LiveEvent`
/// > subtypes → `SharedLiveEvent…`). These symbol names follow the established
/// > facade convention and are pinned on the macOS Xcode build, exactly like
/// > `SharedFacade/LiveConnection.swift`, `FlowBridge.swift`, and `AppContainer`.
public enum SharedLiveStreamProvider {
    /// Builds the production provider over a shared `SseClient` and the P5 token
    /// provider. `clock` stamps each event's local arrival time.
    public static func live(
        client: SharedSseClient,
        tokenProvider: any AuthTokenProviding,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) -> LiveStreamProvider<LiveFleetEvent> {
        LiveStreamProvider { target, _ in
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

                    let subscription = client.subscribe(path: target.path)
                    await withTaskGroup(of: Void.self) { group in
                        group.addTask {
                            for await raw in FlowBridge.stream(from: subscription.connection) {
                                guard let connection = raw as? SharedConnection,
                                      let state = LiveConnectionState(connection)
                                else { continue }
                                continuation.yield(.connection(state))
                            }
                        }
                        group.addTask {
                            do {
                                for try await raw in FlowBridge.stream(from: subscription.events) {
                                    guard let shared = raw as? SharedLiveEvent else { continue }
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

    private static func envelope(from shared: SharedLiveEvent, now: Date) -> LiveEnvelope<LiveFleetEvent> {
        let projected = LiveEvent(shared)
        return LiveEnvelope(
            id: projected.id,
            kind: projected.kind,
            receivedAt: now,
            payload: fleetEvent(from: shared, kind: projected.kind)
        )
    }

    private static func fleetEvent(from shared: SharedLiveEvent, kind: LiveEventKind) -> LiveFleetEvent {
        switch shared {
        case let event as SharedLiveEventConnected:
            return .connected(clientID: event.clientId)
        case let event as SharedLiveEventHeartbeat:
            return .heartbeat(time: event.time.flatMap(parseTimestamp))
        case let event as SharedLiveEventVehicleUpdate:
            let signals = scalarMap(from: event.data)
            return .vehicleUpdate(vehicleID: vehicleID(in: signals), signals: signals)
        case let event as SharedLiveEventAlert:
            let fields = scalarMap(from: event.data)
            return .alert(LiveAlert(
                id: fields["id"]?.displayValue,
                severity: fields["severity"]?.displayValue,
                message: fields["message"]?.displayValue,
                vehicleID: vehicleID(in: fields)
            ))
        case let event as SharedLiveEventExportStatus:
            let fields = scalarMap(from: event.data)
            return .exportStatus(
                jobID: fields["job_id"]?.displayValue ?? fields["id"]?.displayValue,
                progress: fields["progress"]?.doubleValue,
                status: fields["status"]?.displayValue
            )
        case let event as SharedLiveEventAchievementUnlocked:
            let fields = scalarMap(from: event.data)
            return .achievementUnlocked(id: fields["id"]?.displayValue, title: fields["title"]?.displayValue)
        case let event as SharedLiveEventSignal:
            return .signal(signalSample(from: event.envelope))
        default:
            return .unknown(event: String(describing: kind))
        }
    }

    private static func signalSample(from envelope: SharedSignalEnvelope) -> LiveSignalSample {
        LiveSignalSample(
            vehicleID: Int64(truncating: envelope.vehicleId),
            field: envelope.field,
            value: scalar(from: envelope.value),
            timestamp: parseTimestamp(envelope.ts)
        )
    }

    private static func scalar(from value: SharedSignalValue) -> LiveScalar {
        switch value {
        case let number as SharedSignalValueNumberValue:
            .number(number.value)
        case let string as SharedSignalValueStringValue:
            .string(string.value)
        case let boolean as SharedSignalValueBoolValue:
            .bool(boolean.value)
        case let time as SharedSignalValueTimeValue:
            .string(time.value)
        default:
            .null
        }
    }

    /// Decodes a Kotlin `JsonObject` into a Swift scalar map via its canonical
    /// JSON description (interop-safe — avoids per-element Kotlin collection
    /// bridging). Nested objects/arrays are skipped at this layer; page consumers
    /// that need them decode their own typed shapes.
    private static func scalarMap(from json: SharedKotlinx_serialization_jsonJsonObject) -> [String: LiveScalar] {
        let text = String(describing: json)
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        var result: [String: LiveScalar] = [:]
        for (key, value) in object {
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
