using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="TimeToChargeSectionViewModel"/> can be in — the
/// native union of the branches the Time-to-Charge surface renders. The web component
/// (web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx) is a pure child of the
/// Charging-Curve page: it takes <c>sessions: ChargingSession[]</c> as a prop and always renders its four
/// metric cards (each showing an em-dash when its metric is null). The native feature-view owns its own
/// cache-then-network read of the charging-sessions list, so it renders the full state matrix the P2
/// contract mandates. Every value maps onto a visible surface (never a blank panel): <see cref="Loaded"/>,
/// <see cref="Stale"/> and <see cref="Offline"/> render the four cards (with per-card em-dashes, the web
/// parity), <see cref="Empty"/> the friendly empty surface when there are no charging sessions at all,
/// <see cref="Loading"/> the card skeletons and <see cref="Error"/> the retry affordance.
/// </summary>
public enum TimeToChargeState
{
    /// <summary>Initial fetch with no cached sessions — render the card skeletons.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one charging session.</summary>
    Loaded,

    /// <summary>No charging sessions at all — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One charging session projected from the charging-sessions list (web <c>ChargingSession</c> in
/// web/src/api/types.ts), reduced to the fields the web <c>TimeToChargeSection</c> reads in its
/// <c>useMemo</c>: the session <c>id</c>, the start / end state-of-charge percentages, the
/// <c>started_at</c> / <c>ended_at</c> instants (for the duration), the SI energy added in watt-hours
/// (<c>total_energy_added_wh</c>), the free-text <c>charger_type</c> and the SI peak power in watts
/// (<c>peak_power_w</c>) — the last two classify a DC session. Field names mirror the Go API's snake_case
/// JSON tags; parsing is null-tolerant so a partial row never throws. WinUI-free so the parse + derivations
/// are unit-tested without a UI host.
/// </summary>
/// <param name="Id">Session id (web <c>s.id</c>).</param>
/// <param name="StartSocPct">Start state-of-charge percent, or null (web <c>s.start_soc_pct</c>).</param>
/// <param name="EndSocPct">End state-of-charge percent, or null (web <c>s.end_soc_pct</c>).</param>
/// <param name="StartedAt">Session start instant, or null (web <c>s.started_at</c>).</param>
/// <param name="EndedAt">Session end instant, or null (web <c>s.ended_at</c>).</param>
/// <param name="TotalEnergyAddedWh">Energy added in watt-hours (web <c>s.total_energy_added_wh ?? 0</c>).</param>
/// <param name="ChargerType">Raw charger-type label, or null (web <c>s.charger_type</c>).</param>
/// <param name="PeakPowerW">Peak power in watts, or null (web <c>s.peak_power_w</c>).</param>
public sealed record TimeToChargeSessionRow(
    long Id,
    double? StartSocPct,
    double? EndSocPct,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    double TotalEnergyAddedWh,
    string? ChargerType,
    double? PeakPowerW)
{
    /// <summary>The DC-fast-charge power threshold in watts (web <c>peak_power_w &gt; 20_000</c>).</summary>
    public const double DcPowerThresholdW = 20_000;

    /// <summary>
    /// Whether this session is a DC-fast session — the native port of the web <c>isDcSession</c>:
    /// <c>!!(s.charger_type || (s.peak_power_w &amp;&amp; s.peak_power_w &gt; 20_000))</c>. An empty
    /// charger_type is falsy in JS, so a present-but-empty label is not treated as DC.
    /// </summary>
    public bool IsDc =>
        !string.IsNullOrEmpty(ChargerType) || (PeakPowerW is { } p && p > DcPowerThresholdW);

    /// <summary>
    /// The session duration in whole minutes — the native port of the web <c>durationMinutes</c>:
    /// 0 when either instant is missing or the end is at/<before the start, otherwise
    /// <c>round((end - start) / 60000)</c>.
    /// </summary>
    public int DurationMinutes
    {
        get
        {
            if (StartedAt is not { } start || EndedAt is not { } end)
            {
                return 0;
            }

            double ms = (end - start).TotalMilliseconds;
            if (!double.IsFinite(ms) || ms <= 0)
            {
                return 0;
            }

            return (int)Math.Round(ms / 60_000.0, MidpointRounding.AwayFromZero);
        }
    }

    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<TimeToChargeSessionRow> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TimeToChargeSessionRow>();
        }

        var list = new List<TimeToChargeSessionRow>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charging-session JSON object into a tolerant row.</summary>
    public static TimeToChargeSessionRow FromJson(JsonElement obj) => new(
        Id: (long)(TimeToChargeJson.GetDouble(obj, "id") ?? 0),
        StartSocPct: TimeToChargeJson.GetDouble(obj, "start_soc_pct"),
        EndSocPct: TimeToChargeJson.GetDouble(obj, "end_soc_pct"),
        StartedAt: TimeToChargeJson.GetDateTime(obj, "started_at"),
        EndedAt: TimeToChargeJson.GetDateTime(obj, "ended_at"),
        TotalEnergyAddedWh: TimeToChargeJson.GetDouble(obj, "total_energy_added_wh") ?? 0,
        ChargerType: TimeToChargeJson.GetString(obj, "charger_type"),
        PeakPowerW: TimeToChargeJson.GetDouble(obj, "peak_power_w"));
}

/// <summary>
/// One projected charge-rate readout — the native analogue of the web <c>{ rate; id }</c> the fastest /
/// slowest reducers produce. <see cref="Rate"/> is kilowatt-hours added per hour (kWh/h). Pure data.
/// </summary>
public sealed record TimeToChargeRate(double Rate, long Id);

/// <summary>
/// The four derived time-to-charge metrics the web <c>useMemo</c> computes from the DC sessions — the two
/// threshold-crossing average durations (minutes) and the fastest / slowest charge rate (kWh/h, each with
/// its session id). A null average means no session crossed that band; a null fastest/slowest means no DC
/// session carried both a positive duration and positive energy. <see cref="DcSessionCount"/> is the number
/// of DC sessions considered (web <c>dcSessions.length</c>). Pure, WinUI-free, unit-tested.
/// </summary>
public sealed record TimeToChargeMetrics(
    double? Avg10To80,
    double? Avg20To80,
    TimeToChargeRate? Fastest,
    TimeToChargeRate? Slowest,
    int DcSessionCount)
{
    /// <summary>The all-null metrics (no DC sessions) — the web <c>empty</c> short-circuit.</summary>
    public static TimeToChargeMetrics Empty { get; } = new(null, null, null, null, 0);

    /// <summary>Watt-hours per kilowatt-hour — the web <c>convertEnergyFromSI(wh, 'kWh')</c> divisor.</summary>
    public const double WhPerKwh = 1000.0;

    /// <summary>Minutes per hour — the web <c>* 60</c> in the kWh/h rate.</summary>
    public const double MinutesPerHour = 60.0;

    /// <summary>The low-SOC band's lower bound (web <c>start_soc_pct &lt;= 10</c>).</summary>
    public const double Band10Floor = 10;

    /// <summary>The mid-SOC band's lower bound (web <c>start_soc_pct &lt;= 20</c>).</summary>
    public const double Band20Floor = 20;

    /// <summary>The shared upper bound (web <c>(end_soc_pct ?? 0) &gt;= 80</c>).</summary>
    public const double BandCeiling = 80;

    /// <summary>
    /// Compute the metrics from the parsed session rows — the native port of the web <c>useMemo</c>. Filters
    /// to DC sessions, averages the threshold-crossing durations, and reduces the per-session kWh/h rates to
    /// the fastest and slowest (ties keep the earlier session, the web reducers' bias). Returns
    /// <see cref="Empty"/> when there are no DC sessions.
    /// </summary>
    public static TimeToChargeMetrics Compute(IReadOnlyList<TimeToChargeSessionRow> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);

        var dc = new List<TimeToChargeSessionRow>(sessions.Count);
        foreach (var s in sessions)
        {
            if (s.IsDc)
            {
                dc.Add(s);
            }
        }

        if (dc.Count == 0)
        {
            return Empty;
        }

        var cross10 = new List<double>();
        var cross20 = new List<double>();
        TimeToChargeRate? fastest = null;
        TimeToChargeRate? slowest = null;

        foreach (var s in dc)
        {
            bool reaches80 = (s.EndSocPct ?? 0) >= BandCeiling;
            if (reaches80 && s.StartSocPct is { } start)
            {
                if (start <= Band10Floor)
                {
                    cross10.Add(s.DurationMinutes);
                }

                if (start <= Band20Floor)
                {
                    cross20.Add(s.DurationMinutes);
                }
            }

            int minutes = s.DurationMinutes;
            if (minutes > 0 && s.TotalEnergyAddedWh > 0)
            {
                double rate = s.TotalEnergyAddedWh / WhPerKwh / minutes * MinutesPerHour;
                if (fastest is null || rate > fastest.Rate)
                {
                    fastest = new TimeToChargeRate(rate, s.Id);
                }

                if (slowest is null || rate < slowest.Rate)
                {
                    slowest = new TimeToChargeRate(rate, s.Id);
                }
            }
        }

        return new TimeToChargeMetrics(
            Avg10To80: cross10.Count > 0 ? Average(cross10) : null,
            Avg20To80: cross20.Count > 0 ? Average(cross20) : null,
            Fastest: fastest,
            Slowest: slowest,
            DcSessionCount: dc.Count);
    }

    private static double Average(List<double> values)
    {
        double sum = 0;
        foreach (double v in values)
        {
            sum += v;
        }

        return sum / values.Count;
    }
}

/// <summary>
/// One projected metric card — the native analogue of the web <c>TimeToChargeCard</c> (label + big value +
/// optional unit suffix + optional subtitle). <see cref="Value"/> is already the em-dash when the metric is
/// null; <see cref="Unit"/> is non-null only when there is a value (web: <c>unit &amp;&amp; value</c>), and
/// <see cref="Subtitle"/> is non-null only when the card carries one. Pure data.
/// </summary>
public sealed record TimeToChargeCardModel(
    string Label,
    string Value,
    string? Unit,
    string? Subtitle,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Time-to-Charge surface — the localized section title and
/// description plus the four metric cards the web component lays out in its 2/4-column grid. <see
/// cref="HasData"/> is the empty gate (true when there is at least one charging session to analyse). Pure
/// data so every branch is asserted headlessly.
/// </summary>
public sealed record TimeToChargeDisplay(
    string Title,
    string Description,
    IReadOnlyList<TimeToChargeCardModel> Cards,
    bool HasData,
    string AutomationName);

/// <summary>
/// Pure projection from the parsed session rows to the render-ready <see cref="TimeToChargeDisplay"/> — the
/// native port of the <c>useMemo</c> + render logic in
/// web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx. Durations format as whole-ish
/// minutes and rates as kWh/h through <see cref="ScalarFormatters.FormatNumber"/> at the web
/// <c>fmtNumber</c> default precision (the global precision is 2), a null metric renders the em-dash (web
/// <c>value ?? '—'</c>), and every label resolves through the i18n facade using the same keys the web source
/// passes to <c>t()</c>. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class TimeToChargeProjection
{
    /// <summary>The em-dash shown for a null metric (web <c>value ?? '—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Fraction digits for the card values (web <c>fmtNumber</c> default <c>_globalPrecision = 2</c>).</summary>
    public const int ValuePrecision = 2;

    /// <summary>The minutes unit suffix shown on the two average-duration cards (web <c>unit="min"</c>).</summary>
    public const string MinutesUnitFallback = "min";

    /// <summary>The kWh/h unit suffix shown on the fastest/slowest cards (web <c>unit="kWh/h"</c>).</summary>
    public const string RateUnitFallback = "kWh/h";

    private const string SessionIdToken = "{{id}}";

    /// <summary>Project <paramref name="sessions"/> into the localized display (four cards + headers).</summary>
    public static TimeToChargeDisplay Project(
        IReadOnlyList<TimeToChargeSessionRow> sessions,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(localizer);

        var metrics = TimeToChargeMetrics.Compute(sessions);

        string title = localizer.GetString("charging.curve.timeToCharge", "Time-to-Charge Analysis");
        string description = localizer.GetString(
            "charging.curve.timeToChargeDesc",
            "How long DC sessions take to reach key SOC thresholds");
        string minutesUnit = localizer.GetString("charging.curve.unitMinutes", MinutesUnitFallback);
        string rateUnit = localizer.GetString("charging.curve.unitKwhPerHour", RateUnitFallback);
        string avgDuration = localizer.GetString("charging.curve.avgDuration", "Avg duration");

        var cards = new List<TimeToChargeCardModel>(4)
        {
            DurationCard(
                localizer.GetString("charging.curve.avg10to80", "10% \u2192 80%"),
                metrics.Avg10To80,
                minutesUnit,
                avgDuration),
            DurationCard(
                localizer.GetString("charging.curve.avg20to80", "20% \u2192 80%"),
                metrics.Avg20To80,
                minutesUnit,
                avgDuration),
            RateCard(
                localizer.GetString("charging.curve.fastest", "Fastest Session"),
                metrics.Fastest,
                rateUnit,
                localizer),
            RateCard(
                localizer.GetString("charging.curve.slowest", "Slowest Session"),
                metrics.Slowest,
                rateUnit,
                localizer),
        };

        return new TimeToChargeDisplay(
            Title: title,
            Description: description,
            Cards: cards,
            HasData: sessions.Count > 0,
            AutomationName: title);
    }

    private static TimeToChargeCardModel DurationCard(string label, double? value, string unit, string subtitle)
    {
        bool present = value is { } v && double.IsFinite(v);
        string text = present ? ScalarFormatters.FormatNumber(value, ValuePrecision) : EmDash;
        string? shownUnit = present ? unit : null;
        return new TimeToChargeCardModel(
            Label: label,
            Value: text,
            Unit: shownUnit,
            Subtitle: subtitle,
            AutomationName: ComposeName(label, text, shownUnit, subtitle));
    }

    private static TimeToChargeCardModel RateCard(string label, TimeToChargeRate? rate, string unit, ILocalizer localizer)
    {
        bool present = rate is not null;
        string text = present ? ScalarFormatters.FormatNumber(rate!.Rate, ValuePrecision) : EmDash;
        string? shownUnit = present ? unit : null;
        string? subtitle = present ? SessionLabel(rate!.Id, localizer) : null;
        return new TimeToChargeCardModel(
            Label: label,
            Value: text,
            Unit: shownUnit,
            Subtitle: subtitle,
            AutomationName: ComposeName(label, text, shownUnit, subtitle));
    }

    private static string SessionLabel(long id, ILocalizer localizer) =>
        localizer
            .GetString("charging.curve.sessionId", "Session #{{id}}")
            .Replace(SessionIdToken, id.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);

    private static string ComposeName(string label, string value, string? unit, string? subtitle)
    {
        string head = string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);

        return string.IsNullOrEmpty(subtitle)
            ? head
            : string.Format(CultureInfo.CurrentCulture, "{0}. {1}", head, subtitle);
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Time-to-Charge surface — every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted session row never aborts the
/// parse (web parity: the React component tolerates undefined via <c>?? 0</c> / optional chaining). WinUI-free
/// so the parse is unit-tested without a UI host.
/// </summary>
internal static class TimeToChargeJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The instant value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            prop.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;TimeToChargeSessionRow&gt;&gt;</c>, preserving every freshness
/// flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TimeToChargeResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<TimeToChargeSessionRow> Parse() =>
            raw.HasValue ? TimeToChargeSessionRow.ParseList(raw.Value) : Array.Empty<TimeToChargeSessionRow>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Time-to-Charge feature surface — the native mirror of the web component at
/// web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx. The surface reads the same
/// charging-sessions list the web Charging-Curve page feeds the section as a prop.
/// </summary>
public static class TimeToChargeRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "time-to-charge-section";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TimeToChargeSection";
}

/// <summary>
/// PII-safe diagnostics for the Time-to-Charge surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session id, rate, duration or charger
/// type — so a diagnostics line can never leak charging data. Thread-safe.
/// </summary>
public sealed class TimeToChargeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TimeToChargeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TimeToChargeSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TimeToChargeRegistration.Slug}");
    }
}
