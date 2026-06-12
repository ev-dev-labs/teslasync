using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>PowersharePage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/charging/pages/PowersharePage.tsx). The web page is a
/// pure read of five cold Powershare signals from <c>signal_observations</c>: it shows the two
/// <c>GlassPanel</c> regions whenever any value is present (the success layout) and a per-panel
/// <c>EmptyState</c> when its slice of data is absent. The native feature-view owns its own load of the same
/// five reads and therefore renders the full state matrix the P2 contract mandates — a loading shimmer, a
/// retryable failure surface, and the always-visible two-panel layout whose internal content is either the
/// populated stat cards / stop-reason chip (success) or a friendly empty surface (empty). Every branch maps
/// onto a visible region; no panel is ever hidden.
/// </summary>
public enum PowershareState
{
    /// <summary>Initial load with no reading yet (a vehicle is selected) — the page shows the skeleton.</summary>
    Loading,

    /// <summary>The reads resolved with no Powershare data (incl. no vehicle selected) — the panels show their empty surfaces.</summary>
    Empty,

    /// <summary>The load failed outright — a retryable error surface shows.</summary>
    Error,

    /// <summary>At least one Powershare value is present — the stat cards / stop-reason chip render.</summary>
    Success,
}

/// <summary>
/// The Powershare slice the surface needs, reduced to the five cold signals the web page reads through
/// <c>useSignalObservations</c>: the <see cref="Status"/> (<c>PowershareStatus</c>, text), the
/// <see cref="ShareType"/> (<c>PowershareType</c>, text), the <see cref="StopReason"/>
/// (<c>PowershareStopReason</c>, text), the <see cref="HoursLeft"/> (<c>PowershareHoursLeft</c>, numeric) and
/// the <see cref="PowerKw"/> (<c>PowershareInstantaneousPowerKW</c>, numeric, already kilowatts on the wire —
/// the signal name carries the unit, exactly as the web renders it with a literal "kW" suffix and no
/// conversion). Each field is independently nullable so a partial body never throws and the per-card em-dash
/// (web parity) is preserved. Pure data — no WinUI types — so the projection is unit-tested headlessly.
/// </summary>
public sealed record PowershareReading(
    string? Status,
    string? ShareType,
    string? StopReason,
    double? HoursLeft,
    double? PowerKw)
{
    /// <summary>The all-absent reading — the parse fallback and the default empty-feed result.</summary>
    public static PowershareReading Empty { get; } = new(null, null, null, null, null);

    /// <summary>
    /// True when at least one of the five values is present — the native analogue of the web
    /// <c>hasData = status != null || shareType != null || stopReason != null || hoursLeft != null ||
    /// powerKw != null</c> gate. Drives the status panel's grid-vs-empty body.
    /// </summary>
    public bool HasData =>
        Status is not null
        || ShareType is not null
        || StopReason is not null
        || HoursLeft is not null
        || PowerKw is not null;

    /// <summary>
    /// Compose the reading from the five raw <c>/signals/observations</c> envelopes the feed fetched (one per
    /// field), reducing each through the same value-kind discriminator the web <c>adaptObservations</c> +
    /// <c>latestText</c> / <c>latestNumeric</c> helpers apply. A missing / failed observation is passed as an
    /// empty envelope and simply leaves that value absent (web parity: each query is independent).
    /// </summary>
    public static PowershareReading FromObservations(
        JsonElement status,
        JsonElement shareType,
        JsonElement stopReason,
        JsonElement hoursLeft,
        JsonElement powerKw) =>
        new(
            PowershareObservation.LatestText(status),
            PowershareObservation.LatestText(shareType),
            PowershareObservation.LatestText(stopReason),
            PowershareObservation.LatestNumeric(hoursLeft),
            PowershareObservation.LatestNumeric(powerKw));
}

/// <summary>
/// Pure reducers over a single <c>/signals/observations</c> response envelope — the native port of the web
/// <c>adaptObservations</c> + <c>latestNumeric</c> / <c>latestText</c> helpers
/// (web/src/lib/signalObservation.ts). They read the newest row from <c>{ "observations": [ { value_kind,
/// value } ] }</c>, tolerating both the snake_case (production) and camelCase (some request middleware)
/// value-kind keys, and map the value-kind onto the legacy text / numeric channels exactly as the web set
/// membership does. Unknown / compound kinds fall through to null. No WinUI types — unit-tested headlessly.
/// </summary>
public static class PowershareObservation
{
    /// <summary>The newest text value (web <c>latestText</c>: <c>data?.[0]?.value_text</c>).</summary>
    public static string? LatestText(JsonElement envelope) =>
        TryFirstObservation(envelope, out var row) && IsTextKind(ValueKind(row)) ? AsText(Value(row)) : null;

    /// <summary>The newest numeric value (web <c>latestNumeric</c>: <c>data?.[0]?.value_numeric</c>).</summary>
    public static double? LatestNumeric(JsonElement envelope) =>
        TryFirstObservation(envelope, out var row) && IsNumericKind(ValueKind(row)) ? AsNumber(Value(row)) : null;

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

    // Tolerate snake_case (production) and camelCase (some request middleware) value-kind keys, like the web adapter.
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

    // Web TEXT_VALUE_KINDS — proto-prefixed enum names land here too.
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
}

/// <summary>
/// The render-time data model the <c>PowersharePage</c> projects from — the native analogue of the web page's
/// resolved query state (web/src/features/charging/pages/PowersharePage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="VehicleSelected">Whether a vehicle is selected (web <c>vehicleId != null</c>).</param>
/// <param name="Loading">Whether the reads are in flight with no data yet.</param>
/// <param name="HasError">Whether the load failed outright.</param>
/// <param name="ErrorDetail">Optional failure detail (kept off-screen; PII-safe).</param>
/// <param name="Reading">The resolved Powershare reading (web's five query results).</param>
public sealed record PowershareModel(
    bool VehicleSelected,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    PowershareReading Reading)
{
    /// <summary>The initial model — first load, no vehicle resolved yet, no data.</summary>
    public static PowershareModel Initial { get; } = new(
        VehicleSelected: false,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Reading: PowershareReading.Empty);
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view — the native analogue of a web
/// <c>StatCard</c> instance. Holds the localized label, the already-formatted value (number + inline unit, or
/// em-dash), the semantic sub-line, the resolved Fluent glyph and a Narrator automation name. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record PowershareStat(string Label, string Value, string Sublabel, string Glyph, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds
/// to, with every visible literal already resolved through the i18n facade and every number formatted at the
/// display boundary. Holds the always-visible page header, the three data-state flags, and the two
/// always-rendered panels: the status panel (status badge + the three stat tiles or its empty surface) and
/// the stop-reason panel (the stop-reason chip + help text or its empty surface). Pure data so every branch
/// is asserted headlessly.
/// </summary>
public sealed record PowershareDisplay(
    PowershareState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowContent,

    // GlassPanel1 — Powershare status
    string StatusSectionTitle,
    string StatusBadgeText,
    StatusKind StatusBadgeStatus,
    bool HasData,
    string NoDataMessage,
    PowershareStat TypeCard,
    PowershareStat PowerCard,
    PowershareStat HoursCard,

    // GlassPanel5 — stop reason
    string StopReasonSectionTitle,
    bool StopReasonPresent,
    string StopReasonText,
    StatusKind StopReasonStatus,
    string StopReasonHelp,
    string NoStopReasonMessage,

    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="PowershareModel"/> to its <see cref="PowershareDisplay"/> — the native
/// port of the render logic in web/src/features/charging/pages/PowersharePage.tsx. Every visible literal
/// resolves through the i18n facade using the exact web key names; the instantaneous power and hours-left
/// readouts format at the display boundary via the shared <see cref="ScalarFormatters"/> (web <c>fmtNumber</c>)
/// with their literal kW / h suffixes (neither is unit-system dependent, so no conversion is applied — exactly
/// as the web renders them). Every chrome string is resolved on every projection so the i18n contract holds in
/// every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class PowershareProjection
{
    /// <summary>Em-dash shown when a value is absent (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>Fraction digits for the instantaneous power readout (web <c>fmtNumber(powerKw, 2)</c>).</summary>
    public const int PowerPrecision = 2;

    /// <summary>Fraction digits for the hours-remaining readout (web <c>fmtNumber(hoursLeft, 1)</c>).</summary>
    public const int HoursPrecision = 1;

    private const string KilowattUnit = "kW";
    private const string HourUnit = "h";

    // Segoe Fluent / MDL2 glyphs standing in for the web lucide icons.
    private const string ZapGlyph = "\uE945";        // power / lightning (status section + output power)
    private const string HomeGlyph = "\uE80F";       // home (Powershare destination type)
    private const string ClockGlyph = "\uE917";      // clock (hours remaining)
    private const string AlertGlyph = "\uE7BA";      // warning (stop reason section)

    /// <summary>The status-section accent glyph (web Zap icon).</summary>
    public static string StatusGlyph => ZapGlyph;

    /// <summary>The stop-reason-section accent glyph (web AlertCircle icon).</summary>
    public static string StopReasonGlyph => AlertGlyph;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    public static PowershareDisplay Project(PowershareModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Resolve every visible literal up-front so the i18n contract holds in every data state.
        string title = localizer.GetString("powershare.title", "Powershare");
        string subtitle = localizer.GetString(
            "powershare.subtitle",
            "Monitor your vehicle\u2019s bidirectional power sharing \u2014 status, output, remaining runtime, and stop conditions.");
        string statusSection = localizer.GetString("powershare.statusSection", "Powershare Status");
        string noData = localizer.GetString("common.noData", EmDash);
        string typeLabel = localizer.GetString("powershare.type", "Type");
        string typeSub = localizer.GetString("powershare.typeSub", "Powershare destination");
        string powerLabel = localizer.GetString("powershare.outputPower", "Output Power");
        string powerSub = localizer.GetString("powershare.outputPowerSub", "Instantaneous power draw");
        string hoursLabel = localizer.GetString("powershare.hoursLeft", "Hours Remaining");
        string hoursSub = localizer.GetString("powershare.hoursLeftSub", "Estimated runtime at current output");
        string noDataMessage = localizer.GetString(
            "powershare.noData",
            "No Powershare data received yet. Values appear once your vehicle reports Powershare telemetry.");
        string stopSection = localizer.GetString("powershare.stopReasonSection", "Stop Reason");
        string stopHelp = localizer.GetString("powershare.stopReasonHelp", "Last recorded reason Powershare was halted.");
        string noStopReason = localizer.GetString(
            "powershare.noStopReason",
            "No stop reason recorded. Powershare has not been halted, or the signal has not yet been reported.");

        // Error / loading chrome (not parity-counted, but resolved so nothing renders an English literal).
        string errorText = localizer.GetString("common.error", "Couldn\u2019t load Powershare data");
        string retryLabel = localizer.GetString("common.retry", "Retry");

        var reading = model.Reading;
        var state = ResolveState(model);
        bool hasData = reading.HasData;

        string statusBadgeText = reading.Status is { Length: > 0 } status ? status : noData;
        StatusKind statusBadgeStatus = reading.Status is { Length: > 0 } s ? StatusVariant(s) : StatusKind.Neutral;

        var typeCard = Card(typeLabel, reading.ShareType ?? EmDash, typeSub, HomeGlyph);
        var powerCard = Card(powerLabel, FormatWithUnit(reading.PowerKw, PowerPrecision, KilowattUnit), powerSub, ZapGlyph);
        var hoursCard = Card(hoursLabel, FormatWithUnit(reading.HoursLeft, HoursPrecision, HourUnit), hoursSub, ClockGlyph);

        bool stopPresent = reading.StopReason is { Length: > 0 };
        string stopReasonText = stopPresent ? reading.StopReason! : EmDash;
        StatusKind stopStatus = StopReasonVariant(reading.StopReason);

        return new PowershareDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: state == PowershareState.Loading,
            ShowError: state == PowershareState.Error,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowContent: state is PowershareState.Empty or PowershareState.Success,
            StatusSectionTitle: statusSection,
            StatusBadgeText: statusBadgeText,
            StatusBadgeStatus: statusBadgeStatus,
            HasData: hasData,
            NoDataMessage: noDataMessage,
            TypeCard: typeCard,
            PowerCard: powerCard,
            HoursCard: hoursCard,
            StopReasonSectionTitle: stopSection,
            StopReasonPresent: stopPresent,
            StopReasonText: stopReasonText,
            StopReasonStatus: stopStatus,
            StopReasonHelp: stopHelp,
            NoStopReasonMessage: noStopReason,
            AutomationName: title);
    }

    /// <summary>
    /// Map a Powershare status string to a semantic badge status — the native port of the web
    /// <c>statusVariant</c> helper, preserving its exact substring-precedence order (including its quirk that
    /// "inactive" matches the "active" branch first) so the chip colour matches the web pixel-for-pixel.
    /// </summary>
    public static StatusKind StatusVariant(string? status)
    {
        if (string.IsNullOrEmpty(status))
        {
            return StatusKind.Neutral;
        }

        string s = status.ToLowerInvariant();
        if (s.Contains("active", StringComparison.Ordinal) || s.Contains("on", StringComparison.Ordinal))
        {
            return StatusKind.Success;
        }

        if (s.Contains("error", StringComparison.Ordinal) || s.Contains("fail", StringComparison.Ordinal))
        {
            return StatusKind.Danger;
        }

        if (s.Contains("inactive", StringComparison.Ordinal) || s.Contains("off", StringComparison.Ordinal))
        {
            return StatusKind.Neutral;
        }

        return StatusKind.Warning;
    }

    /// <summary>
    /// Map a stop-reason string to a semantic badge status — the native port of the web
    /// <c>stopReasonVariant</c> helper (none/empty → neutral, user → warning, error/fault/low → danger, else
    /// → warning).
    /// </summary>
    public static StatusKind StopReasonVariant(string? reason)
    {
        if (string.IsNullOrEmpty(reason))
        {
            return StatusKind.Neutral;
        }

        string r = reason.ToLowerInvariant();
        if (r is "none" or "")
        {
            return StatusKind.Neutral;
        }

        if (r.Contains("user", StringComparison.Ordinal))
        {
            return StatusKind.Warning;
        }

        if (r.Contains("error", StringComparison.Ordinal)
            || r.Contains("fault", StringComparison.Ordinal)
            || r.Contains("low", StringComparison.Ordinal))
        {
            return StatusKind.Danger;
        }

        return StatusKind.Warning;
    }

    private static string FormatWithUnit(double? value, int precision, string unit) =>
        value is { } v && !double.IsNaN(v) && !double.IsInfinity(v)
            ? string.Create(CultureInfo.CurrentCulture, $"{ScalarFormatters.FormatNumber(v, precision)} {unit}")
            : EmDash;

    private static PowershareStat Card(string label, string value, string sublabel, string glyph) =>
        new(label, value, sublabel, glyph, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));

    private static PowershareState ResolveState(PowershareModel model)
    {
        if (model.HasError)
        {
            return PowershareState.Error;
        }

        if (model.Loading)
        {
            return PowershareState.Loading;
        }

        return model.Reading.HasData ? PowershareState.Success : PowershareState.Empty;
    }
}

/// <summary>
/// The data port the <see cref="PowersharePageViewModel"/> reads through — the native parity of the web page's
/// five <c>useSignalObservations</c> reads (<c>GET /signals/observations</c>, one per Powershare field). The
/// view never performs HTTP itself; the default <see cref="EmptyPowershareFeed"/> resolves to the empty state,
/// and the generated-client-backed <see cref="PowershareClientFeed"/> binds to the generated OpenAPI contract
/// client (ADR-004). Each read is independent and best-effort, so a failed observation simply leaves that
/// value absent (web parity).
/// </summary>
public interface IPowershareFeed
{
    /// <summary>Resolve the latest Powershare reading (the five cold-signal observation reads) for a vehicle.</summary>
    Task<PowershareReading> FetchAsync(string vehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty reading (the empty data state).</summary>
public sealed class EmptyPowershareFeed : IPowershareFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyPowershareFeed Instance { get; } = new();

    private EmptyPowershareFeed()
    {
    }

    /// <inheritdoc />
    public Task<PowershareReading> FetchAsync(string vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(PowershareReading.Empty);
    }
}

/// <summary>
/// Canonical metadata for the <c>PowersharePage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/charging/pages/PowersharePage.tsx</c> (route <c>/powershare</c>, nav name
/// <c>Powershare</c>). Centralises the stable id, route name, the five observed signal field names and the
/// diagnostics slug so the view and view-model stay free of literal identifiers.
/// </summary>
public static class PowershareRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "powershare-page";

    /// <summary>The navigation route name the shell registers this page under (see RouteTable.cs).</summary>
    public const string RouteName = "Powershare";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "PowersharePage";

    /// <summary>The single observation row each cold-signal read requests (web <c>limit: 1</c>).</summary>
    public const int ObservationLimit = 1;

    /// <summary>The <c>PowershareStatus</c> signal field (web <c>signal_name: 'PowershareStatus'</c>).</summary>
    public const string StatusField = "PowershareStatus";

    /// <summary>The <c>PowershareType</c> signal field.</summary>
    public const string TypeField = "PowershareType";

    /// <summary>The <c>PowershareStopReason</c> signal field.</summary>
    public const string StopReasonField = "PowershareStopReason";

    /// <summary>The <c>PowershareHoursLeft</c> signal field.</summary>
    public const string HoursLeftField = "PowershareHoursLeft";

    /// <summary>The <c>PowershareInstantaneousPowerKW</c> signal field.</summary>
    public const string PowerField = "PowershareInstantaneousPowerKW";

    /// <summary>The localized page title (web <c>t('powershare.title', 'Powershare')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("powershare.title", "Powershare");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PowersharePage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a status, VIN or power value — so a
/// diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class PowershareDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public PowershareDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PowersharePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PowershareRegistration.Slug}");
    }
}
