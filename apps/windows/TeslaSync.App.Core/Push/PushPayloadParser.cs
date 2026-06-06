using System.Text.Json;

namespace TeslaSync.App.Core.Push;

/// <summary>
/// Decodes a raw WNS foreground push body into a typed <see cref="PushPayload"/> (P2/W6-0002). The
/// parser is tolerant: an unparseable or non-object body yields <see cref="PushPayload.Unknown"/>
/// rather than throwing, so a malformed push can never crash the foreground pump. It mirrors the
/// backend <c>notification-worker</c> envelope (a JSON object with <c>kind</c>/<c>type</c>,
/// <c>title</c>, <c>body</c>/<c>message</c> and <c>category</c> plus arbitrary string <c>data</c>).
/// </summary>
public static class PushPayloadParser
{
    /// <summary>Parses <paramref name="raw"/>; returns <see cref="PushPayload.Unknown"/> on any failure.</summary>
    public static PushPayload Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return PushPayload.Unknown;
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return PushPayload.Unknown;
            }

            var kind = ReadString(root, "kind") ?? ReadString(root, "type") ?? PushPayload.UnknownKind;
            var title = ReadString(root, "title");
            var body = ReadString(root, "body") ?? ReadString(root, "message");
            var category = ReadString(root, "category");
            var data = ReadData(root);

            return new PushPayload(kind, title, body, category, data);
        }
        catch (JsonException)
        {
            return PushPayload.Unknown;
        }
    }

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static Dictionary<string, string> ReadData(JsonElement root)
    {
        var data = new Dictionary<string, string>(StringComparer.Ordinal);
        if (root.TryGetProperty("data", out var element) && element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.String)
                {
                    data[property.Name] = property.Value.GetString() ?? string.Empty;
                }
            }
        }

        return data;
    }
}
