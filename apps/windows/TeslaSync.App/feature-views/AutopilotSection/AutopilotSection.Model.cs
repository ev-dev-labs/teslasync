using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state an <see cref="AutopilotSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web source
/// (web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx) is presentational: it receives
/// its three live queries and shows either the three stat cards (when any value is present) or a single empty
/// surface. The native feature-view owns its own cache-then-network read of the same three endpoints and
/// therefore renders the full state matrix the prompt mandates. Every branch maps onto a visible surface —
/// none is ever hidden.
/// </summary>
public enum AutopilotState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton tiles.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) with at least one cruise/autopilot value.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no speed / cruise / follow value — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The cruise / autopilot slice the surface needs, reduced to the three values the web component reads:
/// the current vehicle <see cref="SpeedMps"/> (web <c>vehicleState?.speed</c> from
/// <c>GET /vehicles/{id}/state</c>), the <see cref="CruiseSetMps"/> (web <c>latestNumeric</c> of the
/// <c>CruiseSetSpeed</c> observation) and the <see cref="FollowDistance"/> bar count (web <c>latestText</c> of
/// the <c>CruiseFollowDistance</c> enum, stripped to its trailing digits). Both speeds are SI metres-per-second
/// on the wire (the backend normalizes <c>VehicleSpeed</c> and <c>CruiseSetSpeed</c> to m/s regardless of the
/// vehicle's display unit — see internal/tesla/units) and are converted to the user's display unit only at
/// projection time. Each field is independently nullable so a partial or schema-drifted body never throws and
/// the per-card em-dash (web parity) is preserved.
/// </summary>
public sealed record AutopilotSnapshot(double? SpeedMps, double? CruiseSetMps, string? FollowDistance)
{
    /// <summary>The merged-envelope key holding the raw <c>GET /vehicles/{id}/state</c> body.</summary>
    public const string StateKey = "state";

    /// <summary>The merged-envelope key holding the raw <c>CruiseSetSpeed</c> observations body.</summary>
    public const string CruiseSetKey = "cruise_set";

    /// <summary>The merged-envelope key holding the raw <c>CruiseFollowDistance</c> observations body.</summary>
    public const string FollowKey = "follow";

    /// <summary>An all-absent snapshot — the parse fallback for an absent/non-object body.</summary>
    public static AutopilotSnapshot Empty { get; } = new(null, null, null);

    /// <summary>
    /// True when at least one of the three values is present — the native analogue of the web
    /// <c>hasAny = speedMps != null || cruiseSetMps != null || followDistance != null</c> gate. Drives the
    /// empty state: the web renders the grid when any value is present (with a per-card em-dash for the
    /// absent ones) and the empty surface otherwise.
    /// </summary>
    public bool HasData => SpeedMps is not null || CruiseSetMps is not null || FollowDistance is not null;

    /// <summary>
    /// Project the merged cache envelope — <c>{ "state": …, "cruise_set": …, "follow": … }</c> built by the
    /// <see cref="AutopilotSectionSource"/> — into a tolerant snapshot. The vehicle-state body is unwrapped
    /// from its <c>{ state, live }</c> envelope (the Go handler shape) before its <c>speed</c> is read; the two
    /// observation bodies are reduced through the same value-kind discriminator the web
    /// <c>adaptObservations</c> applies.
    /// </summary>
    public static AutopilotSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        double? speed = element.TryGetProperty(StateKey, out var state) ? ReadSpeed(state) : null;
        double? cruiseSet = element.TryGetProperty(CruiseSetKey, out var cruise) ? LatestNumeric(cruise) : null;

        string? follow = element.TryGetProperty(FollowKey, out var followObs)
            ? ParseFollowDistance(LatestText(followObs) ?? NumericAsText(followObs))
            : null;

        return new AutopilotSnapshot(speed, cruiseSet, follow);
    }

    /// <summary>
    /// Tesla emits <c>CruiseFollowDistance</c> as a proto enum, e.g. "FollowDistance7" — meaning a 7-bar
    /// follow gap. The number suffix is the only useful bit for display, so peel it off rather than rendering
    /// the raw enum (web <c>parseFollowDistance</c>). Falls back to the raw value if the enum schema ever
    /// changes and carries no trailing digits.
    /// </summary>
    public static string? ParseFollowDistance(string? raw)
    {
        if (raw is null)
        {
            return null;
        }

        var match = Regex.Match(raw, @"(\d+)\s*$");
        return match.Success ? match.Groups[1].Value : raw;
    }

    // Web: speedMps = stateData?.state?.speed ?? null. The Go handler wraps the state in { state, live }; be
    // tolerant of both the wrapped shape and a bare state object, and treat a present numeric speed (even 0)
    // as a value so the "0" readout matches the web's `speed ?? null` presence test.
    private static double? ReadSpeed(JsonElement stateBody)
    {
        if (stateBody.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var inner = stateBody.TryGetProperty("state", out var nested) && nested.ValueKind == JsonValueKind.Object
            ? nested
            : stateBody;

        return GetNumber(inner, "speed");
    }

    // Web latestNumeric: data?.[0]?.value_numeric. The modern envelope is { observations: [{ value_kind,
    // value }] } and a numeric value-kind carries the number in `value`; mirror adaptObservations' numeric set.
    private static double? LatestNumeric(JsonElement envelope)
    {
        if (!TryFirstObservation(envelope, out var row))
        {
            return null;
        }

        return IsNumericKind(ValueKind(row)) ? AsNumber(Value(row)) : null;
    }

    // Web latestText: data?.[0]?.value_text. A text/enum value-kind carries the string in `value`.
    private static string? LatestText(JsonElement envelope)
    {
        if (!TryFirstObservation(envelope, out var row))
        {
            return null;
        }

        return IsTextKind(ValueKind(row)) ? AsText(Value(row)) : null;
    }

    // Web fallback: `latestNumeric(followObs) != null ? String(latestNumeric(followObs)) : null` — a backend
    // that re-encodes the bar-count as ValueKindInt32 instead of an enum still renders.
    private static string? NumericAsText(JsonElement envelope)
    {
        var numeric = LatestNumeric(envelope);
        return numeric is { } n ? n.ToString(CultureInfo.InvariantCulture) : null;
    }

    private static bool TryFirstObservation(JsonElement envelope, out JsonElement row)
    {
        row = default;
        if (envelope.ValueKind != JsonValueKind.Object
            || !envelope.TryGetProperty("observations", out var observations)
            || observations.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        foreach (var first in observations.EnumerateArray())
        {
            row = first;
            return first.ValueKind == JsonValueKind.Object;
        }

        return false;
    }

    // Tolerate snake_case (production) and camelCase (some request middleware) value-kind keys, exactly like
    // the web adapter does.
    private static string ValueKind(JsonElement row)
    {
        if (row.TryGetProperty("value_kind", out var snake) && snake.ValueKind == JsonValueKind.String)
        {
            return snake.GetString() ?? string.Empty;
        }

        if (row.TryGetProperty("valueKind", out var camel) && camel.ValueKind == JsonValueKind.String)
        {
            return camel.GetString() ?? string.Empty;
        }

        return string.Empty;
    }

    private static JsonElement Value(JsonElement row) =>
        row.TryGetProperty("value", out var value) ? value : default;

    // Web NUMERIC_VALUE_KINDS.
    private static bool IsNumericKind(string kind) => kind is
        "ValueKindFloat" or "ValueKindDouble" or "ValueKindInt32" or "ValueKindInt64" or "ValueKindUnixTime";

    // Web TEXT_VALUE_KINDS — proto-prefixed enum names like "FollowDistance7" land here.
    private static bool IsTextKind(string kind) => kind is "ValueKindString" or "ValueKindEnum";

    // Web: typeof value === 'number' ? value : Number(value), then a finite guard.
    private static double? AsNumber(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number when value.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
        JsonValueKind.String when double.TryParse(
            value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n)
            && !double.IsNaN(n) && !double.IsInfinity(n) => n,
        _ => null,
    };

    // Web: row.value == null ? null : String(row.value).
    private static string? AsText(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => value.GetRawText(),
    };

    private static double? GetNumber(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(
                value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n)
                && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view — the native analogue of a web
/// <c>StatCard</c> instance. Holds the localized label, the already-formatted value (or em-dash), the unit
/// sub-line, the resolved Fluent glyph and a Narrator automation name. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record AutopilotMetric(
    string Label,
    string Value,
    string Sublabel,
    string Glyph,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the autopilot section — the three stat tiles plus the
/// <see cref="HasData"/> gate that selects grid vs. empty. Pure data so the projection is unit-tested without
/// a UI host.
/// </summary>
public sealed record AutopilotDisplay(bool HasData, IReadOnlyList<AutopilotMetric> Cards)
{
    /// <summary>An empty projection (no tiles) — the projection fallback.</summary>
    public static AutopilotDisplay Empty { get; } = new(false, Array.Empty<AutopilotMetric>());
}

/// <summary>
/// Pure projection from a parsed <see cref="AutopilotSnapshot"/> to the three display tiles — the native port
/// of the unit conversion + <c>StatCard</c> composition in
/// web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx. SI speed is converted to the
/// user's display unit here (and only here); every label resolves through the i18n facade. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class AutopilotProjection
{
    /// <summary>Em-dash shown when a value is absent (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>Fraction digits the speed readouts render (web <c>fmtNumber(value, 0)</c>).</summary>
    public const int SpeedPrecision = 0;

    // Segoe Fluent / MDL2 glyphs standing in for the web lucide icons (Gauge for current speed, Navigation for
    // the cruise set-speed and follow-distance tiles).
    private const string GaugeGlyph = "\uE950";       // gauge / pulse (current speed)
    private const string NavigationGlyph = "\uE81D";  // location / navigation (cruise + follow)

    /// <summary>Project <paramref name="data"/> into the three stat tiles using the user's units.</summary>
    public static AutopilotDisplay Project(AutopilotSnapshot data, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var speedUnit = units.Speed;
        string speedUnitLabel = UnitLabels.Label(speedUnit);

        string currentSpeedLabel = localizer.GetString("dynamics.currentSpeed", "Current Speed");
        string cruiseSetLabel = localizer.GetString("dynamics.cruiseSetSpeed", "Cruise Set Speed");
        string followLabel = localizer.GetString("dynamics.followDistance", "Follow Distance");

        string currentSpeedValue = data.SpeedMps is { } speed
            ? ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(speed, speedUnit), SpeedPrecision)
            : EmDash;

        string cruiseSetValue = data.CruiseSetMps is { } cruise
            ? ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(cruise, speedUnit), SpeedPrecision)
            : EmDash;

        string followValue = data.FollowDistance ?? EmDash;

        var cards = new List<AutopilotMetric>(3)
        {
            Card(currentSpeedLabel, currentSpeedValue, speedUnitLabel, GaugeGlyph),
            Card(cruiseSetLabel, cruiseSetValue, speedUnitLabel, NavigationGlyph),

            // Web parity: the follow-distance StatCard carries no unit prop (it is a bar count, not a speed).
            Card(followLabel, followValue, string.Empty, NavigationGlyph),
        };

        return new AutopilotDisplay(data.HasData, cards);
    }

    private static AutopilotMetric Card(string label, string value, string sublabel, string glyph) =>
        new(label, value, sublabel, glyph, AutomationName(label, value, sublabel));

    private static string AutomationName(string label, string value, string sublabel) =>
        value == EmDash || string.IsNullOrEmpty(sublabel)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, sublabel);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;AutopilotSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class AutopilotResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<AutopilotSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        AutopilotSnapshot Parse() =>
            raw.HasValue ? AutopilotSnapshot.FromJson(raw.Value) : AutopilotSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<AutopilotSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<AutopilotSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AutopilotSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<AutopilotSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<AutopilotSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<AutopilotSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<AutopilotSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Autopilot Section surface — the native mirror of the web component
/// (web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx, rendered inside the driving
/// dynamics tab). Centralises the stable id, category and diagnostics slug so the view and view-model stay
/// free of literal identifiers.
/// </summary>
public static class AutopilotSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "autopilot-section";

    /// <summary>Surface category (matches the web driving feature).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AutopilotSection";

    /// <summary>The single observation row the cold-signal reads request (web <c>limit: 1</c>).</summary>
    public const int ObservationLimit = 1;

    /// <summary>The <c>CruiseSetSpeed</c> signal field the set-speed observation filters on.</summary>
    public const string CruiseSetField = "CruiseSetSpeed";

    /// <summary>The <c>CruiseFollowDistance</c> signal field the follow-distance observation filters on.</summary>
    public const string FollowDistanceField = "CruiseFollowDistance";
}

/// <summary>
/// PII-safe diagnostics for the Autopilot Section surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a speed, VIN or location — so a
/// diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class AutopilotSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AutopilotSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AutopilotSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AutopilotSectionRegistration.Slug}");
    }
}
