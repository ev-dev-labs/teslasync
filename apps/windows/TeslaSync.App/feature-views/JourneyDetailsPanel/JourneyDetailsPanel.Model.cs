using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>JourneyDetailsPanel</c> surface — the native union of the
/// states the P2 feature-view contract requires for the drive-detail Journey-Details panel
/// (web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx). The web component is a pure
/// presentational child (it takes a <c>drive: DriveDetail</c> prop and performs no fetching), so the parent
/// Drive-Detail experience owns the query lifecycle and supplies the active state. Every member maps onto a
/// visible surface; none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum JourneyDetailsPanelState
{
    /// <summary>The drive query is in flight and no journey has arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>A drive to detail (the web fall-through) — the start + destination endpoint columns.</summary>
    Ready,

    /// <summary>Resolved with no drive selected — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The drive query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached snapshot plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Which end of the journey an endpoint column describes — the start of the drive or its destination. Lets the
/// view pick the matching Segoe Fluent glyph and the semantic accent the web tints each header with (the web's
/// green <c>MapPin</c> "Start" versus the red <c>Flag</c> "Destination").
/// </summary>
public enum JourneyEndpointKind
{
    /// <summary>The drive's origin — the web green <c>MapPin</c> "Start" column.</summary>
    Start,

    /// <summary>The drive's destination — the web red <c>Flag</c> "Destination" column.</summary>
    Destination,
}

/// <summary>
/// The render-time data model the <c>JourneyDetailsPanel</c> view binds to — the native analogue of the web
/// component's <c>drive: DriveDetail</c> prop, narrowed to the ten fields the panel actually reads
/// (<c>startTs</c>, <c>endTs</c>, <c>startAddress</c>, <c>endAddress</c>, <c>startLat</c>/<c>startLon</c>,
/// <c>endLat</c>/<c>endLon</c>, <c>startBatteryPct</c>, <c>endBatteryPct</c>) plus the parent-supplied lifecycle
/// <see cref="Status"/> and freshness flags. The view never performs HTTP; the parent Drive-Detail state holder
/// fills this in (the native P1/S8 seam). Coordinates are decimal degrees and battery percentages are 0..100
/// dimensionless shares (neither needs a unit conversion). Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record JourneyDetailsPanelModel(
    JourneyDetailsPanelState Status,
    DateTimeOffset? StartTs,
    DateTimeOffset? EndTs,
    string? StartAddress,
    string? EndAddress,
    double? StartLat,
    double? StartLon,
    double? EndLat,
    double? EndLon,
    double? StartBatteryPct,
    double? EndBatteryPct,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the drive query is in flight and no journey has arrived yet.</summary>
    public static JourneyDetailsPanelModel Loading { get; } =
        new(JourneyDetailsPanelState.Loading, null, null, null, null, null, null, null, null, null, null);

    /// <summary>A resolved model with no drive selected — the empty surface.</summary>
    public static JourneyDetailsPanelModel Empty { get; } =
        new(JourneyDetailsPanelState.Empty, null, null, null, null, null, null, null, null, null, null);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    public static JourneyDetailsPanelModel Failed(string? message = null) =>
        new(
            JourneyDetailsPanelState.Error,
            null, null, null, null, null, null, null, null, null, null,
            ErrorMessage: message);

    /// <summary>A fresh resolved model bound to the narrowed drive fields the panel renders.</summary>
    public static JourneyDetailsPanelModel Ready(
        DateTimeOffset? startTs,
        DateTimeOffset? endTs,
        string? startAddress,
        string? endAddress,
        double? startLat,
        double? startLon,
        double? endLat,
        double? endLon,
        double? startBatteryPct,
        double? endBatteryPct,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false) =>
        Build(
            JourneyDetailsPanelState.Ready,
            startTs, endTs, startAddress, endAddress,
            startLat, startLon, endLat, endLon,
            startBatteryPct, endBatteryPct, updatedAt, isFetching);

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached journey.</summary>
    public static JourneyDetailsPanelModel Stale(
        DateTimeOffset? startTs,
        DateTimeOffset? endTs,
        string? startAddress,
        string? endAddress,
        double? startLat,
        double? startLon,
        double? endLat,
        double? endLon,
        double? startBatteryPct,
        double? endBatteryPct,
        DateTimeOffset? updatedAt = null) =>
        Build(
            JourneyDetailsPanelState.Stale,
            startTs, endTs, startAddress, endAddress,
            startLat, startLon, endLat, endLon,
            startBatteryPct, endBatteryPct, updatedAt, false);

    /// <summary>An offline snapshot (no connectivity) carrying the last cached journey.</summary>
    public static JourneyDetailsPanelModel Offline(
        DateTimeOffset? startTs,
        DateTimeOffset? endTs,
        string? startAddress,
        string? endAddress,
        double? startLat,
        double? startLon,
        double? endLat,
        double? endLon,
        double? startBatteryPct,
        double? endBatteryPct,
        DateTimeOffset? updatedAt = null) =>
        Build(
            JourneyDetailsPanelState.Offline,
            startTs, endTs, startAddress, endAddress,
            startLat, startLon, endLat, endLon,
            startBatteryPct, endBatteryPct, updatedAt, false);

    private static JourneyDetailsPanelModel Build(
        JourneyDetailsPanelState state,
        DateTimeOffset? startTs,
        DateTimeOffset? endTs,
        string? startAddress,
        string? endAddress,
        double? startLat,
        double? startLon,
        double? endLat,
        double? endLon,
        double? startBatteryPct,
        double? endBatteryPct,
        DateTimeOffset? updatedAt,
        bool isFetching) =>
        new(
            state,
            startTs, endTs, startAddress, endAddress,
            startLat, startLon, endLat, endLon,
            startBatteryPct, endBatteryPct, updatedAt, isFetching);
}

/// <summary>
/// One projected, render-ready journey endpoint — the native analogue of a single column the web
/// <c>JourneyDetailsPanel</c> renders (the green "Start" column or the red "Destination" column).
/// <see cref="Kind"/> lets the view pick the matching glyph + accent; <see cref="Label"/> is the localized
/// header ("Start" / "Destination"); <see cref="AddressText"/> is the resolved address, decimal-degree
/// coordinates, or the "No address data" / "In progress" fallback the web falls through to;
/// <see cref="IsCoordinates"/> tells the view to render <see cref="AddressText"/> in the monospace face the web
/// uses for its <c>font-mono</c> coordinate span; <see cref="TimestampText"/> is the formatted endpoint time
/// (or "In progress" for a still-running drive's destination); <see cref="BatteryText"/> is the
/// "<c>Battery: {n}%</c>" line; and <see cref="AutomationName"/> is the spoken row. Pure data.
/// </summary>
public sealed record JourneyEndpoint(
    JourneyEndpointKind Kind,
    string Label,
    string AddressText,
    bool IsCoordinates,
    string TimestampText,
    string BatteryText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of what the
/// web <c>JourneyDetailsPanel</c> renders. Holds the active <see cref="State"/>, the localized
/// <see cref="Title"/> ("Journey Details"), the two endpoint columns (<see cref="Start"/> +
/// <see cref="Destination"/>), the freshness chip copy + status (shown only for
/// <see cref="JourneyDetailsPanelState.Stale"/> / <see cref="JourneyDetailsPanelState.Offline"/>), the empty /
/// loading / error copy and retry label, the freshness timestamp + fetching flag, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record JourneyDetailsPanelDisplay(
    JourneyDetailsPanelState State,
    string Title,
    JourneyEndpoint Start,
    JourneyEndpoint Destination,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string EmptyMessage,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="JourneyDetailsPanelModel"/> to its <see cref="JourneyDetailsPanelDisplay"/>
/// — the native port of web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx. The branch
/// precedence is the parent's data lifecycle (loading / error / empty / stale / offline come straight from the
/// parent's classification; everything else is a populated journey). The address fall-through reproduces the
/// web exactly: a non-empty address wins; otherwise truthy (non-null, non-zero) latitude AND longitude render a
/// decimal-degree coordinate; otherwise the destination shows "No address data" when the drive has ended and
/// "In progress" while it is still running, and the start shows "No address data". Coordinates mirror the web's
/// <c>fmtNumber</c> contract (en-US grouping, the web default decimal precision, the signed latitude / absolute
/// longitude + N/S/E/W cardinal letters the web hard-codes), the timestamp uses the shared
/// <see cref="DateTimeFormatting"/> full variant the web <c>DateTime</c> renders, and the battery line keeps the
/// web's raw "<c>{pct ?? '?'}%</c>" template. Every label resolves through the i18n facade using the same keys
/// the web feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class JourneyDetailsPanelProjection
{
    /// <summary>
    /// Fixed fraction digits for the decimal-degree coordinate readout — the web <c>fmtNumber</c> default
    /// precision (<c>decimal_precision</c> = 2), applied at the display boundary exactly as the web does.
    /// </summary>
    public const int CoordinatePrecision = 2;

    // The degree sign the web prints after each coordinate component (U+00B0).
    private const string DegreeSign = "\u00B0";

    // Sentinel the web prints for a missing battery percentage (`startBatteryPct ?? '?'`).
    private const string MissingBattery = "?";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop, narrowed to the rendered fields).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static JourneyDetailsPanelDisplay Project(JourneyDetailsPanelModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // A drive always has at least a start endpoint to show, so a populated snapshot never collapses to the
        // empty state; emptiness is parent-supplied (no drive selected). Loading / Error / Stale / Offline come
        // straight from the parent's lifecycle classification.
        JourneyDetailsPanelState state = model.Status;

        string title = localizer.GetString("driveDetail.journeyDetails", "Journey Details");
        string batteryLabel = localizer.GetString("driveDetail.battery", "Battery");

        JourneyEndpoint start = BuildStart(model, localizer, batteryLabel);
        JourneyEndpoint destination = BuildDestination(model, localizer, batteryLabel);

        bool showChip = state is JourneyDetailsPanelState.Stale or JourneyDetailsPanelState.Offline;
        string chipText = state switch
        {
            JourneyDetailsPanelState.Offline => localizer.GetString("common.offline", "Offline"),
            JourneyDetailsPanelState.Stale => localizer.GetString("driveDetail.stale", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == JourneyDetailsPanelState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string emptyMessage = localizer.GetString("common.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string errorTitle = localizer.GetString(
            "driveDetail.section.journeyDetailsFailed", "Journey details failed to load");
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(
                "driveDetail.journeyDetailsErrorMessage",
                "We couldn't load the journey details. Please try again.")
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string automationName = BuildAutomationName(
            state, title, showChip, chipText, start, destination, emptyMessage, loadingLabel, errorTitle);

        return new JourneyDetailsPanelDisplay(
            State: state,
            Title: title,
            Start: start,
            Destination: destination,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// Format a decimal-degree coordinate pair exactly as the web's <c>font-mono</c> span:
    /// <c>{fmtNumber(lat)}°{N|S}, {fmtNumber(|lon|)}°{E|W}</c> — signed latitude, absolute longitude, the
    /// cardinal letter chosen by each component's sign, joined with the web's degree signs and comma. Non-finite
    /// inputs collapse to zero just as the web <c>safeNumber</c> coercion does.
    /// </summary>
    internal static string FormatCoordinates(double lat, double lon)
    {
        string latText = NumberFormatting.Format(SafeNumber(lat), null, CoordinatePrecision);
        string ns = lat >= 0 ? "N" : "S"; // web `lat >= 0 ? 'N' : 'S'` — cardinal letters are not localized.
        string lonText = NumberFormatting.Format(SafeNumber(Math.Abs(lon)), null, CoordinatePrecision);
        string ew = lon >= 0 ? "E" : "W"; // web `lon >= 0 ? 'E' : 'W'`.
        return $"{latText}{DegreeSign}{ns}, {lonText}{DegreeSign}{ew}";
    }

    /// <summary>
    /// Compose the battery line the web renders as "<c>{label}: {pct ?? '?'}%</c>" — the raw percentage with no
    /// grouping or fixed precision (the web prints the value verbatim), or the "?" sentinel when it is absent.
    /// </summary>
    internal static string FormatBattery(string label, double? pct)
    {
        string value = pct is { } p ? p.ToString(CultureInfo.InvariantCulture) : MissingBattery;
        return $"{label}: {value}%";
    }

    /// <summary>
    /// The web coordinate guard <c>lat &amp;&amp; lon</c>: a coordinate component is "truthy" only when it is
    /// present, non-zero and not NaN (a 0° component or a missing value falls through to the address fallback,
    /// exactly as JavaScript's <c>&amp;&amp;</c> short-circuits on a falsy number).
    /// </summary>
    internal static bool IsTruthyCoordinate(double? value) => value is { } d && d != 0 && !double.IsNaN(d);

    private static JourneyEndpoint BuildStart(
        JourneyDetailsPanelModel model, ILocalizer localizer, string batteryLabel)
    {
        string label = localizer.GetString("driveDetail.start", "Start");
        (string address, bool isCoord) = ResolveStartAddress(model, localizer);
        string timestamp = DateTimeFormatting.Format(model.StartTs, DateTimeVariant.Full, DateTimeOffset.Now);
        string battery = FormatBattery(batteryLabel, model.StartBatteryPct);
        return new JourneyEndpoint(
            JourneyEndpointKind.Start,
            label,
            address,
            isCoord,
            timestamp,
            battery,
            BuildEndpointAutomation(label, address, timestamp, battery));
    }

    private static JourneyEndpoint BuildDestination(
        JourneyDetailsPanelModel model, ILocalizer localizer, string batteryLabel)
    {
        string label = localizer.GetString("driveDetail.destination", "Destination");
        (string address, bool isCoord) = ResolveDestinationAddress(model, localizer);

        // Web: `drive.endTs ? <DateTime …/> : t('driveDetail.inProgress')` — a still-running drive has no end.
        string timestamp = model.EndTs is { } end
            ? DateTimeFormatting.Format(end, DateTimeVariant.Full, DateTimeOffset.Now)
            : localizer.GetString("driveDetail.inProgress", "In progress");

        string battery = FormatBattery(batteryLabel, model.EndBatteryPct);
        return new JourneyEndpoint(
            JourneyEndpointKind.Destination,
            label,
            address,
            isCoord,
            timestamp,
            battery,
            BuildEndpointAutomation(label, address, timestamp, battery));
    }

    // Web: startAddress ? startAddress : (startLat && startLon) ? coords : t('driveDetail.noAddress').
    private static (string Text, bool IsCoordinates) ResolveStartAddress(
        JourneyDetailsPanelModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrEmpty(model.StartAddress))
        {
            return (model.StartAddress, false);
        }

        if (IsTruthyCoordinate(model.StartLat) && IsTruthyCoordinate(model.StartLon))
        {
            return (FormatCoordinates(model.StartLat!.Value, model.StartLon!.Value), true);
        }

        return (localizer.GetString("driveDetail.noAddress", "No address data"), false);
    }

    // Web: endAddress ? endAddress : (endLat && endLon) ? coords : endTs ? t('noAddress') : t('inProgress').
    private static (string Text, bool IsCoordinates) ResolveDestinationAddress(
        JourneyDetailsPanelModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrEmpty(model.EndAddress))
        {
            return (model.EndAddress, false);
        }

        if (IsTruthyCoordinate(model.EndLat) && IsTruthyCoordinate(model.EndLon))
        {
            return (FormatCoordinates(model.EndLat!.Value, model.EndLon!.Value), true);
        }

        return model.EndTs.HasValue
            ? (localizer.GetString("driveDetail.noAddress", "No address data"), false)
            : (localizer.GetString("driveDetail.inProgress", "In progress"), false);
    }

    private static double SafeNumber(double value) => double.IsFinite(value) ? value : 0;

    private static string BuildEndpointAutomation(
        string label, string address, string timestamp, string battery) =>
        $"{label}. {address}. {timestamp}. {battery}";

    private static string BuildAutomationName(
        JourneyDetailsPanelState state,
        string title,
        bool showChip,
        string chipText,
        JourneyEndpoint start,
        JourneyEndpoint destination,
        string emptyMessage,
        string loadingLabel,
        string errorTitle) => state switch
        {
            JourneyDetailsPanelState.Loading => $"{title}. {loadingLabel}",
            JourneyDetailsPanelState.Empty => $"{title}. {emptyMessage}",
            JourneyDetailsPanelState.Error => $"{title}. {errorTitle}",
            _ => string.Join(
                ". ",
                showChip
                    ? new[] { title, chipText, start.AutomationName, destination.AutomationName }
                    : new[] { title, start.AutomationName, destination.AutomationName }),
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>JourneyDetailsPanel</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never an address, coordinate, timestamp or
/// battery level — so a diagnostics line can never leak where or when a user drove. Thread-safe.
/// </summary>
public sealed class JourneyDetailsPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public JourneyDetailsPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=JourneyDetailsPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={JourneyDetailsPanelRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>JourneyDetailsPanel</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx</c>.
/// </summary>
public static class JourneyDetailsPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "JourneyDetailsPanel";
}
