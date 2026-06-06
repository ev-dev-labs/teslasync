import Foundation

/// The single JSON coder configuration the app (writer) and widgets (readers) both
/// use, so the on-disk payload always round-trips. ISO-8601 dates keep the file
/// human-debuggable and stable across OS/locale.
public enum WidgetSnapshotCoder {
    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    /// Encodes a snapshot to JSON `Data`.
    public static func encode(_ snapshot: TeslaSyncWidgetSnapshot) throws -> Data {
        try makeEncoder().encode(snapshot)
    }

    /// Decodes a snapshot from JSON `Data`.
    public static func decode(_ data: Data) throws -> TeslaSyncWidgetSnapshot {
        try makeDecoder().decode(TeslaSyncWidgetSnapshot.self, from: data)
    }
}
