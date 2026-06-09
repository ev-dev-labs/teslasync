using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>SessionDetailPanel</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx). The web source is a pure
/// presentational panel (it takes a <c>session: ChargingSession</c> prop and performs no fetching), so the
/// branches are a direct function of the input <see cref="SessionDetailModel"/> — there is no fetch-driven
/// error / stale / offline branch to reproduce here. The parent Charging-Curve experience owns the query
/// lifecycle (loading / empty / error / stale / offline are handled once for the whole page before the panel
/// is mounted), exactly as the web <c>ChargingCurvePage</c> only renders <c>&lt;SessionDetailPanel&gt;</c>
/// once a session has been selected from a resolved list. Every branch maps onto a visible surface; none is
/// ever hidden.
/// </summary>
public enum SessionDetailState
{
    /// <summary>The session has not arrived yet (the parent is still fetching) — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no session selected — a friendly "select a session" surface.</summary>
    Empty,

    /// <summary>A session to detail (web fall-through) — the "Session Details" label/value rows.</summary>
    Ready,
}

/// <summary>
/// The render-time data model the <c>SessionDetailPanel</c> view binds to — the native analogue of the web
/// component's <c>session: ChargingSession</c> prop, narrowed to the fields the panel actually reads
/// (<c>started_at</c>, <c>ended_at</c>, <c>charger_type</c>, <c>peak_power_w</c>, <c>start_soc_pct</c>,
/// <c>end_soc_pct</c>, <c>total_energy_added_wh</c>, <c>avg_power_w</c>, <c>cost_decimal</c>,
/// <c>start_place</c>) plus the fetch flag the parent supplies. The component is presentational; user-facing
/// labels are resolved from the i18n facade by the projection, not passed in. Energy and power are SI on disk
/// (watt-hours / watts) — the projection performs the same fixed Wh→kWh / W→kW display scaling the web does
/// (÷1000); state-of-charge is a dimensionless percentage. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record SessionDetailModel(
    bool Loading,
    bool HasSession,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    string? ChargerType,
    double? PeakPowerW,
    double StartSocPct,
    double? EndSocPct,
    double TotalEnergyAddedWh,
    double? AvgPowerW,
    double? CostDecimal,
    string? StartPlace)
{
    /// <summary>The initial model: the session fetch is in flight and nothing has arrived yet.</summary>
    public static SessionDetailModel Pending { get; } =
        new(true, false, null, null, null, null, 0, null, 0, null, null, null);

    /// <summary>A resolved model with no session selected — the empty surface.</summary>
    public static SessionDetailModel None { get; } =
        new(false, false, null, null, null, null, 0, null, 0, null, null, null);

    /// <summary>
    /// Build a resolved, session-bound model from the narrowed charging-session fields the panel reads.
    /// </summary>
    public static SessionDetailModel ForSession(
        DateTimeOffset? startedAt,
        DateTimeOffset? endedAt,
        string? chargerType,
        double? peakPowerW,
        double startSocPct,
        double? endSocPct,
        double totalEnergyAddedWh,
        double? avgPowerW,
        double? costDecimal,
        string? startPlace) =>
        new(
            Loading: false,
            HasSession: true,
            StartedAt: startedAt,
            EndedAt: endedAt,
            ChargerType: chargerType,
            PeakPowerW: peakPowerW,
            StartSocPct: startSocPct,
            EndSocPct: endSocPct,
            TotalEnergyAddedWh: totalEnergyAddedWh,
            AvgPowerW: avgPowerW,
            CostDecimal: costDecimal,
            StartPlace: startPlace);
}

/// <summary>
/// One projected, render-ready detail row — the native analogue of a single web <c>SessionDetailRow</c>
/// (label on the left, value on the right). <see cref="Label"/> is the localized row label;
/// <see cref="Value"/> is the formatted, display-ready value; <see cref="AutomationName"/> is the spoken
/// "<c>{label} {value}</c>" Narrator string. Pure data.
/// </summary>
public sealed record SessionDetailRow(string Label, string Value, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of what the
/// web <c>SessionDetailPanel</c> renders. Holds the active <see cref="State"/>, the localized
/// <see cref="Title"/> ("Session Details"), the ordered <see cref="Rows"/> (only the rows the web source
/// actually renders for this session, with its optional rows respected), the empty + loading copy, and the
/// surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record SessionDetailDisplay(
    SessionDetailState State,
    string Title,
    IReadOnlyList<SessionDetailRow> Rows,
    string EmptyMessage,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SessionDetailModel"/> to its <see cref="SessionDetailDisplay"/> — the
/// native port of web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx (and the
/// <c>getChargerLabel</c> / <c>durationMinutes</c> helpers it calls). The branch precedence mirrors the web
/// source's data lifecycle (loading → empty → ready); the row set and ordering reproduce the web panel
/// exactly — Date, Charger Type, SOC Range, Energy Added, Peak Power, then Avg Power (only when
/// <c>avg_power_w</c> is present), Duration, then Cost (only when <c>cost_decimal</c> is present) and Location
/// (only when <c>start_place</c> is non-empty). Numbers round half-away-from-zero with en-US grouping at the
/// web's default precision via <see cref="NumberFormatting"/> / <see cref="ScalarFormatters"/>; the timestamp
/// uses the shared <see cref="DateTimeFormatting"/> full variant; the SoC range uses raw number-to-string to
/// match the web template literal. Every label resolves through the i18n facade using the same keys the web
/// source feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SessionDetailProjection
{
    /// <summary>
    /// Fixed fraction digits for the kWh / kW / minute readouts and the currency value — the web's default
    /// <c>decimal_precision</c> (2), applied at the display boundary just as <c>fmtWithUnit</c> /
    /// <c>formatCurrency</c> do.
    /// </summary>
    public const int Precision = 2;

    // Wh→kWh and W→kW: the same fixed ÷1000 display scaling the web applies inline. SI stays on the model.
    private const double KiloDivisor = 1000.0;

    // The web SoC template literal: `${start}% → ${end ?? '?'}%`. The arrow keeps its surrounding spaces.
    private const string SocArrow = " \u2192 ";

    // Sentinel the web uses for a missing end-of-charge SoC (`end_soc_pct ?? '?'`).
    private const string MissingSoc = "?";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop, narrowed to the rendered fields).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The active currency symbol for the cost row (defaults to "$").</param>
    public static SessionDetailDisplay Project(
        SessionDetailModel model,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? SessionDetailRegistration.DefaultCurrencySymbol
            : currencySymbol;

        string title = localizer.GetString("charging.curve.sessionDetails", "Session Details");
        string emptyMessage = localizer.GetString("charging.curve.selectSession", "Select a session to inspect");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        SessionDetailState state = SelectState(model);
        IReadOnlyList<SessionDetailRow> rows = Array.Empty<SessionDetailRow>();
        if (state == SessionDetailState.Ready)
        {
            rows = BuildRows(model, localizer, symbol);
        }

        return new SessionDetailDisplay(
            State: state,
            Title: title,
            Rows: rows,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: BuildAutomationName(state, title, rows, emptyMessage, loadingLabel));
    }

    /// <summary>
    /// The web <c>getChargerLabel</c> helper, verbatim: a Tesla / "tesla"-containing charger is a
    /// Supercharger; any other named charger or a peak above 20 kW is DC Fast; everything else is Home / AC.
    /// Routed through the i18n facade with the web's literal English as the fallback, so the rendered value is
    /// byte-identical to the web while still flowing through a localizable seam.
    /// </summary>
    internal static string ChargerLabel(SessionDetailModel model, ILocalizer localizer)
    {
        string? chargerType = model.ChargerType;

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

        if (model.PeakPowerW is { } peak && peak > 20_000)
        {
            return localizer.GetString("charging.curve.charger.dcFast", "DC Fast");
        }

        return localizer.GetString("charging.curve.charger.acHome", "Home / AC");
    }

    /// <summary>
    /// The web <c>durationMinutes</c> helper, verbatim: 0 when there is no end timestamp or the interval is
    /// non-positive / non-finite, otherwise the whole-minute interval rounded half-away-from-zero (the web's
    /// <c>Math.round</c> over a non-negative span).
    /// </summary>
    internal static double DurationMinutes(DateTimeOffset? startedAt, DateTimeOffset? endedAt)
    {
        if (startedAt is not { } start || endedAt is not { } end)
        {
            return 0;
        }

        double ms = (end - start).TotalMilliseconds;
        if (!double.IsFinite(ms) || ms <= 0)
        {
            return 0;
        }

        return Math.Round(ms / 60_000.0, MidpointRounding.AwayFromZero);
    }

    /// <summary>Branch precedence from the web source's data lifecycle: loading → empty → ready.</summary>
    private static SessionDetailState SelectState(SessionDetailModel model)
    {
        if (model.Loading)
        {
            return SessionDetailState.Loading;
        }

        return model.HasSession ? SessionDetailState.Ready : SessionDetailState.Empty;
    }

    private static List<SessionDetailRow> BuildRows(
        SessionDetailModel model,
        ILocalizer localizer,
        string symbol)
    {
        var rows = new List<SessionDetailRow>(9)
        {
            Row(localizer, "charging.curve.date", "Date", FormatDate(model.StartedAt)),
            Row(localizer, "charging.curve.chargerType", "Charger Type", ChargerLabel(model, localizer)),
            Row(localizer, "charging.curve.socRange", "SOC Range", FormatSocRange(model)),
            Row(localizer, "charging.curve.energyAdded", "Energy Added", FormatKilo(model.TotalEnergyAddedWh, "kWh")),
            Row(localizer, "charging.curve.peakPower", "Peak Power", FormatKilo(model.PeakPowerW ?? 0, "kW")),
        };

        // Web: rendered only when avg_power_w != null.
        if (model.AvgPowerW is { } avgPower)
        {
            rows.Add(Row(localizer, "charging.curve.avgPower", "Avg Power", FormatKilo(avgPower, "kW")));
        }

        rows.Add(Row(localizer, "charging.curve.duration", "Duration", FormatDuration(model.StartedAt, model.EndedAt)));

        // Web: rendered only when cost_decimal != null. The web key is literally `charging.curve.cost_decimal`
        // (the field name leaked into the key); it is absent from the web i18n catalog, so the web falls back
        // to "Cost" — reproduced here with the same key + fallback for byte-identical behaviour.
        if (model.CostDecimal is { } cost)
        {
            rows.Add(Row(
                localizer,
                "charging.curve.cost_decimal",
                "Cost",
                ScalarFormatters.FormatCurrency(cost, symbol, Precision)));
        }

        // Web: rendered only when start_place is truthy. The place is user data, shown verbatim.
        if (!string.IsNullOrEmpty(model.StartPlace))
        {
            rows.Add(Row(localizer, "charging.curve.location", "Location", model.StartPlace));
        }

        return rows;
    }

    private static SessionDetailRow Row(ILocalizer localizer, string key, string fallback, string value)
    {
        string label = localizer.GetString(key, fallback);
        return new SessionDetailRow(label, value, $"{label} {value}");
    }

    // Web: formatDateTime(started_at). The shared full variant ignores "now" (only the relative tier uses it),
    // so the rendered string is deterministic; a null/unparseable timestamp renders the em-dash fallback.
    private static string FormatDate(DateTimeOffset? startedAt) =>
        DateTimeFormatting.Format(startedAt, DateTimeVariant.Full, DateTimeOffset.Now);

    // Web: `${start_soc_pct}% → ${end_soc_pct ?? '?'}%`. Raw number-to-string (no grouping / fixed digits)
    // matches the JS template literal; a missing end SoC becomes "?".
    private static string FormatSocRange(SessionDetailModel model)
    {
        string start = FormatSoc(model.StartSocPct);
        string end = model.EndSocPct is { } endSoc ? FormatSoc(endSoc) : MissingSoc;
        return $"{start}%{SocArrow}{end}%";
    }

    private static string FormatSoc(double value) => value.ToString(CultureInfo.InvariantCulture);

    // Web: fmtWithUnit(siValue / 1000, unit) → fmtNumber(safeNumber(value), 2) + " " + unit. The non-finite
    // guard reproduces the web safeNumber coercion (NaN / ±Infinity → 0) so the readout never shows "NaN".
    private static string FormatKilo(double siValue, string unit)
    {
        double kilo = (double.IsFinite(siValue) ? siValue : 0) / KiloDivisor;
        return $"{NumberFormatting.Format(kilo, null, Precision)} {unit}";
    }

    // Web: fmtWithUnit(durationMinutes(started_at, ended_at), 'min') — the whole-minute count formatted at the
    // default precision, so an integer minute count renders with two trailing zeros ("45.00 min").
    private static string FormatDuration(DateTimeOffset? startedAt, DateTimeOffset? endedAt)
    {
        double minutes = DurationMinutes(startedAt, endedAt);
        return $"{NumberFormatting.Format(minutes, null, Precision)} min";
    }

    private static string BuildAutomationName(
        SessionDetailState state,
        string title,
        IReadOnlyList<SessionDetailRow> rows,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            SessionDetailState.Loading => $"{title}. {loadingLabel}",
            SessionDetailState.Empty => $"{title}. {emptyMessage}",
            _ => $"{title}. {JoinRows(rows)}",
        };

    private static string JoinRows(IReadOnlyList<SessionDetailRow> rows)
    {
        var names = new string[rows.Count];
        for (int i = 0; i < rows.Count; i++)
        {
            names[i] = rows[i].AutomationName;
        }

        return string.Join(", ", names);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SessionDetailPanel</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a date, location, energy, power, or
/// cost — so a diagnostics line can never leak a user's charging session. Thread-safe.
/// </summary>
public sealed class SessionDetailDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SessionDetailDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SessionDetailPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SessionDetailRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SessionDetailPanel</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx</c>.
/// </summary>
public static class SessionDetailRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SessionDetailPanel";

    /// <summary>The currency symbol used for the cost row when the host supplies none (web default "$").</summary>
    public const string DefaultCurrencySymbol = "$";
}
