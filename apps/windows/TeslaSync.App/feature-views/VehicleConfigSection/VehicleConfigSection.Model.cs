using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>VehicleConfigSection</c> surface — the native union of the
/// states the P2 feature-view contract requires for the vehicle-detail Vehicle-Configuration section
/// (web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx). The web component is a pure
/// presentational child (it takes <c>vehicleConfig</c> + <c>softwareVersion</c> props and performs no
/// fetching), so the parent Vehicle-Detail experience owns the query lifecycle and supplies the active state.
/// Every member maps onto a visible surface; none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum VehicleConfigSectionState
{
    /// <summary>The vehicle-config query is in flight and no snapshot has arrived — skeleton chrome (the web
    /// <c>vehicleConfig == null</c> branch, surfaced as the explicit loading state).</summary>
    Loading,

    /// <summary>A configuration snapshot is present — the two-column key/value list (the web fall-through).</summary>
    Ready,

    /// <summary>Resolved with no configuration to show — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached snapshot plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The narrowed vehicle-configuration snapshot the section reads — the native analogue of the web
/// <c>VehicleConfigSnapshot</c> prop (web/src/api/types.ts) restricted to the twelve fields
/// <c>VehicleConfigSection.tsx</c> renders. Every field is optional because the Tesla Fleet API populates
/// configuration lazily; the projection renders the em dash for any field that is absent. Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="CarType">Web <c>car_type</c> (e.g. <c>models</c>).</param>
/// <param name="Trim">Web <c>trim</c> (e.g. <c>P100D</c>).</param>
/// <param name="ExteriorColor">Web <c>exterior_color</c>.</param>
/// <param name="WheelType">Web <c>wheel_type</c>.</param>
/// <param name="RoofColor">Web <c>roof_color</c>.</param>
/// <param name="ChargePort">Web <c>charge_port</c>.</param>
/// <param name="RightHandDrive">Web <c>right_hand_drive</c>; null renders the em dash, otherwise Yes / No.</param>
/// <param name="EuropeVehicle">Web <c>europe_vehicle</c>; null renders the em dash, otherwise Yes / No.</param>
/// <param name="OffroadLightbarPresent">Web <c>offroad_lightbar_present</c>; null renders the em dash, otherwise Yes / No.</param>
/// <param name="RearSeatHeaters">Web <c>rear_seat_heaters</c>.</param>
/// <param name="SunroofInstalled">Web <c>sunroof_installed</c>.</param>
/// <param name="SoftwareUpdateVersion">Web <c>software_update_version</c>; the Software row falls back to the
/// parent-supplied <see cref="VehicleConfigSectionModel.SoftwareVersion"/> when this is absent.</param>
public sealed record VehicleConfigData(
    string? CarType = null,
    string? Trim = null,
    string? ExteriorColor = null,
    string? WheelType = null,
    string? RoofColor = null,
    string? ChargePort = null,
    bool? RightHandDrive = null,
    bool? EuropeVehicle = null,
    bool? OffroadLightbarPresent = null,
    string? RearSeatHeaters = null,
    string? SunroofInstalled = null,
    string? SoftwareUpdateVersion = null);

/// <summary>
/// The render-time data model the <c>VehicleConfigSection</c> view binds to — the native analogue of the web
/// component's <c>vehicleConfig</c> + <c>softwareVersion</c> props plus the parent-supplied lifecycle
/// <see cref="Status"/> and freshness flags. The view never performs HTTP; the parent Vehicle-Detail state
/// holder fills this in (the native P1/S8 seam). <see cref="SoftwareVersion"/> is the web's sibling
/// <c>softwareVersion</c> prop, used as the Software-row fallback exactly as the source does. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The parent-classified lifecycle state.</param>
/// <param name="Config">The configuration snapshot, or null while loading / empty / errored.</param>
/// <param name="SoftwareVersion">The web <c>softwareVersion</c> prop — the Software-row fallback.</param>
/// <param name="UpdatedAt">When the snapshot was produced (drives nothing here; carried for the host).</param>
/// <param name="IsFetching">True when a background refresh is in flight over cached content.</param>
/// <param name="ErrorMessage">An already-localized hard-failure message, or null to use the default copy.</param>
public sealed record VehicleConfigSectionModel(
    VehicleConfigSectionState Status,
    VehicleConfigData? Config,
    string? SoftwareVersion = null,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the query is in flight and no snapshot has arrived yet.</summary>
    public static VehicleConfigSectionModel Loading { get; } = new(VehicleConfigSectionState.Loading, null);

    /// <summary>A resolved model with no configuration to show — the empty state.</summary>
    public static VehicleConfigSectionModel Empty { get; } = new(VehicleConfigSectionState.Empty, null);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    public static VehicleConfigSectionModel Failed(string? message = null) =>
        new(VehicleConfigSectionState.Error, null, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the configuration snapshot.</summary>
    public static VehicleConfigSectionModel Ready(
        VehicleConfigData config,
        string? softwareVersion = null,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(config);
        return new(VehicleConfigSectionState.Ready, config, softwareVersion, updatedAt, isFetching);
    }

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached configuration.</summary>
    public static VehicleConfigSectionModel Stale(
        VehicleConfigData config,
        string? softwareVersion = null,
        DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(config);
        return new(VehicleConfigSectionState.Stale, config, softwareVersion, updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached configuration.</summary>
    public static VehicleConfigSectionModel Offline(
        VehicleConfigData config,
        string? softwareVersion = null,
        DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(config);
        return new(VehicleConfigSectionState.Offline, config, softwareVersion, updatedAt);
    }
}

/// <summary>
/// One projected, render-ready configuration row — the native analogue of a single web <c>KVList</c> item.
/// <see cref="Label"/> is the localized caption, <see cref="Value"/> is the resolved value (the em dash when
/// absent), and <see cref="AutomationName"/> is the spoken "<c>{label}, {value}</c>". Pure data.
/// </summary>
public sealed record VehicleConfigItem(string Label, string Value, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the section for one input model — the native analogue of what the
/// web <c>VehicleConfigSection</c> renders. Holds the active <see cref="State"/>, the localized
/// <see cref="Title"/>, the twelve <see cref="Items"/>, the freshness chip copy + status (shown only for
/// <see cref="VehicleConfigSectionState.Stale"/> / <see cref="VehicleConfigSectionState.Offline"/>), the empty
/// / loading / error copy and retry label, the freshness timestamp + fetching flag, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record VehicleConfigSectionDisplay(
    VehicleConfigSectionState State,
    string Title,
    IReadOnlyList<VehicleConfigItem> Items,
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
/// Pure projection from a <see cref="VehicleConfigSectionModel"/> to its <see cref="VehicleConfigSectionDisplay"/>
/// — the native port of web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx. Branch
/// precedence mirrors the web parent's data lifecycle: loading / error / empty / stale / offline come straight
/// from the parent's classification; a fresh "Ready" snapshot with a configuration renders the twelve rows
/// (the web truthy branch, em dash for absent fields), while a Ready model with no snapshot collapses to the
/// loading skeleton (the web <c>vehicleConfig == null</c> branch). The twelve rows reproduce the source's
/// label order, its <c>?? '—'</c> null handling, its <c>Yes</c> / <c>No</c> boolean rendering, and its
/// <c>software_update_version ?? softwareVersion</c> fallback verbatim. Every label resolves through the i18n
/// facade using the same keys the web feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class VehicleConfigSectionProjection
{
    /// <summary>The em dash (U+2014) the web renders via <c>?? '—'</c> for an absent value.</summary>
    public const string EmptyValue = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props, narrowed to the config fields).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static VehicleConfigSectionDisplay Project(VehicleConfigSectionModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("vehicles.detail.vehicleConfig", "Vehicle Configuration");
        IReadOnlyList<VehicleConfigItem> items = BuildItems(model, localizer);
        VehicleConfigSectionState state = SelectState(model);

        bool showChip = state is VehicleConfigSectionState.Stale or VehicleConfigSectionState.Offline;
        string chipText = state switch
        {
            VehicleConfigSectionState.Offline => localizer.GetString("common.offline", "Offline"),
            VehicleConfigSectionState.Stale => localizer.GetString("common.stale", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == VehicleConfigSectionState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string emptyMessage = localizer.GetString(
            "vehicles.detail.vehicleConfigEmpty", "No vehicle configuration available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string errorTitle = localizer.GetString(
            "vehicles.detail.vehicleConfigError", "Couldn't load vehicle configuration");
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(
                "vehicles.detail.vehicleConfigErrorMessage",
                "We couldn't load this vehicle's configuration. Please try again.")
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string automationName = BuildAutomationName(
            state, title, showChip, chipText, items, emptyMessage, loadingLabel, errorTitle);

        return new VehicleConfigSectionDisplay(
            State: state,
            Title: title,
            Items: items,
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

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a Ready model renders its rows when a snapshot is present and
    // otherwise collapses to the loading skeleton (the web vehicleConfig == null branch).
    private static VehicleConfigSectionState SelectState(VehicleConfigSectionModel model) => model.Status switch
    {
        VehicleConfigSectionState.Loading => VehicleConfigSectionState.Loading,
        VehicleConfigSectionState.Error => VehicleConfigSectionState.Error,
        VehicleConfigSectionState.Empty => VehicleConfigSectionState.Empty,
        VehicleConfigSectionState.Stale => VehicleConfigSectionState.Stale,
        VehicleConfigSectionState.Offline => VehicleConfigSectionState.Offline,
        _ => model.Config is null ? VehicleConfigSectionState.Loading : VehicleConfigSectionState.Ready,
    };

    private static IReadOnlyList<VehicleConfigItem> BuildItems(VehicleConfigSectionModel model, ILocalizer localizer)
    {
        if (model.Config is not { } config)
        {
            return [];
        }

        string yes = localizer.GetString("common.yes", "Yes");
        string no = localizer.GetString("common.no", "No");

        return
        [
            Item(localizer.GetString("vehicles.detail.carType", "Car Type"), Text(config.CarType)),
            Item(localizer.GetString("vehicles.detail.trim", "Trim"), Text(config.Trim)),
            Item(localizer.GetString("vehicles.detail.color", "Exterior Color"), Text(config.ExteriorColor)),
            Item(localizer.GetString("vehicles.detail.wheels", "Wheels"), Text(config.WheelType)),
            Item(localizer.GetString("vehicles.detail.roofColor", "Roof Color"), Text(config.RoofColor)),
            Item(localizer.GetString("vehicles.detail.chargePort", "Charge Port"), Text(config.ChargePort)),
            Item(
                localizer.GetString("vehicles.detail.rhd", "Right-Hand Drive"),
                Bool(config.RightHandDrive, yes, no)),
            Item(
                localizer.GetString("vehicles.detail.europeVehicle", "Europe Vehicle"),
                Bool(config.EuropeVehicle, yes, no)),
            Item(
                localizer.GetString("vehicles.detail.offroadLightbar", "Offroad Lightbar"),
                Bool(config.OffroadLightbarPresent, yes, no)),
            Item(
                localizer.GetString("vehicles.detail.rearSeatHeaters", "Rear Seat Heaters"),
                Text(config.RearSeatHeaters)),
            Item(localizer.GetString("vehicles.detail.sunroofInstalled", "Sunroof"), Text(config.SunroofInstalled)),
            Item(
                localizer.GetString("vehicles.detail.softwareVersion", "Software"),
                Text(config.SoftwareUpdateVersion ?? model.SoftwareVersion)),
        ];
    }

    private static VehicleConfigItem Item(string label, string value) => new(label, value, $"{label}, {value}");

    // web `value ?? '—'`: an absent (null / empty) string renders the em dash.
    private static string Text(string? value) => string.IsNullOrEmpty(value) ? EmptyValue : value;

    // web `flag != null ? (flag ? Yes : No) : '—'`.
    private static string Bool(bool? value, string yes, string no) =>
        value is null ? EmptyValue : (value.Value ? yes : no);

    private static string BuildAutomationName(
        VehicleConfigSectionState state,
        string title,
        bool showChip,
        string chipText,
        IReadOnlyList<VehicleConfigItem> items,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case VehicleConfigSectionState.Loading:
                return $"{title}. {loadingLabel}";
            case VehicleConfigSectionState.Empty:
                return $"{title}. {emptyMessage}";
            case VehicleConfigSectionState.Error:
                return $"{title}. {errorTitle}";
            default:
                var parts = new List<string> { title };
                if (showChip)
                {
                    parts.Add(chipText);
                }

                foreach (var item in items)
                {
                    parts.Add(item.AutomationName);
                }

                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>VehicleConfigSection</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a VIN, trim, colour or software
/// version — so a diagnostics line can never leak a vehicle's identity or configuration. Thread-safe.
/// </summary>
public sealed class VehicleConfigSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehicleConfigSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleConfigSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleConfigSectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>VehicleConfigSection</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx</c>.
/// </summary>
public static class VehicleConfigSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleConfigSection";
}
