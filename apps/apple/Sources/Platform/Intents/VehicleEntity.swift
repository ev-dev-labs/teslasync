import AppIntents
import Foundation

/// A non-personal vehicle reference, mirrored from the app for use as an App
/// Intent parameter ("Open <vehicle>", "Lock <vehicle>").
///
/// Carries only the app's **opaque** identifier and the user-facing display name —
/// never a VIN, location, or token (ADR-005). The list is mirrored to the App
/// Group by the app so the out-of-process Shortcuts/Siri resolver can offer the
/// user's vehicles without any networking.
public struct VehicleDirectoryEntry: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// App Group-backed mirror of the user's vehicles (display names + opaque ids),
/// written by the app and read by the intent resolver. Reads never throw; a
/// missing mirror yields an empty list so the intent falls back to "the
/// currently-selected vehicle".
///
/// `UserDefaults` is thread-safe but not `Sendable`; the `@unchecked` is sound as
/// this struct adds no mutable Swift state.
public struct VehicleDirectoryStore: @unchecked Sendable {
    private let defaults: UserDefaults
    private let key = "io.teslasync.intent.vehicleDirectory"

    public init(appGroupIdentifier: String = WidgetAppGroup.identifier) {
        defaults = UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    public func load() -> [VehicleDirectoryEntry] {
        guard let data = defaults.data(forKey: key),
              let entries = try? JSONDecoder().decode([VehicleDirectoryEntry].self, from: data)
        else { return [] }
        return entries
    }

    public func save(_ entries: [VehicleDirectoryEntry]) {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        defaults.set(data, forKey: key)
    }

    public func clear() {
        defaults.removeObject(forKey: key)
    }
}

/// The App Intents entity for a vehicle parameter.
public struct VehicleEntity: AppEntity, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }

    public init(_ entry: VehicleDirectoryEntry) {
        id = entry.id
        name = entry.name
    }

    public static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "intent.vehicle.typeName")
    }

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: .init(systemName: "car.fill"))
    }

    public static let defaultQuery = VehicleEntityQuery()
}

/// Resolves vehicle entities for intent parameters from the mirrored directory.
public struct VehicleEntityQuery: EntityQuery {
    private let store: VehicleDirectoryStore

    public init() {
        store = VehicleDirectoryStore()
    }

    public init(store: VehicleDirectoryStore) {
        self.store = store
    }

    public func entities(for identifiers: [VehicleEntity.ID]) async throws -> [VehicleEntity] {
        let wanted = Set(identifiers)
        return store.load().filter { wanted.contains($0.id) }.map(VehicleEntity.init)
    }

    public func suggestedEntities() async throws -> [VehicleEntity] {
        store.load().map(VehicleEntity.init)
    }
}
