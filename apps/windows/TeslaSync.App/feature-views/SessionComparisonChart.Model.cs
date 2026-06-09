using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="SessionComparisonViewModel"/> can be in — the
/// native union of the branches the web Session-Comparison chart renders
/// (web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx). The web component is a
/// pure child of the charging-curve page (it takes <c>sessions: ChargingSession[]</c>); the native surface
/// binds its own cache-then-network read of the charging-sessions list, so it owns the full loading / loaded
/// / empty / error / stale / offline matrix the P2 state contract requires. Every value maps onto a visible
/// surface (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render
/// the overlaid power-curve chart (with the stale / offline chip for the latter two), <see cref="Empty"/>
/// renders the friendly empty state (web parity: the curve has no sessions to plot), <see cref="Loading"/>
/// shows the skeleton chrome and <see cref="Error"/> the retry surface.
/// </summary>
public enum SessionComparisonState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one charging session to plot.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no plottable session curve.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the chart plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the chart plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The charger-class bucket a session falls into — the native port of the web <c>getChargerLabel</c> /
/// <c>isDcSession</c> heuristics
/// (web/src/features/charging/components/charging-curve/helpers.ts). It drives both the curve shape (DC
/// sessions taper, AC sessions are flat) and the per-session legend / tooltip label.
/// </summary>
public enum SessionChargerKind
{
    /// <summary>Tesla Supercharger (web <c>charger_type</c> contains "tesla").</summary>
    Supercharger,

    /// <summary>Other DC fast charging (a non-empty charger type, or a peak above 20 kW).</summary>
    DcFast,

    /// <summary>Home / AC charging (the default).</summary>
    HomeAc,
}

/// <summary>
/// One point on a simulated power-vs-SOC charging curve — the native mirror of the web <c>CurvePoint</c>
/// (<c>{ soc: number; power: number }</c>). <see cref="Soc"/> is the state-of-charge percentage and
/// <see cref="PowerKw"/> the modelled charging power in kilowatts (rounded to one decimal, web parity).
/// </summary>
public readonly record struct SessionCurvePoint(int Soc, double PowerKw);

/// <summary>
/// One parsed charging session, reduced to just the fields the comparison curve needs — the native mirror of
/// the web <c>ChargingSession</c> subset <c>SessionComparisonChart</c> reads (id, start/end SOC, peak power,
/// charger type, started_at). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant
/// so a partial row never throws. WinUI-free so the parse is unit-tested without a UI host.
/// </summary>
public sealed record SessionComparisonSession(
    long Id,
    double? StartSocPct,
    double? EndSocPct,
    double? PeakPowerW,
    string? ChargerType,
    DateTimeOffset? StartedAt)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<SessionComparisonSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SessionComparisonSession>();
        }

        var list = new List<SessionComparisonSession>(element.GetArrayLength());
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
    public static SessionComparisonSession FromJson(JsonElement obj) => new(
        GetLong(obj, "id") ?? 0,
        GetDouble(obj, "start_soc_pct"),
        GetDouble(obj, "end_soc_pct"),
        GetDouble(obj, "peak_power_w"),
        GetString(obj, "charger_type"),
        GetDateTime(obj, "started_at"));

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One projected, render-ready overlay curve — a single session's simulated power-vs-SOC line plus the
/// metadata the chart and the custom date-chip legend need (the web <c>&lt;Line&gt;</c> name + the legend's
/// date label + the palette colour index). Pure data so the projection is asserted headlessly.
/// </summary>
public sealed record SessionComparisonSeries(
    long Id,
    string Name,
    string DateLabel,
    string ChargerLabel,
    int ColorIndex,
    IReadOnlyList<SessionCurvePoint> Points)
{
    /// <summary>Project this overlay into a <see cref="ChartSeries"/> the cartesian chart renders.</summary>
    public ChartSeries ToChartSeries(string unit)
    {
        var points = new List<ChartPoint>(Points.Count);
        foreach (var p in Points)
        {
            points.Add(new ChartPoint(p.Soc, p.PowerKw));
        }

        return new ChartSeries(Name, points)
        {
            Kind = ChartSeriesKind.Line,
            ColorIndex = ColorIndex,
            Unit = unit,
            Decimals = 1,
        };
    }
}

/// <summary>
/// The fully projected, render-ready view of the Session-Comparison surface — the overlaid curves, the
/// localized container title / subtitle / accessible summary, the two axis labels, the per-session power
/// unit and the empty-state message. <see cref="HasData"/> drives the content-vs-empty branch (web parity:
/// the curve renders when there is at least one plottable session). Pure data so every branch is asserted
/// without a UI host.
/// </summary>
public sealed record SessionComparisonDisplay(
    IReadOnlyList<SessionComparisonSeries> Series,
    bool HasData,
    string Title,
    string Subtitle,
    string AriaLabel,
    string SocAxisLabel,
    string PowerAxisLabel,
    string PowerUnit,
    string EmptyMessage,
    string AutomationName)
{
    /// <summary>The render-ready chart series (one line per session), in overlay order.</summary>
    public IReadOnlyList<ChartSeries> ToChartSeries()
    {
        var list = new List<ChartSeries>(Series.Count);
        foreach (var s in Series)
        {
            list.Add(s.ToChartSeries(PowerUnit));
        }

        return list;
    }

    /// <summary>An all-empty display (the friendly empty state) for the loading / empty fallback.</summary>
    public static SessionComparisonDisplay Empty(ILocalizer localizer) =>
        SessionComparisonProjection.Project(Array.Empty<SessionComparisonSession>(), localizer, default);
}

/// <summary>
/// Pure projection from parsed <see cref="SessionComparisonSession"/> rows to a
/// <see cref="SessionComparisonDisplay"/> — the native port of the <c>useMemo</c> + render logic in
/// web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx (plus the
/// <c>generateChargingCurve</c> / <c>getChargerLabel</c> helpers). It takes the first
/// <see cref="WindowLimit"/> sessions (web <c>sessions.slice(0, 10)</c>), simulates each curve, names each
/// overlay <c>"{date} ({chargerLabel})"</c> (the web <c>&lt;Line&gt;</c> name) and assigns the cycling
/// palette index (web <c>palette[i % palette.length]</c>). Every label resolves through the i18n facade.
/// WinUI-free — unit-tested without a UI host.
/// </summary>
public static class SessionComparisonProjection
{
    /// <summary>The most-recent sessions overlaid on the chart (web <c>sessions.slice(0, 10)</c>).</summary>
    public const int WindowLimit = 10;

    /// <summary>Default modelled peak power in watts when a session reports none (web <c>?? 11_000</c>).</summary>
    public const double DefaultPeakPowerW = 11_000;

    /// <summary>The DC-fast threshold in watts (web <c>peak_power_w &gt; 20_000</c>).</summary>
    public const double DcThresholdW = 20_000;

    /// <summary>The unit suffix the per-session power values carry (web <c>unit=" kW"</c>).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Project <paramref name="sessions"/> using the localizer for every label.</summary>
    /// <param name="sessions">The charging sessions (the backend orders <c>started_at DESC</c>, newest first).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The reference instant for date formatting (Short ignores it; threaded for consistency).</param>
    public static SessionComparisonDisplay Project(
        IReadOnlyList<SessionComparisonSession> sessions,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(localizer);

        int take = Math.Min(sessions.Count, WindowLimit);
        var series = new List<SessionComparisonSeries>(take);
        for (int i = 0; i < take; i++)
        {
            var session = sessions[i];
            var kind = ClassifyCharger(session);
            string chargerLabel = localizer.GetString(ChargerLabelKey(kind), ChargerLabelFallback(kind));
            string dateLabel = session.StartedAt is { } ts
                ? DateTimeFormatting.Format(ts, DateTimeVariant.Short, now)
                : string.Create(CultureInfo.InvariantCulture, $"#{i + 1}");

            series.Add(new SessionComparisonSeries(
                Id: session.Id,
                Name: string.Format(CultureInfo.CurrentCulture, "{0} ({1})", dateLabel, chargerLabel),
                DateLabel: dateLabel,
                ChargerLabel: chargerLabel,
                ColorIndex: i,
                Points: GenerateCurve(session)));
        }

        // Web parity: the chart renders whenever comparisonData has points — i.e. at least one session has a
        // plottable (start_soc <= end_soc) curve.
        bool hasData = false;
        foreach (var s in series)
        {
            if (s.Points.Count > 0)
            {
                hasData = true;
                break;
            }
        }

        string title = localizer.GetString("charging.curve.sessionComparison", "Session Comparison");
        string subtitle = localizer.GetString(
            "charging.curve.sessionComparisonDesc", "Power curves overlaid from last 10 sessions");
        string aria = localizer.GetString(
            "charging.curve.sessionComparison.aria",
            "Overlaid power-vs-SOC line chart comparing the last several charging sessions");
        string socAxis = localizer.GetString("charging.curve.socPercent", "SOC (%)");
        string powerAxis = localizer.GetString("charging.curve.powerKw", "Power (kW)");
        string empty = localizer.GetString("charging.curve.empty", "No charging sessions to plot a curve.");

        return new SessionComparisonDisplay(
            Series: series,
            HasData: hasData,
            Title: title,
            Subtitle: subtitle,
            AriaLabel: aria,
            SocAxisLabel: socAxis,
            PowerAxisLabel: powerAxis,
            PowerUnit: PowerUnit,
            EmptyMessage: empty,
            AutomationName: aria);
    }

    /// <summary>
    /// Classify a session into a charger bucket — the native port of <c>getChargerLabel</c>: a Tesla /
    /// Supercharger label wins, then any non-empty charger type is DC fast, then a peak above the DC
    /// threshold is DC fast, otherwise home / AC.
    /// </summary>
    public static SessionChargerKind ClassifyCharger(SessionComparisonSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        string? ct = session.ChargerType;
        if (!string.IsNullOrEmpty(ct))
        {
            if (ct.Equals("Tesla", StringComparison.OrdinalIgnoreCase) ||
                ct.Contains("tesla", StringComparison.OrdinalIgnoreCase))
            {
                return SessionChargerKind.Supercharger;
            }

            return SessionChargerKind.DcFast;
        }

        return session.PeakPowerW is { } pw && pw > DcThresholdW
            ? SessionChargerKind.DcFast
            : SessionChargerKind.HomeAc;
    }

    /// <summary>Whether a session charges on DC (web <c>isDcSession</c>): a charger type, or a peak above 20 kW.</summary>
    public static bool IsDcSession(SessionComparisonSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return !string.IsNullOrEmpty(session.ChargerType) ||
            (session.PeakPowerW is { } pw && pw > DcThresholdW);
    }

    /// <summary>The i18n key for a charger-bucket label.</summary>
    public static string ChargerLabelKey(SessionChargerKind kind) => kind switch
    {
        SessionChargerKind.Supercharger => "charging.curve.charger.supercharger",
        SessionChargerKind.DcFast => "charging.curve.charger.dcFast",
        _ => "charging.curve.charger.homeAc",
    };

    /// <summary>The English fallback for a charger-bucket label (web <c>getChargerLabel</c> literals).</summary>
    public static string ChargerLabelFallback(SessionChargerKind kind) => kind switch
    {
        SessionChargerKind.Supercharger => "Supercharger",
        SessionChargerKind.DcFast => "DC Fast",
        _ => "Home / AC",
    };

    /// <summary>
    /// Simulate a power-vs-SOC curve from session metadata — the native port of <c>generateChargingCurve</c>.
    /// DC sessions hold peak to 50%, taper to 80% then drop to the end; AC sessions are flat at peak. SOC is
    /// clamped to a sane 0..100 domain so malformed data can never produce a pathological loop. Power is
    /// rounded to one decimal (web <c>Math.round(power * 10) / 10</c>).
    /// </summary>
    public static IReadOnlyList<SessionCurvePoint> GenerateCurve(SessionComparisonSession session)
    {
        ArgumentNullException.ThrowIfNull(session);

        int startSoc = (int)Math.Round(Math.Clamp(session.StartSocPct ?? 0, 0, 100));
        int endSoc = (int)Math.Round(Math.Clamp(session.EndSocPct ?? 100, 0, 100));
        double peakPower = (session.PeakPowerW ?? DefaultPeakPowerW) / 1000.0;
        bool dc = IsDcSession(session);

        var points = new List<SessionCurvePoint>(Math.Max(0, endSoc - startSoc + 1));
        for (int soc = startSoc; soc <= endSoc; soc++)
        {
            double power;
            if (dc)
            {
                if (soc <= 50)
                {
                    power = peakPower;
                }
                else if (soc <= 80)
                {
                    double taper = 1 - ((soc - 50) / 30.0 * 0.5);
                    power = peakPower * taper;
                }
                else
                {
                    double drop = 1 - ((soc - 80) / 20.0 * 0.7);
                    power = peakPower * 0.5 * drop;
                }
            }
            else
            {
                power = peakPower;
            }

            double rounded = Math.Round(Math.Max(power, 0), 1, MidpointRounding.AwayFromZero);
            points.Add(new SessionCurvePoint(soc, rounded));
        }

        return points;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SessionComparisonSession&gt;&gt;</c>, preserving every freshness
/// flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SessionComparisonResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SessionComparisonSession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SessionComparisonSession> Parse() =>
            raw.HasValue ? SessionComparisonSession.ParseList(raw.Value) : Array.Empty<SessionComparisonSession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SessionComparisonSession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Session-Comparison feature surface — the native mirror of the web component at
/// web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx. The surface reads the same
/// charging-sessions list the web charging-curve page feeds the comparison chart.
/// </summary>
public static class SessionComparisonRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "session-comparison-chart";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SessionComparisonChart";

    /// <summary>The most-recent sessions the surface overlays (web <c>sessions.slice(0, 10)</c>).</summary>
    public const int WindowLimit = SessionComparisonProjection.WindowLimit;

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.curve.sessionComparison", "Session Comparison");
    }
}

/// <summary>
/// PII-safe diagnostics for the Session-Comparison surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session id, charger type, date or
/// power value — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SessionComparisonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SessionComparisonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SessionComparisonChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SessionComparisonRegistration.Slug}");
    }
}
