using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// One charging session row from <c>GET /charging-sessions</c> (web <c>ChargingSession</c> in
/// web/src/api/types.ts), narrowed to the fields the Charging-Curve page reads. Energy and power are SI
/// (watt-hours / watts) exactly as the API stores them; state-of-charge is a dimensionless percentage; every
/// display-side division happens at the render boundary, never here.
/// Parsing is null-tolerant so a partial or schema-drifted row never throws (web parity: the page tolerates
/// undefined fields with <c>?? 0</c>). Pure data — no WinUI types — so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record ChargingCurveSession(
    long Id,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    string? ChargerType,
    double? PeakPowerW,
    double? StartSocPct,
    double? EndSocPct,
    double? TotalEnergyAddedWh,
    double? AvgPowerW,
    double? CostDecimal,
    string? StartPlace)
{
    /// <summary>Project a single charging-session JSON object into a tolerant session record.</summary>
    public static ChargingCurveSession FromJson(JsonElement element)
    {
        return new ChargingCurveSession(
            Id: ChargingCurveJson.Long(element, "id") ?? 0,
            StartedAt: ChargingCurveJson.Instant(element, "started_at"),
            EndedAt: ChargingCurveJson.Instant(element, "ended_at"),
            ChargerType: ChargingCurveJson.String(element, "charger_type"),
            PeakPowerW: ChargingCurveJson.Double(element, "peak_power_w"),
            StartSocPct: ChargingCurveJson.Double(element, "start_soc_pct"),
            EndSocPct: ChargingCurveJson.Double(element, "end_soc_pct"),
            TotalEnergyAddedWh: ChargingCurveJson.Double(element, "total_energy_added_wh"),
            AvgPowerW: ChargingCurveJson.Double(element, "avg_power_w"),
            CostDecimal: ChargingCurveJson.Double(element, "cost_decimal"),
            StartPlace: ChargingCurveJson.String(element, "start_place"));
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Charging-Curve page — every getter returns a
/// nullable rather than throwing so a partial or schema-drifted session row never aborts the parse (web
/// parity: the page tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host.
/// </summary>
internal static class ChargingCurveJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
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

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? Instant(JsonElement obj, string name)
    {
        string? raw = String(obj, name);
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var instant)
            ? instant
            : null;
    }
}

/// <summary>
/// The parsed charging-sessions snapshot the page reads from <c>GET /charging-sessions</c> — the native mirror
/// of the web <c>useChargingSessionsPaginated</c> query result the page reduces and fans out to its sections.
/// <see cref="HasData"/> mirrors the web <c>sessions.length &gt; 0</c> gate (an empty array → the page empty
/// surface). Pure data.
/// </summary>
public sealed record ChargingCurveSnapshot(IReadOnlyList<ChargingCurveSession> Sessions)
{
    /// <summary>The no-sessions snapshot — the parse fallback for an absent / non-array body.</summary>
    public static ChargingCurveSnapshot Empty { get; } = new(Array.Empty<ChargingCurveSession>());

    /// <summary>True when at least one charging session resolved (web <c>sessions.length &gt; 0</c>).</summary>
    public bool HasData => Sessions.Count > 0;

    /// <summary>Project a <c>GET /charging-sessions</c> JSON array into the snapshot (non-array body → empty).</summary>
    public static ChargingCurveSnapshot FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var sessions = new List<ChargingCurveSession>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                sessions.Add(ChargingCurveSession.FromJson(item));
            }
        }

        return sessions.Count == 0 ? Empty : new ChargingCurveSnapshot(sessions);
    }
}

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="ChargingCurvePageViewModel"/> can be in — the native
/// superset of the branches the web <c>ChargingCurvePage</c> renders
/// (web/src/features/charging/pages/ChargingCurvePage.tsx). The web page gates on its single sessions query:
/// <see cref="Loading"/> is the <c>isLoading</c> skeleton branch, <see cref="Empty"/> is the
/// <c>!sessions || sessions.length === 0</c> page-level empty surface, and <see cref="Success"/> is the
/// populated layout. <see cref="Error"/> is the native superset surface for a hard query failure (the web
/// query's error path); every value maps onto a visible surface, never a blank region.
/// </summary>
public enum ChargingCurveState
{
    /// <summary>Initial fetch with no snapshot — render the loading skeleton.</summary>
    Loading,

    /// <summary>The query resolved with no charging sessions — the page-level empty surface.</summary>
    Empty,

    /// <summary>At least one charging session — the populated page layout.</summary>
    Success,

    /// <summary>The query failed with no snapshot — the retriable error surface.</summary>
    Error,
}

/// <summary>
/// One projected, render-ready option for the session selector — the native analogue of a single entry of the
/// web <c>sessionOptions</c> array (<c>{ value: String(s.id), label: sessionLabel(s) }</c>). <see cref="Id"/>
/// is the session id the selection commits and <see cref="Label"/> is the pre-formatted
/// "<c>{date} — {charger} — {energy} kWh</c>" caption. Pure data.
/// </summary>
public sealed record ChargingCurveSessionOption(long Id, string Label);

/// <summary>
/// The render-time input the page projection folds — the parsed snapshot, the user's current session
/// selection, the in-flight flag and any resolved error detail. Pure data so the projection is verified
/// headlessly. Mirrors the inputs the web page's render reads (the query result, <c>selectedSessionId</c>,
/// <c>isLoading</c>).
/// </summary>
public sealed record ChargingCurveModel(
    ChargingCurveSnapshot Snapshot,
    long? SelectedSessionId,
    bool Loading,
    string? ErrorDetail);

/// <summary>
/// The fully projected, render-ready view of the Charging-Curve page for one input model — everything the thin
/// <see cref="ChargingCurvePage"/> view binds to. Holds the active <see cref="State"/> + its boolean show-flags,
/// the localized header copy, the two glass-panel surfaces' copy (the page-level empty panel and the
/// select-a-session hint panel), the session-selector options + prompt, the resolved selected-session summary
/// line, and the render-ready child models the page feeds its presentational sections (the selected session's
/// detail rows + power-vs-SOC curve, and the charger-type grouping over every session). Pure data so every
/// branch is asserted headlessly.
/// </summary>
public sealed record ChargingCurveDisplay(
    ChargingCurveState State,
    bool ShowLoading,
    bool ShowEmpty,
    bool ShowError,
    bool ShowContent,
    string Title,
    string Subtitle,
    string EmptyMessage,
    string EmptyHint,
    string SelectSessionPrompt,
    string SelectSessionHint,
    string ErrorText,
    string RetryLabel,
    IReadOnlyList<ChargingCurveSessionOption> SessionOptions,
    long? SelectedSessionId,
    bool HasSelectedSession,
    string? SelectedSummaryLine,
    SessionDetailModel SelectedDetailModel,
    SessionCurveChartModel SelectedCurveModel,
    ChargerTypeChartModel ChargerModel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ChargingCurveModel"/> to its <see cref="ChargingCurveDisplay"/> — the
/// native port of the render logic in web/src/features/charging/pages/ChargingCurvePage.tsx and the
/// <c>sessionLabel</c> / <c>generateChargingCurve</c> / <c>getChargerLabel</c> / <c>durationMinutes</c> helpers
/// it calls (web/src/features/charging/components/charging-curve/helpers.ts). The branch precedence mirrors the
/// web source's data lifecycle (loading → empty → success, with a hard-failure error superset); the selected
/// session feeds the presentational <see cref="SessionDetailModel"/> + <see cref="SessionCurveChartModel"/>
/// and every session feeds the <see cref="ChargerTypeChartModel"/>, exactly as the web page hands its query
/// result down to the child components. Every label resolves through the i18n facade using the same keys the
/// web source feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ChargingCurveProjection
{
    /// <summary>The web default decimal precision for the energy readout in the selector caption.</summary>
    public const int EnergyPrecision = 1;

    private const double KiloDivisor = 1000.0;

    // web generateChargingCurve(): the simulated peak when peak_power_w is absent (11 kW), and the DC threshold.
    private const double DefaultPeakPowerW = 11_000;
    private const double DcPowerThresholdW = 20_000;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and clock.</summary>
    /// <param name="model">The render-time input (snapshot + selection + flags).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock used for the selected-session timestamp line (deterministic in tests).</param>
    public static ChargingCurveDisplay Project(ChargingCurveModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("charging.curve.title", "Charging Curve");
        string subtitle = localizer.GetString("charging.curve.subtitle", "Power vs state-of-charge across sessions");
        string emptyMessage = localizer.GetString("charging.curve.empty", "No charging sessions to plot a curve.");
        string emptyHint = localizer.GetString(
            "charging.curve.emptyHint",
            "Start a charging session and data will appear here.");
        string selectPrompt = localizer.GetString("charging.curve.selectSession", "Select a session to inspect");
        string selectHint = localizer.GetString(
            "charging.curve.selectSessionHint",
            "Select a session above to view its charging curve");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string errorText = ResolveError(model, localizer);

        ChargingCurveState state = SelectState(model);

        ChargingCurveSession? selected = FindSelected(model);
        IReadOnlyList<ChargingCurveSessionOption> options = BuildOptions(model.Snapshot.Sessions, localizer, now);

        return new ChargingCurveDisplay(
            State: state,
            ShowLoading: state == ChargingCurveState.Loading,
            ShowEmpty: state == ChargingCurveState.Empty,
            ShowError: state == ChargingCurveState.Error,
            ShowContent: state == ChargingCurveState.Success,
            Title: title,
            Subtitle: subtitle,
            EmptyMessage: emptyMessage,
            EmptyHint: emptyHint,
            SelectSessionPrompt: selectPrompt,
            SelectSessionHint: selectHint,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            SessionOptions: options,
            SelectedSessionId: selected?.Id,
            HasSelectedSession: selected is not null,
            SelectedSummaryLine: BuildSummaryLine(selected, now),
            SelectedDetailModel: BuildDetailModel(selected),
            SelectedCurveModel: BuildCurveModel(selected),
            ChargerModel: BuildChargerModel(model.Snapshot.Sessions),
            AutomationName: BuildAutomationName(state, title, subtitle, emptyMessage, errorText));
    }

    /// <summary>
    /// The web <c>sessionLabel</c> helper: "<c>{formatDateShort(started_at)} — {chargerLabel} — {energy} kWh</c>",
    /// where energy is <c>total_energy_added_wh / 1000</c> at one decimal or "?" when absent.
    /// </summary>
    public static string SessionLabel(ChargingCurveSession session, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(localizer);

        string date = DateTimeFormatting.Format(session.StartedAt, DateTimeVariant.Date, now);
        string charger = ChargerLabel(session.ChargerType, session.PeakPowerW, localizer);
        string energy = session.TotalEnergyAddedWh is { } wh
            ? NumberFormatting.Format(wh / KiloDivisor, null, EnergyPrecision)
            : "?";
        return string.Format(CultureInfo.CurrentCulture, "{0} \u2014 {1} \u2014 {2} kWh", date, charger, energy);
    }

    /// <summary>
    /// The web <c>getChargerLabel</c> helper, verbatim: a Tesla / "tesla"-containing charger is a Supercharger;
    /// any other named charger or a peak above 20 kW is DC Fast; everything else is Home / AC. Routed through
    /// the i18n facade with the web's literal English fallback so the rendered value matches the web.
    /// </summary>
    public static string ChargerLabel(string? chargerType, double? peakPowerW, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        bool isTesla = string.Equals(chargerType, "Tesla", StringComparison.Ordinal)
            || (chargerType ?? string.Empty).Contains("tesla", StringComparison.OrdinalIgnoreCase);
        if (isTesla)
        {
            return localizer.GetString("charging.curve.charger.supercharger", "Supercharger");
        }

        if (!string.IsNullOrEmpty(chargerType))
        {
            return localizer.GetString("charging.curve.charger.dcFast", "DC Fast");
        }

        if (peakPowerW is { } peak && peak > DcPowerThresholdW)
        {
            return localizer.GetString("charging.curve.charger.dcFast", "DC Fast");
        }

        return localizer.GetString("charging.curve.charger.acHome", "Home / AC");
    }

    /// <summary>
    /// The web <c>generateChargingCurve</c> helper, verbatim: a simulated power-vs-SOC curve sampled at each
    /// whole percentage from the start to the end state-of-charge, tapering above 50 % / 80 % for DC sessions
    /// and flat for AC sessions, with power clamped at zero. Power is kilowatts (the SI watt peak ÷ 1000).
    /// </summary>
    public static IReadOnlyList<CurvePoint> GenerateChargingCurve(ChargingCurveSession session)
    {
        ArgumentNullException.ThrowIfNull(session);

        double startSoc = session.StartSocPct ?? 0;
        double endSoc = session.EndSocPct ?? 100;
        double peakPower = (session.PeakPowerW ?? DefaultPeakPowerW) / KiloDivisor;
        bool dc = IsDcSession(session);

        var points = new List<CurvePoint>();
        for (double soc = startSoc; soc <= endSoc; soc += 1)
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
                    double taper = 1 - (((soc - 50) / 30) * 0.5);
                    power = peakPower * taper;
                }
                else
                {
                    double drop = 1 - (((soc - 80) / 20) * 0.7);
                    power = peakPower * 0.5 * drop;
                }
            }
            else
            {
                power = peakPower;
            }

            points.Add(new CurvePoint(soc, Math.Max(power, 0)));
        }

        return points;
    }

    /// <summary>The web <c>isDcSession</c> helper: a named charger or a peak above 20 kW marks a DC session.</summary>
    public static bool IsDcSession(ChargingCurveSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return !string.IsNullOrEmpty(session.ChargerType)
            || (session.PeakPowerW is { } peak && peak > DcPowerThresholdW);
    }

    private static ChargingCurveState SelectState(ChargingCurveModel model)
    {
        if (model.ErrorDetail is not null)
        {
            return ChargingCurveState.Error;
        }

        if (model.Loading)
        {
            return ChargingCurveState.Loading;
        }

        return model.Snapshot.HasData ? ChargingCurveState.Success : ChargingCurveState.Empty;
    }

    private static ChargingCurveSession? FindSelected(ChargingCurveModel model)
    {
        if (model.SelectedSessionId is not { } id)
        {
            return null;
        }

        foreach (var session in model.Snapshot.Sessions)
        {
            if (session.Id == id)
            {
                return session;
            }
        }

        return null;
    }

    private static IReadOnlyList<ChargingCurveSessionOption> BuildOptions(
        IReadOnlyList<ChargingCurveSession> sessions,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (sessions.Count == 0)
        {
            return Array.Empty<ChargingCurveSessionOption>();
        }

        var options = new List<ChargingCurveSessionOption>(sessions.Count);
        foreach (var session in sessions)
        {
            options.Add(new ChargingCurveSessionOption(session.Id, SessionLabel(session, localizer, now)));
        }

        return options;
    }

    // web: <TimeStamp value={selectedSession.started_at} /> plus an optional " · {start_place}" suffix.
    private static string? BuildSummaryLine(ChargingCurveSession? session, DateTimeOffset now)
    {
        if (session is null)
        {
            return null;
        }

        string timestamp = DateTimeFormatting.Format(session.StartedAt, DateTimeVariant.Full, now);
        return string.IsNullOrEmpty(session.StartPlace)
            ? timestamp
            : string.Format(CultureInfo.CurrentCulture, "{0} \u00b7 {1}", timestamp, session.StartPlace);
    }

    private static SessionDetailModel BuildDetailModel(ChargingCurveSession? session)
    {
        if (session is null)
        {
            return SessionDetailModel.None;
        }

        return SessionDetailModel.ForSession(
            startedAt: session.StartedAt,
            endedAt: session.EndedAt,
            chargerType: session.ChargerType,
            peakPowerW: session.PeakPowerW,
            startSocPct: session.StartSocPct ?? 0,
            endSocPct: session.EndSocPct,
            totalEnergyAddedWh: session.TotalEnergyAddedWh ?? 0,
            avgPowerW: session.AvgPowerW,
            costDecimal: session.CostDecimal,
            startPlace: session.StartPlace);
    }

    private static SessionCurveChartModel BuildCurveModel(ChargingCurveSession? session)
    {
        if (session is null)
        {
            return SessionCurveChartModel.Empty;
        }

        IReadOnlyList<CurvePoint> curve = GenerateChargingCurve(session);
        return curve.Count == 0 ? SessionCurveChartModel.Empty : SessionCurveChartModel.Loaded(curve);
    }

    private static ChargerTypeChartModel BuildChargerModel(IReadOnlyList<ChargingCurveSession> sessions)
    {
        if (sessions.Count == 0)
        {
            return ChargerTypeChartModel.Empty;
        }

        var rows = new List<ChargerTypeChartSession>(sessions.Count);
        foreach (var session in sessions)
        {
            rows.Add(new ChargerTypeChartSession(
                ChargerType: session.ChargerType,
                PeakPowerW: session.PeakPowerW,
                TotalEnergyAddedWh: session.TotalEnergyAddedWh ?? 0,
                StartedAt: session.StartedAt ?? default,
                EndedAt: session.EndedAt));
        }

        return new ChargerTypeChartModel(false, rows);
    }

    private static string ResolveError(ChargingCurveModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString("charging.curve.error", "Couldn't load charging sessions");
    }

    private static string BuildAutomationName(
        ChargingCurveState state,
        string title,
        string subtitle,
        string emptyMessage,
        string errorText) => state switch
        {
            ChargingCurveState.Loading => string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, subtitle),
            ChargingCurveState.Empty => string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, emptyMessage),
            ChargingCurveState.Error => string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, errorText),
            _ => string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, subtitle),
        };
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Charging-Curve page — the native mirror of the web page
/// at web/src/features/charging/pages/ChargingCurvePage.tsx (route <c>/charging-curve</c>, nav name
/// <c>ChargingCurve</c>). The page reads the same charging-sessions list the web
/// <c>useChargingSessionsPaginated</c> hook reads (generated operation <c>get_api_v1_charging_sessions</c>).
/// </summary>
public static class ChargingCurveRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "ChargingCurve";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingCurvePage";

    /// <summary>The generated charging-sessions operation the page's client feed reads.</summary>
    public const string Operation = Operations.Charging.Sessions;

    /// <summary>The empty-surface glyph (Segoe Fluent — battery / charging).</summary>
    public const string EmptyGlyph = "\uE945";

    /// <summary>The localized page title (web <c>t('charging.curve.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.curve.title", "Charging Curve");
    }
}

/// <summary>
/// PII-safe diagnostics for the Charging-Curve page (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an energy figure, cost, location or
/// session count — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ChargingCurveDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingCurveDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingCurvePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingCurveRegistration.Slug}");
    }
}
