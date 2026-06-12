using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The render scale of the digital-twin schematic — the native mirror of the web
/// <c>size = 'sm' | 'md' | 'lg'</c> prop (web/src/components/vehicles/VehicleTwin.tsx <c>SIZE_MAP</c>). It maps to
/// the logical-pixel width the (square-ish) twin canvas is drawn at; the height follows from the fixed aspect
/// ratio of the hosted <c>TsVehicleTwin</c> visual. Pure data so the size math is unit-tested without a UI host.
/// </summary>
public enum VehicleTwinSize
{
    /// <summary>web <c>'sm'</c> — 300px wide.</summary>
    Small,

    /// <summary>web <c>'md'</c> — 440px wide (the default).</summary>
    Medium,

    /// <summary>web <c>'lg'</c> — 560px wide.</summary>
    Large,
}

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="VehicleTwinViewModel"/> can be in — the native union of
/// the loading / loaded / empty / error / stale / offline branches a live digital-twin surface renders. Every
/// branch maps onto a visible surface; none is ever hidden. <see cref="Empty"/> is the "no vehicle resolved"
/// branch (a friendly empty state, never a blank box); the twin itself always renders once a reading resolves.
/// </summary>
public enum VehicleTwinViewState
{
    /// <summary>Initial fetch with no cached reading — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A reading resolved and a fresh (or non-stale cache) twin is rendered.</summary>
    Loaded,

    /// <summary>No vehicle / reading resolved — render the friendly empty state.</summary>
    Empty,

    /// <summary>The read failed hard with nothing to show — render the retry affordance.</summary>
    Error,

    /// <summary>A cached reading older than the freshness window — render the twin plus a stale chip.</summary>
    Stale,

    /// <summary>The read failed but a cached twin is still renderable — render the twin plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One live reading of a vehicle's physical state for the digital-twin surface — the native analogue of the web
/// component's resolved inputs (the <c>VehicleTwinState</c> props plus the vehicle identity the surrounding card
/// supplies). <see cref="Twin"/> carries the door / window / lock / charge / lighting state; the identity fields
/// drive the caption and the per-vehicle paint resolution (web <c>useVehiclePaint(vehicleId, exteriorColor)</c>).
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Twin">The reported physical state bound to the hosted <c>TsVehicleTwin</c> visual.</param>
/// <param name="VehicleId">The resolved vehicle id keying the paint override (web <c>vehicleId</c>), or null.</param>
/// <param name="DisplayName">The vehicle display name shown in the caption, or null.</param>
/// <param name="Vin">The VIN used as the caption fallback when no display name exists, or null.</param>
public sealed record VehicleTwinReading(
    VehicleTwinModel Twin,
    long? VehicleId,
    string? DisplayName,
    string? Vin)
{
    /// <summary>The caption line shown under the twin (web <c>display_name || vin</c>); empty when neither exists.</summary>
    public string Caption =>
        !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName!
        : !string.IsNullOrWhiteSpace(Vin) ? Vin!
        : string.Empty;
}

/// <summary>
/// One projected status chip in the twin status cluster — the native analogue of a web <c>&lt;Badge&gt;</c>. The
/// chip surfaces a single reported state (lock, windows, charging, …) both visually (a tinted, optionally
/// dotted chip) and to Narrator (its <see cref="Text"/> is read out). Pure data.
/// </summary>
/// <param name="Kind">Stable identifier for the chip (e.g. <c>lock</c>, <c>windows</c>, <c>driving</c>).</param>
/// <param name="Variant">The semantic colour the chip is tinted with.</param>
/// <param name="Dot">Whether a leading status dot is shown.</param>
/// <param name="Glyph">An optional leading Segoe Fluent glyph, or null.</param>
/// <param name="Text">The localized chip label.</param>
public sealed record VehicleTwinStatusChip(string Kind, StatusKind Variant, bool Dot, string? Glyph, string Text);

/// <summary>
/// The fully projected, render-ready view of the digital-twin surface — everything the view needs computed off
/// the UI thread: the twin model bound to the hosted visual, the resolved paint (web <c>useVehiclePaint</c>),
/// the render scale, the caption, the active status chips and the composed Narrator description. Pure data so it
/// is asserted in tests without a UI host.
/// </summary>
/// <param name="Model">The twin model bound to <c>TsVehicleTwin</c>.</param>
/// <param name="Paint">The resolved paint palette (override &gt; inferred &gt; fallback).</param>
/// <param name="IsOverridden">True when a manual per-vehicle paint override is in effect (web <c>isOverridden</c>).</param>
/// <param name="Size">The render scale the twin canvas is drawn at.</param>
/// <param name="Caption">The caption line (display name or VIN), or empty.</param>
/// <param name="Chips">The ordered, active status chips (web conditional indicator cluster).</param>
/// <param name="AutomationName">The Narrator summary naming the surface, the vehicle and every active chip.</param>
public sealed record VehicleTwinDisplay(
    VehicleTwinModel Model,
    PaintPalette Paint,
    bool IsOverridden,
    VehicleTwinSize Size,
    string Caption,
    IReadOnlyList<VehicleTwinStatusChip> Chips,
    string AutomationName);

/// <summary>
/// Canonical metadata for the <c>VehicleTwin</c> shared surface — the diagnostics slug, the root automation id,
/// the logical canvas dimensions, the per-size canvas widths (web <c>SIZE_MAP</c>) and the i18n keys (each with
/// the verbatim English fallback the surface renders through the P1/S10 facade) for the loading / empty / error
/// chrome, the freshness chips and the status-cluster labels. UI-free so it is asserted in tests.
/// </summary>
public static class VehicleTwinRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "VehicleTwin";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "vehicle-twin-surface";

    /// <summary>The hosted visual's logical canvas width (matches <c>TsVehicleTwin</c>).</summary>
    public const double LogicalWidth = 560;

    /// <summary>The hosted visual's logical canvas height (matches <c>TsVehicleTwin</c>).</summary>
    public const double LogicalHeight = 220;

    /// <summary>i18n key + fallback for the loading announcement.</summary>
    public const string LoadingKey = "vehicle.twin.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading vehicle state";

    /// <summary>i18n key for the empty-state heading.</summary>
    public const string EmptyTitleKey = "vehicle.twin.empty.title";

    /// <summary>English fallback for <see cref="EmptyTitleKey"/>.</summary>
    public const string EmptyTitleFallback = "No vehicle data";

    /// <summary>i18n key for the empty-state message.</summary>
    public const string EmptyMessageKey = "vehicle.twin.empty.message";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "Connect a vehicle to see its live digital twin";

    /// <summary>i18n key for the generic load-failure message.</summary>
    public const string ErrorKey = "vehicle.twin.error";

    /// <summary>English fallback for <see cref="ErrorKey"/>.</summary>
    public const string ErrorFallback = "Couldn't load vehicle state";

    /// <summary>i18n key for the offline / network failure message.</summary>
    public const string ErrorOfflineKey = "vehicle.twin.error.offline";

    /// <summary>English fallback for <see cref="ErrorOfflineKey"/>.</summary>
    public const string ErrorOfflineFallback = "You're offline — showing the last known vehicle state";

    /// <summary>i18n key for the unauthorized failure message.</summary>
    public const string ErrorAuthKey = "vehicle.twin.error.auth";

    /// <summary>English fallback for <see cref="ErrorAuthKey"/>.</summary>
    public const string ErrorAuthFallback = "Sign in to view vehicle state";

    /// <summary>i18n key for the retry affordance label.</summary>
    public const string RetryKey = "common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the stale-data chip.</summary>
    public const string StaleKey = "vehicle.twin.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>i18n key for the offline chip.</summary>
    public const string OfflineKey = "vehicle.twin.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>i18n key for the refreshing chip.</summary>
    public const string RefreshingKey = "vehicle.twin.refreshing";

    /// <summary>English fallback for <see cref="RefreshingKey"/>.</summary>
    public const string RefreshingFallback = "Refreshing";

    /// <summary>i18n key for the composed accessible-description prefix.</summary>
    public const string AriaKey = "vehicle.twin.aria";

    /// <summary>English fallback for <see cref="AriaKey"/> — the surface role read before the state fragments.</summary>
    public const string AriaFallback = "Vehicle digital twin";

    /// <summary>The logical-pixel width the twin canvas is drawn at for <paramref name="size"/> (web <c>SIZE_MAP</c>).</summary>
    /// <param name="size">The render scale.</param>
    public static double Width(VehicleTwinSize size) => size switch
    {
        VehicleTwinSize.Small => 300,
        VehicleTwinSize.Large => 560,
        _ => 440,
    };
}

/// <summary>
/// PII-safe diagnostics for the <c>VehicleTwin</c> surface (P1/S11 diagnostics contract). The twin carries fleet
/// state (door / lock / charge), so the collector records ONLY the operational <c>view.opened</c> event with the
/// surface slug — never a vehicle id, VIN or any reported state — so a diagnostics line can never leak fleet
/// data. Thread-safe; mirrors the peer surfaces' collectors.
/// </summary>
public sealed class VehicleTwinDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public VehicleTwinDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleTwin</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleTwinRegistration.Slug}");
    }
}

/// <summary>
/// Pure projection from a <see cref="VehicleTwinReading"/> (plus the active paint override) to the render-ready
/// <see cref="VehicleTwinDisplay"/> — the native port of the web component's paint resolution
/// (<c>useVehiclePaint</c>) and the implicit status the schematic conveys. The lock and windows chips always
/// render; the driving / charging / sentry / lights / hazards / doors / frunk / trunk chips render only when
/// their state is reported active. Every label resolves through the i18n facade. UI-free.
/// </summary>
public static class VehicleTwinProjection
{
    /// <summary>Segoe Fluent "Lock" glyph (locked / unknown lock chip).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>Segoe Fluent "Unlock" glyph (unlocked lock chip).</summary>
    public const string UnlockGlyph = "\uE785";

    /// <summary>
    /// Resolve the active paint exactly as the web <c>useVehiclePaint</c> hook does: a manual per-vehicle
    /// <paramref name="overrideId"/> wins; otherwise the paint is inferred from the Tesla
    /// <paramref name="exteriorColor"/> code (which itself falls back to Pearl White when missing / unrecognised).
    /// </summary>
    /// <param name="overrideId">The persisted manual override id, or null for auto-detection.</param>
    /// <param name="exteriorColor">The Tesla <c>exterior_color</c> code, or null.</param>
    /// <returns>The resolved palette and whether a manual override is in effect.</returns>
    public static (PaintPalette Paint, bool IsOverridden) ResolvePaint(PaintPaletteId? overrideId, string? exteriorColor) =>
        overrideId is { } id
            ? (PaintPalettes.ById(id), true)
            : (PaintPalettes.InferFromTesla(exteriorColor), false);

    /// <summary>Project <paramref name="reading"/> for the given override, size and localizer.</summary>
    /// <param name="reading">The resolved live twin reading.</param>
    /// <param name="overrideId">The persisted manual paint override id, or null.</param>
    /// <param name="size">The render scale.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static VehicleTwinDisplay Project(
        VehicleTwinReading reading,
        PaintPaletteId? overrideId,
        VehicleTwinSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        VehicleTwinModel model = reading.Twin;
        (PaintPalette paint, bool overridden) = ResolvePaint(overrideId, model.ExteriorColor);
        IReadOnlyList<VehicleTwinStatusChip> chips = BuildChips(model, localizer);

        return new VehicleTwinDisplay(
            model,
            paint,
            overridden,
            size,
            reading.Caption,
            chips,
            BuildAutomationName(reading.Caption, chips, localizer));
    }

    /// <summary>The ordered status chips for a model — lock + windows always, then the active-only indicators.</summary>
    /// <param name="model">The twin model.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The ordered chip list.</returns>
    public static IReadOnlyList<VehicleTwinStatusChip> BuildChips(VehicleTwinModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var chips = new List<VehicleTwinStatusChip>(10)
        {
            LockChip(model.Locked, localizer),
            WindowsChip(model, localizer),
        };

        if (model.IsDriving)
        {
            chips.Add(new VehicleTwinStatusChip("driving", StatusKind.Info, true, null, localizer.GetString("vehicle.twin.driving", "Driving")));
        }

        if (model.IsCharging)
        {
            chips.Add(new VehicleTwinStatusChip("charging", StatusKind.Success, true, null, localizer.GetString("vehicle.twin.charging", "Charging")));
        }

        if (model.SentryMode == true)
        {
            chips.Add(new VehicleTwinStatusChip("sentry", StatusKind.Warning, true, null, localizer.GetString("vehicle.twin.sentry", "Sentry")));
        }

        if (model.Headlights == true)
        {
            chips.Add(new VehicleTwinStatusChip("headlights", StatusKind.Neutral, true, null, localizer.GetString("vehicle.twin.lightsOn", "Lights On")));
        }

        if (model.TurnSignal == TurnSignal.Both)
        {
            chips.Add(new VehicleTwinStatusChip("hazards", StatusKind.Warning, true, null, localizer.GetString("vehicle.twin.hazardsOn", "Hazards")));
        }

        int openDoors = OpenDoorCount(model);
        if (openDoors > 0)
        {
            string label = string.Create(
                CultureInfo.CurrentCulture,
                $"{openDoors} {localizer.GetString("vehicle.twin.doorsOpen", "Doors Open")}");
            chips.Add(new VehicleTwinStatusChip("doors", StatusKind.Warning, false, null, label));
        }

        if (model.FrunkOpen == true)
        {
            chips.Add(new VehicleTwinStatusChip("frunk", StatusKind.Warning, false, null, localizer.GetString("vehicle.twin.frunkOpen", "Frunk Open")));
        }

        if (model.TrunkOpen == true)
        {
            chips.Add(new VehicleTwinStatusChip("trunk", StatusKind.Warning, false, null, localizer.GetString("vehicle.twin.trunkOpen", "Trunk Open")));
        }

        return chips;
    }

    /// <summary>The number of side doors reported open.</summary>
    /// <param name="model">The twin model.</param>
    public static int OpenDoorCount(VehicleTwinModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        int count = 0;
        if (model.DoorDriverFront == true)
        {
            count++;
        }

        if (model.DoorPassengerFront == true)
        {
            count++;
        }

        if (model.DoorDriverRear == true)
        {
            count++;
        }

        if (model.DoorPassengerRear == true)
        {
            count++;
        }

        return count;
    }

    /// <summary>True when at least one window position is reported.</summary>
    /// <param name="model">The twin model.</param>
    public static bool HasWindowData(VehicleTwinModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        return model.WindowDriverFront != WindowPosition.Unknown ||
            model.WindowPassengerFront != WindowPosition.Unknown ||
            model.WindowDriverRear != WindowPosition.Unknown ||
            model.WindowPassengerRear != WindowPosition.Unknown;
    }

    /// <summary>The number of windows reported open or partially open.</summary>
    /// <param name="model">The twin model.</param>
    public static int OpenWindowCount(VehicleTwinModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        return CountOpen(model.WindowDriverFront) + CountOpen(model.WindowPassengerFront) +
            CountOpen(model.WindowDriverRear) + CountOpen(model.WindowPassengerRear);
    }

    private static int CountOpen(WindowPosition position) =>
        position is not WindowPosition.Unknown and not WindowPosition.Closed ? 1 : 0;

    private static VehicleTwinStatusChip LockChip(bool? locked, ILocalizer localizer)
    {
        StatusKind variant = locked is null ? StatusKind.Neutral : locked.Value ? StatusKind.Success : StatusKind.Danger;
        string label = locked is null
            ? localizer.GetString("vehicle.twin.lockUnknown", "Lock Unknown")
            : locked.Value
                ? localizer.GetString("vehicle.twin.locked", "Locked")
                : localizer.GetString("vehicle.twin.unlocked", "Unlocked");
        string glyph = locked == false ? UnlockGlyph : LockGlyph;
        return new VehicleTwinStatusChip("lock", variant, false, glyph, label);
    }

    private static VehicleTwinStatusChip WindowsChip(VehicleTwinModel model, ILocalizer localizer)
    {
        bool hasData = HasWindowData(model);
        int openCount = OpenWindowCount(model);
        StatusKind variant = !hasData ? StatusKind.Neutral : openCount == 0 ? StatusKind.Success : StatusKind.Warning;
        string label = !hasData
            ? localizer.GetString("vehicle.twin.windowsUnknown", "Windows Unknown")
            : openCount == 0
                ? localizer.GetString("vehicle.twin.windowsClosed", "Windows Closed")
                : string.Create(
                    CultureInfo.CurrentCulture,
                    $"{openCount} {localizer.GetString("vehicle.twin.windowsOpen", "Open")}");
        return new VehicleTwinStatusChip("windows", variant, false, null, label);
    }

    private static string BuildAutomationName(
        string caption,
        IReadOnlyList<VehicleTwinStatusChip> chips,
        ILocalizer localizer)
    {
        string role = localizer.GetString(VehicleTwinRegistration.AriaKey, VehicleTwinRegistration.AriaFallback);
        string status = string.Join(", ", chips.Select(c => c.Text));
        string subject = string.IsNullOrWhiteSpace(caption) ? role : $"{role}, {caption}";
        return string.IsNullOrEmpty(status) ? subject : $"{subject}: {status}";
    }
}
