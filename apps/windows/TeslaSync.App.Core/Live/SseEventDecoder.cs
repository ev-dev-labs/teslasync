using System.Globalization;
using System.Text.Json;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// Decodes a raw <see cref="SseFrame"/> into a typed <see cref="LiveEvent"/>. Never returns
/// <see langword="null"/>: an unnamed, unrecognised, or malformed-but-named frame degrades to
/// <see cref="LiveEvent.Unknown"/> carrying the raw payload, so a single bad frame never silently
/// disappears or aborts the stream (the web client surfaces parse errors out-of-band for the same
/// reason). The decoder reports whether a named frame failed to parse via <paramref name="parseFailed"/>
/// so the client can count parse errors without re-inspecting the payload.
///
/// <para>Mirrors the shared Kotlin <c>decodeEvent</c> and the web <c>sseClient</c> taxonomy.</para>
/// </summary>
public static class SseEventDecoder
{
    private static readonly JsonDocumentOptions DocumentOptions = new()
    {
        AllowTrailingCommas = true,
    };

    /// <summary>Decodes <paramref name="frame"/> into a typed event, never throwing.</summary>
    public static LiveEvent Decode(SseFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        return Decode(frame, out _);
    }

    /// <summary>
    /// Decodes <paramref name="frame"/>, setting <paramref name="parseFailed"/> to
    /// <see langword="true"/> when a recognised event name carried an undecodable JSON payload
    /// (so it degraded to <see cref="LiveEvent.Unknown"/>).
    /// </summary>
    public static LiveEvent Decode(SseFrame frame, out bool parseFailed)
    {
        ArgumentNullException.ThrowIfNull(frame);
        parseFailed = false;
        string type = string.IsNullOrEmpty(frame.Event) ? "message" : frame.Event!;
        string raw = frame.Data;

        switch (type)
        {
            case "connected":
                return new LiveEvent.Connected(StringField(raw, "client_id") ?? string.Empty, frame.LastEventId);

            case "heartbeat":
                return new LiveEvent.Heartbeat(StringField(raw, "time"), frame.LastEventId);

            case "vehicle_update":
                return ObjectEvent(raw, frame.LastEventId, type, ref parseFailed,
                    static (data, id) => new LiveEvent.VehicleUpdate(data, id));

            case "alert":
                return ObjectEvent(raw, frame.LastEventId, type, ref parseFailed,
                    static (data, id) => new LiveEvent.Alert(data, id));

            case "export_status":
                return ObjectEvent(raw, frame.LastEventId, type, ref parseFailed,
                    static (data, id) => new LiveEvent.ExportStatus(data, id));

            case "achievement_unlocked":
                return ObjectEvent(raw, frame.LastEventId, type, ref parseFailed,
                    static (data, id) => new LiveEvent.AchievementUnlocked(data, id));

            case "signal_change":
                var envelope = TryParseObject(raw, out var element) ? DecodeEnvelope(element) : null;
                if (envelope is not null)
                {
                    return new LiveEvent.Signal(envelope, frame.LastEventId);
                }

                parseFailed = true;
                return new LiveEvent.Unknown(type, raw, frame.LastEventId);

            default:
                return new LiveEvent.Unknown(type, raw, frame.LastEventId);
        }
    }

    private static LiveEvent ObjectEvent(
        string raw,
        string? id,
        string type,
        ref bool parseFailed,
        Func<JsonElement, string?, LiveEvent> build)
    {
        if (TryParseObject(raw, out var element))
        {
            return build(element, id);
        }

        parseFailed = true;
        return new LiveEvent.Unknown(type, raw, id);
    }

    private static bool TryParseObject(string raw, out JsonElement element)
    {
        try
        {
            using var document = JsonDocument.Parse(raw, DocumentOptions);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                element = default;
                return false;
            }

            element = document.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            element = default;
            return false;
        }
    }

    private static string? StringField(string raw, string key)
    {
        if (!TryParseObject(raw, out var element))
        {
            return null;
        }

        return element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    /// <summary>
    /// Decodes the flat <c>(kind, value)</c> pair into a typed <see cref="SignalEnvelope"/>,
    /// mirroring the web <c>parseEnvelope</c> validation: a missing/empty <c>field</c>, a
    /// missing/non-numeric <c>vehicle_id</c>, or an unresolvable <c>kind</c> all yield
    /// <see langword="null"/> (the event degrades to <see cref="LiveEvent.Unknown"/>).
    /// </summary>
    private static SignalEnvelope? DecodeEnvelope(JsonElement obj)
    {
        if (!obj.TryGetProperty("kind", out var kindElement))
        {
            return null;
        }

        var kind = NormalizeKind(kindElement);
        if (kind is not { } resolvedKind)
        {
            return null;
        }

        string? field = obj.TryGetProperty("field", out var fieldElement) && fieldElement.ValueKind == JsonValueKind.String
            ? fieldElement.GetString()
            : null;
        if (string.IsNullOrEmpty(field))
        {
            return null;
        }

        if (!obj.TryGetProperty("vehicle_id", out var vehicleElement) || !TryGetLong(vehicleElement, out long vehicleId))
        {
            return null;
        }

        string timestamp = obj.TryGetProperty("ts", out var tsElement) && tsElement.ValueKind == JsonValueKind.String
            ? tsElement.GetString() ?? string.Empty
            : string.Empty;

        obj.TryGetProperty("value", out var valueElement);
        return new SignalEnvelope(vehicleId, field, resolvedKind, CoerceValue(valueElement, resolvedKind), timestamp);
    }

    private static SignalKind? NormalizeKind(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String)
        {
            string text = element.GetString() ?? string.Empty;
            if (CompactKindByName.TryGetValue(text, out var compact))
            {
                return compact;
            }

            return ValueKindLongToCompact.TryGetValue(text, out var longForm) ? longForm : null;
        }

        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out int asInt))
        {
            return ValueKindIntToCompact.TryGetValue(asInt, out var intForm) ? intForm : null;
        }

        return null;
    }

    private static SignalValue CoerceValue(JsonElement element, SignalKind kind)
    {
        if (element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return new SignalValue.Null();
        }

        switch (kind)
        {
            case SignalKind.Int:
            case SignalKind.Float:
                if (TryGetDouble(element, out double number))
                {
                    return new SignalValue.Number(number);
                }

                return new SignalValue.Null();

            case SignalKind.Bool:
                return new SignalValue.Flag(CoerceBool(element));

            case SignalKind.String:
                return new SignalValue.Text(CoerceString(element));

            case SignalKind.Time:
                return new SignalValue.Instant(CoerceString(element));

            default:
                return CoerceUnknown(element);
        }
    }

    private static SignalValue CoerceUnknown(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetDouble(out double number))
        {
            return new SignalValue.Number(number);
        }

        if (element.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            return new SignalValue.Flag(element.GetBoolean());
        }

        return new SignalValue.Text(CoerceString(element));
    }

    private static bool CoerceBool(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String => string.Equals(element.GetString(), "true", StringComparison.OrdinalIgnoreCase),
        _ => false,
    };

    private static string CoerceString(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString() ?? string.Empty,
        JsonValueKind.Number => element.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => element.GetRawText(),
    };

    private static bool TryGetLong(JsonElement element, out long value)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt64(out value))
        {
            return true;
        }

        if (element.ValueKind == JsonValueKind.String &&
            long.TryParse(element.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
        {
            return true;
        }

        value = 0;
        return false;
    }

    private static bool TryGetDouble(JsonElement element, out double value)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetDouble(out value))
        {
            return true;
        }

        if (element.ValueKind == JsonValueKind.String &&
            double.TryParse(element.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out value))
        {
            return true;
        }

        value = 0;
        return false;
    }

    // Long-form protomodel.ValueKind name -> compact kind (mirrors VALUE_KIND_LONG_TO_COMPACT).
    private static readonly IReadOnlyDictionary<string, SignalKind> ValueKindLongToCompact =
        new Dictionary<string, SignalKind>(StringComparer.Ordinal)
        {
            ["ValueKindString"] = SignalKind.String,
            ["ValueKindBool"] = SignalKind.Bool,
            ["ValueKindInt32"] = SignalKind.Int,
            ["ValueKindInt64"] = SignalKind.Int,
            ["ValueKindEnum"] = SignalKind.Int,
            ["ValueKindFloat"] = SignalKind.Float,
            ["ValueKindDouble"] = SignalKind.Float,
            ["ValueKindTime"] = SignalKind.Time,
            ["ValueKindUnknown"] = SignalKind.Unknown,
            ["ValueKindCompound"] = SignalKind.Unknown,
            ["ValueKindInvalid"] = SignalKind.Unknown,
        };

    // Integer ValueKind (iota order in internal/tesla/protomodel/types.go) -> compact kind.
    private static readonly IReadOnlyDictionary<int, SignalKind> ValueKindIntToCompact =
        new Dictionary<int, SignalKind>
        {
            [0] = SignalKind.Unknown,
            [1] = SignalKind.String,
            [2] = SignalKind.Bool,
            [3] = SignalKind.Int,
            [4] = SignalKind.Int,
            [5] = SignalKind.Float,
            [6] = SignalKind.Float,
            [7] = SignalKind.Int,
            [8] = SignalKind.Unknown,
            [9] = SignalKind.Time,
        };

    private static readonly IReadOnlyDictionary<string, SignalKind> CompactKindByName =
        new Dictionary<string, SignalKind>(StringComparer.OrdinalIgnoreCase)
        {
            ["unknown"] = SignalKind.Unknown,
            ["string"] = SignalKind.String,
            ["bool"] = SignalKind.Bool,
            ["int"] = SignalKind.Int,
            ["float"] = SignalKind.Float,
            ["time"] = SignalKind.Time,
        };
}
