using System.Collections.ObjectModel;

namespace TeslaSync.App.Core.Push;

/// <summary>
/// A decoded foreground push payload (P2/W6-0002). It carries the display fields and any extra
/// string data the backend included so the router can present a toast, raise an in-app banner, and
/// ingest a notification — all without holding a background stream open (ADR-009).
/// </summary>
public sealed record PushPayload(
    string Kind,
    string? Title,
    string? Body,
    string? Category,
    IReadOnlyDictionary<string, string> Data)
{
    /// <summary>The kind used when a payload could not be decoded into a known shape.</summary>
    public const string UnknownKind = "unknown";

    /// <summary>An empty, undecodable payload.</summary>
    public static PushPayload Unknown { get; } = new(
        UnknownKind,
        null,
        null,
        null,
        new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(StringComparer.Ordinal)));
}
