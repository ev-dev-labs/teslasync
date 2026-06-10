using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.IngestXRay;

/// <summary>
/// The lifecycle of the parent vehicle query that feeds the X-Ray controls — the native analogue of the
/// web page's <c>useVehicles()</c> result (<c>web/src/features/admin/pages/IngestXRayPage.tsx</c> passes
/// <c>vehicles.data ?? []</c> into <c>XRayControls</c>). The web control is purely presentational and only
/// ever receives the resolved list, so this status is a native superset that lets the self-contained surface
/// reflect the real cache-then-network states the page owns (loading / stale / offline / error) on the
/// vehicle picker without ever fabricating data. The window and bucket selectors never depend on it.
/// </summary>
public enum XRayVehiclesStatus
{
    /// <summary>The fleet read is in flight with nothing cached yet (web <c>vehicles.isLoading</c>).</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) fleet result — the default the web always receives.</summary>
    Resolved,

    /// <summary>A cached fleet older than the freshness window — the list shows with a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached fleet remains — the list shows with an offline chip.</summary>
    Offline,

    /// <summary>The fleet read failed with nothing cached — the picker shows an error with retry.</summary>
    Error,
}

/// <summary>
/// The mutually-exclusive render branch of the <c>XRayControls</c> surface. The web source is a pure
/// controlled component (it receives <c>vehicles</c> + the current selections as props and emits change
/// callbacks; it performs no fetching), so its only intrinsic distinction is vehicles-present vs.
/// vehicles-empty. The remaining branches are a native superset driven by <see cref="XRayVehiclesStatus"/>
/// — the cache-then-network lifecycle the parent <c>IngestXRayPage</c> owns. Every branch maps onto a
/// visible surface; the window and bucket selectors stay interactive in all of them (web parity — they are
/// client-static and never gated on the fetch). None is ever hidden.
/// </summary>
public enum XRayControlsState
{
    /// <summary>The fleet is loading — the vehicle picker is disabled with a "Loading…" hint.</summary>
    Loading,

    /// <summary>Vehicles are present — all three selectors are interactive (the web's normal render).</summary>
    Ready,

    /// <summary>The fleet resolved with no vehicles — the picker shows the prompt plus a friendly hint.</summary>
    Empty,

    /// <summary>A cached fleet past the freshness window — the controls plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached fleet is shown — the controls plus an offline chip.</summary>
    Offline,

    /// <summary>The fleet read failed with nothing cached — the picker shows an error plus a retry.</summary>
    Error,
}

/// <summary>
/// The render-time data model the <c>XRayControls</c> view binds to — the native analogue of the web
/// <c>XRayControlsProps</c> (<c>vehicles</c>, <c>vehicleId</c>, <c>windowSel</c>, <c>bucketSel</c>) plus the
/// superset <see cref="VehiclesStatus"/>. The component is controlled: this model carries the selections and
/// the fleet the parent supplies; the surface never performs HTTP and never mutates the model — it raises
/// change events the host applies. Pure data — no WinUI types — so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="Vehicles">The fleet to offer in the vehicle picker (web <c>vehicles</c>).</param>
/// <param name="VehicleId">The selected vehicle id, or null for none (web <c>vehicleId</c>).</param>
/// <param name="Window">The selected rolling window (web <c>windowSel</c>).</param>
/// <param name="Bucket">The selected bucket granularity (web <c>bucketSel</c>).</param>
/// <param name="VehiclesStatus">The parent fleet-query lifecycle (native superset; default resolved).</param>
public sealed record XRayControlsModel(
    IReadOnlyList<VehicleOption> Vehicles,
    int? VehicleId,
    IngestXRayWindow Window,
    IngestXRayBucket Bucket,
    XRayVehiclesStatus VehiclesStatus = XRayVehiclesStatus.Resolved)
{
    /// <summary>The initial model: the first fleet read is in flight and no selection has been made.</summary>
    public static XRayControlsModel Initial { get; } = new(
        Array.Empty<VehicleOption>(),
        null,
        IngestXRayWindow.H1,
        IngestXRayBucket.M1,
        XRayVehiclesStatus.Loading);
}

/// <summary>
/// The five rolling windows the X-Ray offers, with their durations — the native port of the web
/// <c>ALL_WINDOWS</c> array and the <c>WINDOW_SECS</c> map. The durations drive the bucket auto-disable rule
/// (a bucket &gt;= the window is invalid server-side). Pure — unit-tested without a UI host.
/// </summary>
public static class XRayControlsWindows
{
    /// <summary>The offered windows in display order (web <c>ALL_WINDOWS</c>).</summary>
    public static IReadOnlyList<IngestXRayWindow> All { get; } = new[]
    {
        IngestXRayWindow.M5,
        IngestXRayWindow.M15,
        IngestXRayWindow.H1,
        IngestXRayWindow.H6,
        IngestXRayWindow.H24,
    };

    /// <summary>The window duration in seconds (web <c>WINDOW_SECS</c>).</summary>
    public static int Seconds(IngestXRayWindow window) => window switch
    {
        IngestXRayWindow.M5 => 5 * 60,
        IngestXRayWindow.M15 => 15 * 60,
        IngestXRayWindow.H1 => 60 * 60,
        IngestXRayWindow.H6 => 6 * 60 * 60,
        IngestXRayWindow.H24 => 24 * 60 * 60,
        _ => 60 * 60,
    };
}

/// <summary>
/// The five bucket granularities the X-Ray offers, with their durations — the native port of the web
/// <c>ALL_BUCKETS</c> array and the <c>BUCKET_SECS</c> map, plus a wire parser for the change path. Pure —
/// unit-tested without a UI host.
/// </summary>
public static class XRayControlsBuckets
{
    /// <summary>The offered buckets in display order (web <c>ALL_BUCKETS</c>).</summary>
    public static IReadOnlyList<IngestXRayBucket> All { get; } = new[]
    {
        IngestXRayBucket.S30,
        IngestXRayBucket.M1,
        IngestXRayBucket.M5,
        IngestXRayBucket.M15,
        IngestXRayBucket.H1,
    };

    /// <summary>The bucket duration in seconds (web <c>BUCKET_SECS</c>).</summary>
    public static int Seconds(IngestXRayBucket bucket) => bucket switch
    {
        IngestXRayBucket.S30 => 30,
        IngestXRayBucket.M1 => 60,
        IngestXRayBucket.M5 => 5 * 60,
        IngestXRayBucket.M15 => 15 * 60,
        IngestXRayBucket.H1 => 60 * 60,
        _ => 60,
    };

    /// <summary>Parse a server wire literal back to a bucket, defaulting to <see cref="IngestXRayBucket.M1"/>.</summary>
    public static IngestXRayBucket FromWire(string? wire) => wire switch
    {
        "30s" => IngestXRayBucket.S30,
        "1m" => IngestXRayBucket.M1,
        "5m" => IngestXRayBucket.M5,
        "15m" => IngestXRayBucket.M15,
        "1h" => IngestXRayBucket.H1,
        _ => IngestXRayBucket.M1,
    };
}

/// <summary>
/// The fully projected, render-ready view of the controls bar for one input model — the native analogue of
/// what the web <c>XRayControls</c> renders. Holds the three option lists (the bucket options carry the
/// per-window <c>disabled</c> flags), the selected wire values, the localized field/aria labels and prompt,
/// the active <see cref="State"/>, the optional status chip / hint / retry copy, and the surface automation
/// name. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record XRayControlsDisplay(
    XRayControlsState State,
    IReadOnlyList<ComboOption> VehicleOptions,
    IReadOnlyList<ComboOption> WindowOptions,
    IReadOnlyList<ComboOption> BucketOptions,
    string SelectedVehicleValue,
    string SelectedWindowValue,
    string SelectedBucketValue,
    bool VehiclePickerEnabled,
    string VehicleLabel,
    string WindowLabel,
    string BucketLabel,
    string VehiclePrompt,
    string? StatusChip,
    StatusKind StatusChipKind,
    string? Hint,
    string? RetryLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="XRayControlsModel"/> to its <see cref="XRayControlsDisplay"/> — the
/// native port of <c>web/src/features/admin/components/ingest-xray/XRayControls.tsx</c>. It builds the three
/// option lists exactly as the web does — the vehicle picker's "Select vehicle…" prompt plus one option per
/// vehicle labelled <c>display_name || vin || "Vehicle {id}"</c>, the five window options, and the five
/// bucket options each disabled when its granularity is &gt;= the selected window (the web
/// <c>BUCKET_SECS[b] &gt;= WINDOW_SECS[windowSel]</c> guard against the server-side 400) — selects the render
/// branch from the fleet status, and resolves every label through the i18n facade. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class XRayControlsProjection
{
    /// <summary>i18n key prefix for the per-window option label (web <c>admin.xray.windowOption.{w}</c>).</summary>
    public const string WindowOptionKeyPrefix = "translation.admin.xray.windowOption.";

    /// <summary>i18n key prefix for the per-bucket option label (web <c>admin.xray.bucketOption.{b}</c>).</summary>
    public const string BucketOptionKeyPrefix = "translation.admin.xray.bucketOption.";

    private const string SelectVehicleKey = "translation.admin.xray.controls.selectVehicle";
    private const string VehicleAriaKey = "translation.admin.xray.controls.vehicleAria";
    private const string WindowAriaKey = "translation.admin.xray.controls.windowAria";
    private const string BucketAriaKey = "translation.admin.xray.controls.bucketAria";
    private const string LoadingKey = "translation.admin.xray.controls.loading";
    private const string EmptyMessageKey = "translation.admin.xray.controls.emptyMessage";
    private const string StaleKey = "translation.admin.xray.controls.stale";
    private const string OfflineKey = "translation.admin.xray.controls.offline";
    private const string ErrorKey = "translation.admin.xray.controls.error";
    private const string RetryKey = "translation.admin.xray.controls.retry";

    private const string SelectVehicleFallback = "Select vehicle\u2026";
    private const string VehicleAriaFallback = "Vehicle";
    private const string WindowAriaFallback = "Window";
    private const string BucketAriaFallback = "Bucket";
    private const string LoadingFallback = "Loading vehicles\u2026";
    private const string EmptyMessageFallback =
        "No vehicles are linked yet. Add a vehicle to inspect its ingest X-Ray.";
    private const string StaleFallback = "Stale";
    private const string OfflineFallback = "Offline";
    private const string ErrorFallback = "Couldn\u2019t load vehicles";
    private const string RetryFallback = "Try again";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static XRayControlsDisplay Project(XRayControlsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string vehicleLabel = localizer.GetString(VehicleAriaKey, VehicleAriaFallback);
        string windowLabel = localizer.GetString(WindowAriaKey, WindowAriaFallback);
        string bucketLabel = localizer.GetString(BucketAriaKey, BucketAriaFallback);
        string prompt = localizer.GetString(SelectVehicleKey, SelectVehicleFallback);

        IReadOnlyList<ComboOption> vehicleOptions = BuildVehicleOptions(model.Vehicles, prompt, vehicleLabel);
        IReadOnlyList<ComboOption> windowOptions = BuildWindowOptions(localizer);
        IReadOnlyList<ComboOption> bucketOptions = BuildBucketOptions(model.Window, localizer);

        string selectedVehicle = model.VehicleId is { } id
            ? id.ToString(CultureInfo.InvariantCulture)
            : string.Empty;
        string selectedWindow = IngestXRayWindows.Wire(model.Window);
        string selectedBucket = IngestXRayBuckets.Wire(model.Bucket);

        XRayControlsState state = SelectState(model);
        bool pickerEnabled = state is not (XRayControlsState.Loading or XRayControlsState.Error);

        string? chip = state switch
        {
            XRayControlsState.Stale => localizer.GetString(StaleKey, StaleFallback),
            XRayControlsState.Offline => localizer.GetString(OfflineKey, OfflineFallback),
            _ => null,
        };
        StatusKind chipKind = state == XRayControlsState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string? hint = state switch
        {
            XRayControlsState.Loading => localizer.GetString(LoadingKey, LoadingFallback),
            XRayControlsState.Empty => localizer.GetString(EmptyMessageKey, EmptyMessageFallback),
            XRayControlsState.Error => localizer.GetString(ErrorKey, ErrorFallback),
            _ => null,
        };
        string? retry = state == XRayControlsState.Error
            ? localizer.GetString(RetryKey, RetryFallback)
            : null;

        return new XRayControlsDisplay(
            State: state,
            VehicleOptions: vehicleOptions,
            WindowOptions: windowOptions,
            BucketOptions: bucketOptions,
            SelectedVehicleValue: selectedVehicle,
            SelectedWindowValue: selectedWindow,
            SelectedBucketValue: selectedBucket,
            VehiclePickerEnabled: pickerEnabled,
            VehicleLabel: vehicleLabel,
            WindowLabel: windowLabel,
            BucketLabel: bucketLabel,
            VehiclePrompt: prompt,
            StatusChip: chip,
            StatusChipKind: chipKind,
            Hint: hint,
            RetryLabel: retry,
            AutomationName: BuildAutomationName(state, vehicleLabel, windowLabel, bucketLabel, hint, chip));
    }

    /// <summary>The mapped render branch for <paramref name="model"/> (fleet status, then vehicle count).</summary>
    public static XRayControlsState SelectState(XRayControlsModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        return model.VehiclesStatus switch
        {
            XRayVehiclesStatus.Loading => XRayControlsState.Loading,
            XRayVehiclesStatus.Stale => XRayControlsState.Stale,
            XRayVehiclesStatus.Offline => XRayControlsState.Offline,
            XRayVehiclesStatus.Error => XRayControlsState.Error,
            _ => model.Vehicles.Count > 0 ? XRayControlsState.Ready : XRayControlsState.Empty,
        };
    }

    /// <summary>True when the bucket is invalid for the window (web <c>BUCKET_SECS[b] &gt;= WINDOW_SECS[w]</c>).</summary>
    public static bool IsBucketDisabled(IngestXRayBucket bucket, IngestXRayWindow window) =>
        XRayControlsBuckets.Seconds(bucket) >= XRayControlsWindows.Seconds(window);

    // Web parity: [{ value: '', label: t('…selectVehicle') }, ...vehicles.map(v => ({ value: String(v.id),
    // label: v.display_name || v.vin || `Vehicle ${v.id}` }))]. VehicleLabels.Short reproduces that label rule.
    private static List<ComboOption> BuildVehicleOptions(
        IReadOnlyList<VehicleOption> vehicles,
        string prompt,
        string vehicleWord)
    {
        var options = new List<ComboOption>(vehicles.Count + 1)
        {
            new(string.Empty, prompt),
        };

        foreach (var vehicle in vehicles)
        {
            options.Add(new ComboOption(
                vehicle.Id.ToString(CultureInfo.InvariantCulture),
                VehicleLabels.Short(vehicle, vehicleWord)));
        }

        return options;
    }

    // Web parity: ALL_WINDOWS.map(w => ({ value: w, label: t(`admin.xray.windowOption.${w}`, w) })).
    private static List<ComboOption> BuildWindowOptions(ILocalizer localizer)
    {
        var options = new List<ComboOption>(XRayControlsWindows.All.Count);
        foreach (var window in XRayControlsWindows.All)
        {
            string wire = IngestXRayWindows.Wire(window);
            options.Add(new ComboOption(wire, localizer.GetString(WindowOptionKeyPrefix + wire, wire)));
        }

        return options;
    }

    // Web parity: ALL_BUCKETS.map(b => ({ value: b, label: t(`admin.xray.bucketOption.${b}`, b),
    // disabled: BUCKET_SECS[b] >= WINDOW_SECS[windowSel] })).
    private static List<ComboOption> BuildBucketOptions(IngestXRayWindow window, ILocalizer localizer)
    {
        var options = new List<ComboOption>(XRayControlsBuckets.All.Count);
        foreach (var bucket in XRayControlsBuckets.All)
        {
            string wire = IngestXRayBuckets.Wire(bucket);
            options.Add(new ComboOption(
                wire,
                localizer.GetString(BucketOptionKeyPrefix + wire, wire),
                IsBucketDisabled(bucket, window)));
        }

        return options;
    }

    private static string BuildAutomationName(
        XRayControlsState state,
        string vehicleLabel,
        string windowLabel,
        string bucketLabel,
        string? hint,
        string? chip)
    {
        string controls = string.Create(
            CultureInfo.CurrentCulture,
            $"{vehicleLabel}. {windowLabel}. {bucketLabel}.");

        if (!string.IsNullOrEmpty(hint))
        {
            return string.Create(CultureInfo.CurrentCulture, $"{controls} {hint}");
        }

        if (!string.IsNullOrEmpty(chip))
        {
            return string.Create(CultureInfo.CurrentCulture, $"{controls} {chip}");
        }

        return controls;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>XRayControls</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, window or bucket — so a
/// diagnostics line can never leak which vehicle an operator inspected. Thread-safe.
/// </summary>
public sealed class XRayControlsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public XRayControlsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=XRayControls</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={XRayControlsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>XRayControls</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/admin/components/ingest-xray/XRayControls.tsx</c>.
/// </summary>
public static class XRayControlsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "XRayControls";
}
