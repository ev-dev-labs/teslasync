using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SignalLogViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SignalLogWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetEventFeed</c>
/// (web/src/features/dashboard/widgets/SignalLogWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum SignalLogState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no signal updates — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The canonical ingestion source of a signal observation — the native union of the four keys in the
/// web <c>SOURCE_LABELS</c> / <c>SOURCE_COLORS</c> maps
/// (web/src/features/dashboard/widgets/SignalLogWidget.tsx). <see cref="Other"/> covers any future
/// wire value so an unknown source still renders a sane (muted) badge rather than throwing.
/// </summary>
public enum SignalSourceKind
{
    /// <summary>Fleet Telemetry MQTT stream — badge "MQTT", success tint.</summary>
    Telemetry,

    /// <summary>Fleet API poll — badge "API", info tint.</summary>
    Api,

    /// <summary>Manually entered value — badge "Manual", warning tint.</summary>
    Manual,

    /// <summary>Backfilled / cached value — badge "Cache", muted tint.</summary>
    Backfill,

    /// <summary>An unrecognised source string — badge echoes the raw value, muted tint.</summary>
    Other,
}

/// <summary>
/// The resolved badge presentation for a signal source: the canonical <see cref="Kind"/>, the short
/// <see cref="Label"/> shown in the chip (web <c>SOURCE_LABELS</c>), and the token brush key tinting
/// it (web <c>SOURCE_COLORS</c>, mapped onto the design-token palette). Pure data — no WinUI types.
/// </summary>
public readonly record struct SignalSourceTokens(SignalSourceKind Kind, string Label, string AccentBrushKey);

/// <summary>
/// Maps a wire source string onto its badge tokens — the native port of the web
/// <c>SOURCE_LABELS</c> + <c>SOURCE_COLORS</c> lookups (plus the <c>obs.source ?? 'backfill'</c>
/// fallback). The web hex palette is mapped onto the shared token brushes so theming still flows
/// through the design system: green→success, cyan→info, amber→warning, grey→muted.
/// </summary>
public static class SignalSources
{
    /// <summary>The default source the modern <c>/signals/observations</c> envelope is read as.</summary>
    /// <remarks>
    /// The enveloped endpoint does not expose the ingestion source, so the web hook
    /// (<c>adaptObservations</c>) hard-defaults every row to the dominant MQTT path. We mirror that
    /// default while still honouring an explicit <c>source</c> field if a future contract adds one.
    /// </remarks>
    public const string DefaultWire = "fleet_telemetry";

    /// <summary>Resolve the badge tokens for a (possibly null/unknown) wire source string.</summary>
    public static SignalSourceTokens TokensFor(string? wire)
    {
        // Web parity: `const source = obs.source ?? 'backfill'`.
        string source = string.IsNullOrWhiteSpace(wire) ? "backfill" : wire.Trim();
        return source switch
        {
            "fleet_telemetry" => new(SignalSourceKind.Telemetry, "MQTT", "TsColorSuccessBrush"),
            "fleet_api" => new(SignalSourceKind.Api, "API", "TsColorInfoBrush"),
            "manual" => new(SignalSourceKind.Manual, "Manual", "TsColorWarningBrush"),
            "backfill" => new(SignalSourceKind.Backfill, "Cache", "TsColorTextMutedBrush"),
            // Web parity: `SOURCE_LABELS[source] ?? source` + grey fallback colour.
            _ => new(SignalSourceKind.Other, source, "TsColorTextMutedBrush"),
        };
    }
}

/// <summary>
/// One parsed signal observation from the modern <c>GET /signals/observations</c> envelope
/// (<c>{count, total, observations: [{vehicle_id, ts, field, value_kind, value}]}</c>). The trio of
/// nullable <see cref="ValueNumeric"/> / <see cref="ValueText"/> / <see cref="ValueBool"/> mirrors the
/// legacy frontend <c>SignalObservation</c> shape the web <c>useSignalObservations</c> adapter projects
/// onto; parsing is null-tolerant so a partial row never throws.
/// </summary>
public sealed record SignalLogObservation(
    long VehicleId,
    string? Ts,
    string SignalName,
    double? ValueNumeric,
    string? ValueText,
    bool? ValueBool,
    string Source)
{
    // ValueKind enum literals emitted by protomodel.ValueKind.String(), grouped exactly as the web
    // adapter groups them (web/src/api/hooks/useTelemetry.ts).
    private static readonly HashSet<string> NumericKinds = new(StringComparer.Ordinal)
    {
        "ValueKindFloat", "ValueKindDouble", "ValueKindInt32", "ValueKindInt64", "ValueKindUnixTime",
    };

    private static readonly HashSet<string> TextKinds = new(StringComparer.Ordinal)
    {
        "ValueKindString", "ValueKindEnum",
    };

    private static readonly HashSet<string> BoolKinds = new(StringComparer.Ordinal)
    {
        "ValueKindBool", "ValueKindBoolean",
    };

    /// <summary>The parsed observation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? Timestamp => TryParseTimestamp(Ts);

    /// <summary>
    /// The display value for the row's subtitle — the native port of the web <c>formatSignalValue</c>:
    /// the numeric, then text, then boolean value, falling back to an em-dash.
    /// </summary>
    public string FormatValue()
    {
        if (ValueNumeric is { } n)
        {
            return n.ToString(CultureInfo.InvariantCulture);
        }

        if (ValueText is { } t)
        {
            return t;
        }

        if (ValueBool is { } b)
        {
            return b ? "true" : "false";
        }

        return "\u2014";
    }

    /// <summary>
    /// Parse the <c>/signals/observations</c> envelope into a tolerant list of rows — the native port
    /// of the web <c>adaptObservations</c>: it reads the <c>observations</c> array, classifies each
    /// row's <c>value_kind</c> into the numeric / text / bool slot, and defaults the source to MQTT
    /// (the enveloped contract does not carry one).
    /// </summary>
    public static IReadOnlyList<SignalLogObservation> ParseEnvelope(JsonElement envelope)
    {
        if (envelope.ValueKind != JsonValueKind.Object ||
            !envelope.TryGetProperty("observations", out var rows) ||
            rows.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalLogObservation>();
        }

        var list = new List<SignalLogObservation>(rows.GetArrayLength());
        foreach (var row in rows.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromRow(row));
            }
        }

        return list;
    }

    private static SignalLogObservation FromRow(JsonElement row)
    {
        string kind = GetString(row, "value_kind") ?? GetString(row, "valueKind") ?? string.Empty;
        bool hasValue = row.TryGetProperty("value", out var value);

        double? numeric = null;
        string? text = null;
        bool? boolean = null;

        if (NumericKinds.Contains(kind))
        {
            numeric = hasValue ? ReadNumeric(value) : null;
        }
        else if (TextKinds.Contains(kind))
        {
            text = hasValue ? ReadText(value) : null;
        }
        else if (BoolKinds.Contains(kind))
        {
            boolean = hasValue ? ReadBool(value) : null;
        }

        return new SignalLogObservation(
            VehicleId: GetLong(row, "vehicle_id") ?? GetLong(row, "vehicleId") ?? 0,
            Ts: GetString(row, "ts"),
            SignalName: GetString(row, "field") ?? string.Empty,
            ValueNumeric: numeric,
            ValueText: text,
            ValueBool: boolean,
            Source: GetString(row, "source") ?? SignalSources.DefaultWire);
    }

    private static double? ReadNumeric(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number when value.TryGetDouble(out var n) && double.IsFinite(n) => n,
        JsonValueKind.String when double.TryParse(
            value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) => n,
        _ => null,
    };

    private static string? ReadText(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => value.GetRawText(),
    };

    private static bool? ReadBool(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null,
    };

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(
                v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact</c> (<c>size.cols &lt;= 1</c>) branch plus the fixed <c>maxItems={20}</c> /
/// <c>limit: 20</c> the web feed reads (web/src/features/dashboard/widgets/SignalLogWidget.tsx).
/// </summary>
public readonly record struct SignalLogSize(int Cols, int Rows)
{
    /// <summary>Maximum rows rendered — the web always caps the feed and the query at 20, size-independently.</summary>
    public const int MaxItems = 20;

    /// <summary>The registry default footprint (2×4).</summary>
    public static SignalLogSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the signals/sec big number instead of the feed.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready signal row consumed by the WinUI view. Holds the resolved source
/// badge (label + token brush key), the signal name, the formatted value, the relative time string,
/// and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record SignalLogRow(
    string Id,
    SignalSourceKind SourceKind,
    string SourceLabel,
    string AccentBrushKey,
    string SignalName,
    string Value,
    string RelativeTime,
    DateTimeOffset? Timestamp,
    string AutomationName);

/// <summary>
/// Pure projection from raw observations to display rows — the native port of the <c>useMemo</c>
/// mapping in web/src/features/dashboard/widgets/SignalLogWidget.tsx plus <c>WidgetEventFeed</c>'s
/// newest-first sort and <c>maxItems</c> slice. <c>now</c> is injected so the relative-time tiers are
/// unit-tested deterministically.
/// </summary>
public static class SignalLogProjection
{
    /// <summary>Project + sort (newest first) + cap <paramref name="observations"/> to the row budget.</summary>
    public static IReadOnlyList<SignalLogRow> Project(
        IReadOnlyList<SignalLogObservation> observations,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(observations);

        // Web parity: observations are mapped (preserving the original index for the row key) then the
        // feed sorts newest-first and slices to maxItems.
        var ordered = observations
            .Select((obs, index) => (obs, index))
            .OrderByDescending(x => x.obs.Timestamp ?? DateTimeOffset.MinValue)
            .Take(SignalLogSize.MaxItems);

        var rows = new List<SignalLogRow>(Math.Min(observations.Count, SignalLogSize.MaxItems));
        foreach (var (obs, index) in ordered)
        {
            var tokens = SignalSources.TokensFor(obs.Source);
            string signalName = string.IsNullOrEmpty(obs.SignalName) ? "\u2014" : obs.SignalName;
            string value = obs.FormatValue();
            string relative = DateTimeFormatting.Format(obs.Timestamp, DateTimeVariant.Relative, now);
            string id = string.Create(
                CultureInfo.InvariantCulture, $"{obs.Ts}-{obs.SignalName}-{index}");

            rows.Add(new SignalLogRow(
                Id: id,
                SourceKind: tokens.Kind,
                SourceLabel: tokens.Label,
                AccentBrushKey: tokens.AccentBrushKey,
                SignalName: signalName,
                Value: value,
                RelativeTime: relative,
                Timestamp: obs.Timestamp,
                AutomationName: AutomationName(tokens.Label, signalName, value, relative)));
        }

        return rows;
    }

    private static string AutomationName(string source, string signalName, string value, string relativeTime) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}, {3}", source, signalName, value, relativeTime);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SignalLogObservation&gt;&gt;</c>, preserving every freshness
/// flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix.
/// Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SignalLogResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SignalLogObservation>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SignalLogObservation> Parse() =>
            raw.HasValue ? SignalLogObservation.ParseEnvelope(raw.Value) : Array.Empty<SignalLogObservation>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SignalLogObservation>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SignalLogObservation>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SignalLogObservation>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SignalLogObservation>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SignalLogObservation>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SignalLogObservation>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<SignalLogObservation>> ToLoadedOrEmpty(
        IReadOnlyList<SignalLogObservation> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<SignalLogObservation>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<SignalLogObservation>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}

/// <summary>
/// Aggregates the fleet-wide signals/second rate from the <c>GET /telemetry/</c> status payload — the
/// native port of the web <c>rate</c> memo (sum of each streaming vehicle's
/// <c>signalsPerSecond ?? signals_per_second</c>). Drives the compact (1-column) big-number view.
/// Tolerant of both the object-map and array shapes the web <c>useMQTTStatus</c> normaliser handles.
/// </summary>
public static class SignalLogRate
{
    /// <summary>Sum the per-vehicle signals/second across the telemetry status payload (0 when absent).</summary>
    public static double Aggregate(JsonElement telemetry)
    {
        if (telemetry.ValueKind != JsonValueKind.Object)
        {
            return 0;
        }

        if (!TryGetVehicles(telemetry, out var vehicles))
        {
            return 0;
        }

        double sum = 0;
        if (vehicles.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in vehicles.EnumerateObject())
            {
                sum += RateOf(property.Value);
            }
        }
        else if (vehicles.ValueKind == JsonValueKind.Array)
        {
            foreach (var vehicle in vehicles.EnumerateArray())
            {
                sum += RateOf(vehicle);
            }
        }

        return sum;
    }

    /// <summary>Map a raw telemetry emission onto the aggregated rate, preserving its freshness status.</summary>
    public static RepositoryResult<double> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<double>.Loading(),
            LoadStatus.Cached => RepositoryResult<double>.Cached(Aggregate(raw.Value), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<double>.Refreshing(Aggregate(raw.Value), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<double>.Loaded(Aggregate(raw.Value), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Offline => RepositoryResult<double>.OfflineCached(Aggregate(raw.Value), raw.FetchedAt!.Value, raw.Error!),
            LoadStatus.Empty => RepositoryResult<double>.Empty(raw.FetchedAt),
            _ => RepositoryResult<double>.Failure(raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static bool TryGetVehicles(JsonElement telemetry, out JsonElement vehicles)
    {
        // Web parity: `raw.vehicles ?? raw.streaming_vehicles`.
        if (telemetry.TryGetProperty("vehicles", out vehicles) &&
            vehicles.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
        {
            return true;
        }

        return telemetry.TryGetProperty("streaming_vehicles", out vehicles) &&
            vehicles.ValueKind is JsonValueKind.Object or JsonValueKind.Array;
    }

    private static double RateOf(JsonElement vehicle)
    {
        if (vehicle.ValueKind != JsonValueKind.Object)
        {
            return 0;
        }

        // Web parity: `v.signalsPerSecond ?? v.signals_per_second ?? 0`.
        return ReadDouble(vehicle, "signalsPerSecond") ?? ReadDouble(vehicle, "signals_per_second") ?? 0;
    }

    private static double? ReadDouble(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) && double.IsFinite(n)
            ? n
            : null;
}
