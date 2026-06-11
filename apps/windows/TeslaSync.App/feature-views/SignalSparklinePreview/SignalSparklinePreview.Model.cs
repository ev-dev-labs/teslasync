using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Live;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Query shape for the signal-sparkline preview — the native mirror of the web component's hardcoded
/// <c>useSignalHistory(vehicleId, signal, { hours: 1, limit: 30 })</c> call and its
/// <c>numericSeries.length &lt; 2</c> render gate
/// (web/src/features/telemetry/components/SignalSparklinePreview.tsx). Centralised so the source, mapper
/// and tests share one definition.
/// </summary>
public static class SignalSparklinePreviewQuery
{
    /// <summary>Trailing window, in hours, the preview charts (web <c>SPARKLINE_HOURS</c>).</summary>
    public const int Hours = 1;

    /// <summary>Maximum samples requested for the trend (web <c>SPARKLINE_LIMIT</c>).</summary>
    public const int Limit = 30;

    /// <summary>
    /// Minimum numeric samples required to draw a line rather than the em-dash fallback (web
    /// <c>numericSeries.length &lt; 2</c>). A single point has no trend, so it collapses to the empty state.
    /// </summary>
    public const int MinSamples = 2;
}

/// <summary>
/// Surface-local helpers over the canonical <see cref="SignalKind"/> (TeslaSync.App.Core.Live) — the native
/// analogue of the web hook's <c>normalizeSignalKind</c> plus the component's <c>NON_NUMERIC</c> set and the
/// <c>{valueKind}</c> chip text (web/src/api/hooks/useSignals.ts and SignalSparklinePreview.tsx). Kept on the
/// surface (mirroring <c>XRayValueKind</c>) because the Core decoder's equivalents are private; pure and
/// unit-tested without a UI host.
/// </summary>
public static class SignalSparklineKinds
{
    private static readonly Dictionary<string, SignalKind> LongFormByName =
        new(StringComparer.Ordinal)
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

    private static readonly Dictionary<string, SignalKind> CompactByName =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["unknown"] = SignalKind.Unknown,
            ["string"] = SignalKind.String,
            ["bool"] = SignalKind.Bool,
            ["int"] = SignalKind.Int,
            ["float"] = SignalKind.Float,
            ["time"] = SignalKind.Time,
        };

    // Mirrors the iota order in internal/tesla/protomodel/types.go (web normalizeSignalKind's numeric branch).
    private static readonly Dictionary<int, SignalKind> CompactByInt =
        new()
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

    /// <summary>
    /// Whether a signal of <paramref name="kind"/> has a meaningful trend line. Mirrors the web
    /// <c>NON_NUMERIC = { 'string', 'unknown', 'time' }</c>: numeric kinds are <see cref="SignalKind.Bool"/>
    /// (charted as 0/1), <see cref="SignalKind.Int"/> and <see cref="SignalKind.Float"/>.
    /// </summary>
    public static bool IsNumeric(SignalKind kind) =>
        kind is SignalKind.Bool or SignalKind.Int or SignalKind.Float;

    /// <summary>
    /// The compact lowercase token shown in the non-numeric chip and its tooltip (web renders the raw
    /// <c>{valueKind}</c>). These are technical type identifiers, rendered verbatim rather than localized —
    /// exactly as the web source does.
    /// </summary>
    public static string Token(SignalKind kind) => kind switch
    {
        SignalKind.String => "string",
        SignalKind.Bool => "bool",
        SignalKind.Int => "int",
        SignalKind.Float => "float",
        SignalKind.Time => "time",
        _ => "unknown",
    };

    /// <summary>
    /// Normalise a raw <c>value_kind</c> / <c>kind</c> JSON value (the long-form <c>"ValueKindFloat"</c>
    /// string, the compact <c>"float"</c> string, or the proto enum integer) to a <see cref="SignalKind"/>.
    /// Total like the web <c>normalizeSignalKind</c>: any unrecognised input becomes
    /// <see cref="SignalKind.Unknown"/>.
    /// </summary>
    public static SignalKind Normalize(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                string text = element.GetString() ?? string.Empty;
                if (CompactByName.TryGetValue(text, out var compact))
                {
                    return compact;
                }

                return LongFormByName.TryGetValue(text, out var longForm) ? longForm : SignalKind.Unknown;

            case JsonValueKind.Number when element.TryGetInt32(out int asInt):
                return CompactByInt.TryGetValue(asInt, out var intForm) ? intForm : SignalKind.Unknown;

            default:
                return SignalKind.Unknown;
        }
    }
}

/// <summary>
/// Pure extraction of the chartable numeric series from a
/// <c>GET /signals/{vehicleID}/{signalName}/history</c> payload — the native port of the web component's
/// <c>envelopesToNumbers</c> (SignalSparklinePreview.tsx): a finite numeric value is taken as-is, a boolean
/// folds to 1 / 0, and every other typed value (string, time, null, compound) is skipped. Tolerant of a
/// partial or schema-drifted payload so a malformed history row never aborts the parse. No UI types —
/// unit-tested without a host.
/// </summary>
public static class SignalSparklineSeries
{
    /// <summary>
    /// Project the <c>data</c> array of a typed history response into the numeric series the sparkline plots,
    /// in wire order. A non-object body or a missing / non-array <c>data</c> field yields an empty series.
    /// </summary>
    public static IReadOnlyList<double> FromHistory(JsonElement response)
    {
        if (response.ValueKind != JsonValueKind.Object
            || !response.TryGetProperty("data", out var data)
            || data.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<double>();
        }

        var series = new List<double>(data.GetArrayLength());
        foreach (var envelope in data.EnumerateArray())
        {
            if (TryNumericValue(envelope, out double value))
            {
                series.Add(value);
            }
        }

        return series;
    }

    // web envelopesToNumbers operates on already-coerced envelopes: number (finite) and boolean (1/0) are
    // kept, everything else dropped. A numeric kind whose value arrived as a JSON string is coerced first
    // (web coerceValue), so we mirror that single string-to-number path for Int/Float kinds only.
    private static bool TryNumericValue(JsonElement envelope, out double value)
    {
        value = 0;
        if (envelope.ValueKind != JsonValueKind.Object
            || !envelope.TryGetProperty("value", out var raw))
        {
            return false;
        }

        switch (raw.ValueKind)
        {
            case JsonValueKind.Number when raw.TryGetDouble(out double number) && double.IsFinite(number):
                value = number;
                return true;

            case JsonValueKind.True:
                value = 1;
                return true;

            case JsonValueKind.False:
                value = 0;
                return true;

            case JsonValueKind.String:
                return TryParseNumericString(envelope, raw, out value);

            default:
                return false;
        }
    }

    private static bool TryParseNumericString(JsonElement envelope, JsonElement raw, out double value)
    {
        value = 0;
        var kind = envelope.TryGetProperty("kind", out var kindElement)
            ? SignalSparklineKinds.Normalize(kindElement)
            : SignalKind.Unknown;
        if (kind is not (SignalKind.Int or SignalKind.Float))
        {
            return false;
        }

        return double.TryParse(
            raw.GetString(),
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out value) && double.IsFinite(value);
    }
}

/// <summary>
/// The lifecycle state the signal-sparkline preview can be in. Every branch maps onto a visible surface —
/// none is hidden. <see cref="Disabled"/> reproduces the web <c>if (!enabled) return null</c> gate (the
/// parent flips the preview on as a category leaf expands), and <see cref="NonNumeric"/> /
/// <see cref="Empty"/> / <see cref="Loaded"/> reproduce the web's chip / em-dash / sparkline branches; the
/// native surface additionally renders an explicit <see cref="Error"/> (retry), <see cref="Stale"/> and
/// <see cref="Offline"/> branch — a strict superset of the web that satisfies the prompt's mandated state set.
/// </summary>
public enum SignalSparklinePreviewState
{
    /// <summary>The preview is gated off by its parent (web <c>!enabled</c>); the surface collapses.</summary>
    Disabled,

    /// <summary>A non-numeric signal (string / unknown / time): the compact <c>(kind)</c> chip.</summary>
    NonNumeric,

    /// <summary>First fetch with nothing cached — the pulsing skeleton sized to the sparkline box.</summary>
    Loading,

    /// <summary>Fewer than two samples in the window — the em-dash fallback (web <c>numericSeries &lt; 2</c>).</summary>
    Empty,

    /// <summary>A fresh series with at least two samples — the trend line.</summary>
    Loaded,

    /// <summary>A cached series past the freshness window — the trend line plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached series remains — the trend (or em-dash) plus an offline chip.</summary>
    Offline,

    /// <summary>The fetch failed with no cached series — the compact retry affordance.</summary>
    Error,
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;double&gt;&gt;</c>, preserving the cache-then-network status /
/// freshness while extracting the numeric series. A loaded / cached series with fewer than
/// <see cref="SignalSparklinePreviewQuery.MinSamples"/> points collapses to <see cref="LoadStatus.Empty"/> so
/// the surface shows its em-dash fallback (web parity). The offline branch keeps whatever cached series it has
/// so the surface can still render it under the offline chip. Pure — unit-tested without a network or cache.
/// </summary>
public static class SignalSparklinePreviewResultMapper
{
    /// <summary>Map a raw history emission to a typed numeric-series result.</summary>
    public static RepositoryResult<IReadOnlyList<double>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<IReadOnlyList<double>>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<IReadOnlyList<double>>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<IReadOnlyList<double>>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var series = SignalSparklineSeries.FromHistory(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;
        bool enough = series.Count >= SignalSparklinePreviewQuery.MinSamples;

        return raw.Status switch
        {
            LoadStatus.Cached => enough
                ? RepositoryResult<IReadOnlyList<double>>.Cached(series, fetchedAt, raw.IsStale)
                : RepositoryResult<IReadOnlyList<double>>.Empty(fetchedAt),
            LoadStatus.Refreshing => enough
                ? RepositoryResult<IReadOnlyList<double>>.Refreshing(series, fetchedAt, raw.IsStale)
                : RepositoryResult<IReadOnlyList<double>>.Empty(fetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<double>>.OfflineCached(
                series, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => enough
                ? RepositoryResult<IReadOnlyList<double>>.Loaded(series, fetchedAt)
                : RepositoryResult<IReadOnlyList<double>>.Empty(fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the signal-sparkline preview surface — the native mirror of the web
/// component (web/src/features/telemetry/components/SignalSparklinePreview.tsx). Centralises the stable id and
/// the diagnostics slug so the view and view-model stay free of literal identifiers.
/// </summary>
public static class SignalSparklinePreviewRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "signal-sparkline-preview";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SignalSparklinePreview";
}

/// <summary>
/// PII-safe diagnostics for the signal-sparkline preview surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a signal name, value or vehicle id —
/// so a diagnostics line can never leak which vehicle or telemetry field was previewed. Thread-safe.
/// </summary>
public sealed class SignalSparklinePreviewDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalSparklinePreviewDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalSparklinePreview</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalSparklinePreviewRegistration.Slug}");
    }
}
