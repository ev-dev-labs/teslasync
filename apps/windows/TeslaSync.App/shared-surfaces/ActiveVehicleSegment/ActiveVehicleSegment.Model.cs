using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the ActiveVehicleSegment surface — the native mirror of the module-level
/// identity in the web source (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx). The web component
/// is the footer status-bar segment that shows the currently selected vehicle (plus an optional live
/// battery / range read-out) and, for multi-vehicle accounts, opens a popover to switch between them. This
/// metadata carries the diagnostics slug the surface registers under, the stable automation id, the Segoe Fluent
/// glyphs standing in for the web Lucide icons (Car / ChevronUp / Check), the middle-dot separator the web body
/// composes its tooltip and metrics with, and the five i18n keys the web source passes to <c>t()</c> — each with
/// the English fallback the web renders verbatim. Every key carries the <c>translation.</c> catalog prefix the
/// WinUI resource bridge expects and resolves against the English fallback headlessly. UI-free so it is asserted
/// without a XAML host.
/// </summary>
public static class ActiveVehicleSegmentRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ActiveVehicleSegment";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "active-vehicle-segment";

    /// <summary>Segoe Fluent "Car" glyph — the native stand-in for the web Lucide <c>Car</c> icon.</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Segoe Fluent "ChevronUp" glyph — the native stand-in for the web Lucide <c>ChevronUp</c> icon.</summary>
    public const string ChevronUpGlyph = "\uE70E";

    /// <summary>Segoe Fluent "CheckMark" glyph — the native stand-in for the web Lucide <c>Check</c> icon.</summary>
    public const string CheckGlyph = "\uE73E";

    /// <summary>The middle dot separating the label from the sub-label / metrics (web <c>'· '</c>).</summary>
    public const string MiddleDot = "\u00B7";

    /// <summary>i18n key for the numeric fallback label word (web <c>t('statusBar.vehicle.fallback', 'Vehicle')</c>).</summary>
    public const string FallbackKey = "translation.statusBar.vehicle.fallback";

    /// <summary>English fallback for <see cref="FallbackKey"/> — the web literal.</summary>
    public const string FallbackFallback = "Vehicle";

    /// <summary>i18n key for the no-selection label (web <c>t('statusBar.vehicle.none', 'No vehicle')</c>).</summary>
    public const string NoneKey = "translation.statusBar.vehicle.none";

    /// <summary>English fallback for <see cref="NoneKey"/> — the web literal.</summary>
    public const string NoneFallback = "No vehicle";

    /// <summary>i18n key for the tooltip prefix (web <c>t('statusBar.vehicle.tooltip', 'Active vehicle')</c>).</summary>
    public const string TooltipKey = "translation.statusBar.vehicle.tooltip";

    /// <summary>English fallback for <see cref="TooltipKey"/> — the web literal.</summary>
    public const string TooltipFallback = "Active vehicle";

    /// <summary>i18n key for the accessible-name prefix / popover label (web <c>t('statusBar.vehicle.aria', 'Active vehicle')</c>).</summary>
    public const string AriaKey = "translation.statusBar.vehicle.aria";

    /// <summary>English fallback for <see cref="AriaKey"/> — the web literal.</summary>
    public const string AriaFallback = "Active vehicle";

    /// <summary>i18n key for the switcher accessible-name prefix (web <c>t('statusBar.vehicle.switch', 'Switch vehicle')</c>).</summary>
    public const string SwitchKey = "translation.statusBar.vehicle.switch";

    /// <summary>English fallback for <see cref="SwitchKey"/> — the web literal.</summary>
    public const string SwitchFallback = "Switch vehicle";

    /// <summary>Resolve the localized numeric-fallback word (web <c>t('statusBar.vehicle.fallback', …)</c>).</summary>
    /// <param name="localizer">The i18n facade the word resolves through.</param>
    public static string Fallback(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(FallbackKey, FallbackFallback);
    }

    /// <summary>Resolve the localized no-selection label (web <c>t('statusBar.vehicle.none', …)</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string None(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(NoneKey, NoneFallback);
    }

    /// <summary>Resolve the localized tooltip prefix (web <c>t('statusBar.vehicle.tooltip', …)</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string Tooltip(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TooltipKey, TooltipFallback);
    }

    /// <summary>Resolve the localized accessible-name prefix / popover label (web <c>t('statusBar.vehicle.aria', …)</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string Aria(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(AriaKey, AriaFallback);
    }

    /// <summary>Resolve the localized switcher accessible-name prefix (web <c>t('statusBar.vehicle.switch', …)</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string Switch(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SwitchKey, SwitchFallback);
    }
}

/// <summary>
/// The three mutually-exclusive states the segment renders — the native projection of the web source's
/// vehicle-count branches (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx). The web component
/// renders nothing for an empty fleet (<c>if (vehicles.length === 0) return null;</c>), a static, non-interactive
/// chip for a single-vehicle account (<c>if (vehicles.length === 1)</c>) and a button that opens a switcher
/// popover otherwise. Because the web reads come from a synchronous selection store (<c>useSelectedVehicle</c>)
/// and a background live-state query (<c>useVehicleState</c>) — neither of which the web source renders distinct
/// loading / error / stale / offline chrome for — the data-source lifecycle states collapse into
/// <see cref="Hidden"/> exactly as the web collapses an unloaded fleet into <c>return null</c>; the live read's
/// presence only toggles the metrics sub-label (it is never its own surface).
/// </summary>
public enum ActiveVehicleSegmentStatus
{
    /// <summary>The fleet is empty (or has not loaded / failed) — the surface renders nothing (web <c>return null</c>).</summary>
    Hidden,

    /// <summary>The account holds exactly one vehicle — a static, non-interactive chip (web <c>vehicles.length === 1</c>).</summary>
    Solo,

    /// <summary>The account holds two or more vehicles — an interactive switcher button + popover (web default branch).</summary>
    Switcher,
}

/// <summary>
/// One immutable read of the selected vehicle's live state — the native analogue of the fields the web source
/// pulls from <c>useVehicleState(vehicleId).data.state</c>
/// (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx L36-L46): the battery level percentage
/// (web <c>state.battery_level</c>) and the rated range in SI metres (web <c>state.rated_range</c>, which "arrives
/// in meters, not miles"). The whole record being present is the web <c>liveState</c> truthiness test that gates
/// the metrics sub-label; a <see langword="null"/> snapshot omits the metrics exactly as the web omits them when
/// the query has produced no state. Pure data — no WinUI types — so the projection is unit-tested without a UI
/// host.
/// </summary>
/// <param name="BatteryLevelPercent">The battery level percentage (web <c>state.battery_level</c>), or null.</param>
/// <param name="RatedRangeMeters">The rated range in SI metres (web <c>state.rated_range</c>), or null.</param>
public sealed record ActiveVehicleLiveState(long? BatteryLevelPercent, double? RatedRangeMeters);

/// <summary>
/// One already-projected switcher popover row — the native port of an entry the web source maps from its
/// <c>vehicles</c> list (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx L155-L178). <see cref="Id"/>
/// is the numeric vehicle id committed on activation (web <c>v.id</c>), <see cref="Name"/> is the resolved row
/// label via the shared display-name → VIN → "Vehicle {id}" rule (web
/// <c>v.display_name || v.vin || `Vehicle ${v.id}`</c>), <see cref="Model"/> is the optional model suffix (web
/// <c>v.model</c>) and <see cref="Selected"/> records whether the row is the current selection (web
/// <c>v.id === vehicleId</c>, the row that shows the Check glyph).
/// </summary>
/// <param name="Id">The numeric vehicle id (web <c>v.id</c>).</param>
/// <param name="Name">The resolved row label (web <c>v.display_name || v.vin || `Vehicle ${v.id}`</c>).</param>
/// <param name="Model">The optional model suffix (web <c>v.model</c>), or null.</param>
/// <param name="Selected">Whether this row is the current selection (web <c>v.id === vehicleId</c>).</param>
public sealed record ActiveVehicleSegmentOption(long Id, string Name, string? Model, bool Selected);

/// <summary>
/// The fully projected, render-ready view of the segment — everything the web component body derives before
/// returning JSX (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx L27-L183). It resolves the
/// vehicle-count <see cref="Status"/>, the trigger <see cref="Label"/> (the selected — or, mirroring the web
/// <c>useSelectedVehicle</c> "default to the first vehicle" precedence, the first — vehicle's display name → VIN →
/// "Vehicle {id}", or the localized "No vehicle"), the optional live metrics sub-label
/// (<see cref="HasMetrics"/> / <see cref="MetricsText"/>: <c>{battery}% · {range} {unit}</c> with the range
/// converted from SI metres to the user's distance preference and rounded), which sub-elements the
/// <see cref="IconOnly"/> mode draws (<see cref="ShowLabel"/> / <see cref="ShowMetrics"/> / <see cref="ShowChevron"/>),
/// the composed hover <see cref="TooltipText"/> (web <c>&lt;Tooltip content&gt;</c>), the accessible
/// <see cref="AutomationName"/> (web <c>aria-label</c>, differing between the static chip and the switcher button),
/// the <see cref="ListAccessibleName"/> the popover carries (web listbox <c>aria-label</c>), the projected
/// <see cref="Options"/> rows and the effective <see cref="SelectedId"/>. Pure value type so every field is
/// asserted headlessly; the WinUI view renders from it and performs no derivation of its own.
/// </summary>
public sealed record ActiveVehicleSegmentProjection
{
    private ActiveVehicleSegmentProjection(
        ActiveVehicleSegmentStatus status,
        bool iconOnly,
        string label,
        bool hasMetrics,
        string metricsText,
        string tooltipText,
        string automationName,
        string listAccessibleName,
        long? selectedId,
        IReadOnlyList<ActiveVehicleSegmentOption> options)
    {
        Status = status;
        IconOnly = iconOnly;
        Label = label;
        HasMetrics = hasMetrics;
        MetricsText = metricsText;
        TooltipText = tooltipText;
        AutomationName = automationName;
        ListAccessibleName = listAccessibleName;
        SelectedId = selectedId;
        Options = options;
    }

    /// <summary>The resolved vehicle-count state (web <c>vehicles.length</c> branch).</summary>
    public ActiveVehicleSegmentStatus Status { get; }

    /// <summary>Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</summary>
    public bool IconOnly { get; }

    /// <summary>Whether the surface is shown at all (web: not the empty-fleet <c>return null</c>).</summary>
    public bool IsVisible => Status != ActiveVehicleSegmentStatus.Hidden;

    /// <summary>Whether the surface is the interactive switcher (web: the multi-vehicle popover button).</summary>
    public bool IsInteractive => Status == ActiveVehicleSegmentStatus.Switcher;

    /// <summary>The trigger / chip label (web <c>label</c>): display name → VIN → "Vehicle {id}" → "No vehicle".</summary>
    public string Label { get; }

    /// <summary>Whether the text label is drawn beside the car glyph (web <c>!iconOnly</c>).</summary>
    public bool ShowLabel => IsVisible && !IconOnly;

    /// <summary>Whether a live-state metrics sub-label exists (web <c>liveState</c> truthiness).</summary>
    public bool HasMetrics { get; }

    /// <summary>The composed metrics sub-label, <c>{battery}% · {range} {unit}</c> (web <c>metricsLabel</c>); empty when none.</summary>
    public string MetricsText { get; }

    /// <summary>Whether the metrics sub-label is drawn (web <c>!iconOnly &amp;&amp; metricsLabel</c>).</summary>
    public bool ShowMetrics => !IconOnly && HasMetrics;

    /// <summary>Whether the switcher chevron is drawn (web <c>!iconOnly</c> on the multi-vehicle button).</summary>
    public bool ShowChevron => !IconOnly && Status == ActiveVehicleSegmentStatus.Switcher;

    /// <summary>The hover tooltip text (web <c>&lt;Tooltip content&gt;</c>): "Active vehicle · {label}" plus optional sub-label / metrics.</summary>
    public string TooltipText { get; }

    /// <summary>
    /// The accessible name (web <c>aria-label</c>): "Active vehicle: {label}" for the static chip, or
    /// "Switch vehicle ({label})" for the switcher button.
    /// </summary>
    public string AutomationName { get; }

    /// <summary>The popover's accessible name (web listbox <c>aria-label</c>): "Active vehicle".</summary>
    public string ListAccessibleName { get; }

    /// <summary>The effective selected vehicle id (web <c>vehicleId</c>: the stored selection or the first vehicle), or null.</summary>
    public long? SelectedId { get; }

    /// <summary>The projected switcher rows (web <c>vehicles.map(...)</c>); empty when hidden.</summary>
    public IReadOnlyList<ActiveVehicleSegmentOption> Options { get; }

    /// <summary>
    /// Project the render inputs exactly as the web component body does
    /// (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx L27-L183). The fleet count selects the
    /// <see cref="ActiveVehicleSegmentStatus"/>; an empty fleet returns the hidden projection (web
    /// <c>return null</c>). The effective selection is <paramref name="selectedId"/> falling back to the first
    /// vehicle — the native reproduction of the web <c>useSelectedVehicle</c> precedence
    /// (<c>urlId ?? stored ?? firstVehicleId</c>) — and drives the label, the popover Check and the row selection.
    /// The metrics sub-label is composed only when <paramref name="liveState"/> is present, converting the rated
    /// range from SI metres to <paramref name="unitPref"/>'s distance unit and rounding it (web
    /// <c>Math.round(convertDistanceFromSI(rated_range, distance))</c>). Every label flows through the i18n facade.
    /// </summary>
    /// <param name="vehicles">The cached fleet (web <c>vehicles</c>), or null.</param>
    /// <param name="selectedId">The stored selection id (web <c>useSelectedVehicle().vehicleId</c> store value), or null.</param>
    /// <param name="liveState">The selected vehicle's live state (web <c>useVehicleState().data.state</c>), or null.</param>
    /// <param name="unitPref">The user's unit preference bag (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="iconOnly">Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ActiveVehicleSegmentProjection Project(
        IReadOnlyList<VehicleOption>? vehicles,
        long? selectedId,
        ActiveVehicleLiveState? liveState,
        UnitPref unitPref,
        bool iconOnly,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(unitPref);
        ArgumentNullException.ThrowIfNull(localizer);

        var fleet = vehicles ?? Array.Empty<VehicleOption>();
        var fallbackWord = ActiveVehicleSegmentRegistration.Fallback(localizer);
        var listAccessibleName = ActiveVehicleSegmentRegistration.Aria(localizer);

        if (fleet.Count == 0)
        {
            // web: if (vehicles.length === 0) return null;
            return new ActiveVehicleSegmentProjection(
                ActiveVehicleSegmentStatus.Hidden,
                iconOnly,
                ActiveVehicleSegmentRegistration.None(localizer),
                hasMetrics: false,
                metricsText: string.Empty,
                tooltipText: string.Empty,
                automationName: string.Empty,
                listAccessibleName: listAccessibleName,
                selectedId: null,
                options: Array.Empty<ActiveVehicleSegmentOption>());
        }

        // web useSelectedVehicle precedence: effectiveId = urlId ?? stored ?? firstVehicleId.
        var effectiveId = selectedId ?? fleet[0].Id;
        var selectedVehicle = FindById(fleet, effectiveId);

        var label = ResolveLabel(selectedVehicle, effectiveId, fallbackWord, localizer);
        var subLabel = selectedVehicle?.Model ?? string.Empty;

        var (hasMetrics, metricsText) = ResolveMetrics(liveState, unitPref);

        var dot = ActiveVehicleSegmentRegistration.MiddleDot;
        var tooltip = $"{ActiveVehicleSegmentRegistration.Tooltip(localizer)} {dot} {label}";
        if (!string.IsNullOrEmpty(subLabel))
        {
            tooltip += $" {dot} {subLabel}";
        }

        if (hasMetrics)
        {
            tooltip += $" {dot} {metricsText}";
        }

        var status = fleet.Count == 1 ? ActiveVehicleSegmentStatus.Solo : ActiveVehicleSegmentStatus.Switcher;

        // web chip aria-label: `${aria}: ${label}`; web switcher aria-label: `${switch} (${label})`.
        var automationName = status == ActiveVehicleSegmentStatus.Solo
            ? $"{ActiveVehicleSegmentRegistration.Aria(localizer)}: {label}"
            : $"{ActiveVehicleSegmentRegistration.Switch(localizer)} ({label})";

        var options = BuildOptions(fleet, effectiveId, fallbackWord);

        return new ActiveVehicleSegmentProjection(
            status,
            iconOnly,
            label,
            hasMetrics,
            metricsText,
            tooltip,
            automationName,
            listAccessibleName,
            effectiveId,
            options);
    }

    private static VehicleOption? FindById(IReadOnlyList<VehicleOption> fleet, long id)
    {
        foreach (var vehicle in fleet)
        {
            if (vehicle.Id == id)
            {
                return vehicle;
            }
        }

        return null;
    }

    private static string ResolveLabel(
        VehicleOption? selectedVehicle,
        long? effectiveId,
        string fallbackWord,
        ILocalizer localizer)
    {
        // web: vehicle?.display_name || vehicle?.vin || (vehicleId != null ? `${fallback} ${vehicleId}` : none).
        if (selectedVehicle is not null)
        {
            return VehicleLabels.Short(selectedVehicle, fallbackWord);
        }

        if (effectiveId is { } id)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{fallbackWord} {id}");
        }

        return ActiveVehicleSegmentRegistration.None(localizer);
    }

    private static (bool HasMetrics, string MetricsText) ResolveMetrics(
        ActiveVehicleLiveState? liveState,
        UnitPref unitPref)
    {
        if (liveState is null)
        {
            return (false, string.Empty);
        }

        // web: `${battery_level ?? 0}% · ${Math.round(convertDistanceFromSI(rated_range ?? 0, distance))} ${distance}`.
        var battery = liveState.BatteryLevelPercent ?? 0;
        var meters = liveState.RatedRangeMeters ?? 0;
        var converted = UnitConverters.DistanceFromSi(meters, unitPref.Distance);
        var rounded = double.IsFinite(converted) ? (long)Math.Floor(converted + 0.5) : 0;
        var unitLabel = UnitLabels.Label(unitPref.Distance);

        var text = string.Create(
            CultureInfo.InvariantCulture,
            $"{battery}% {ActiveVehicleSegmentRegistration.MiddleDot} {rounded} {unitLabel}");
        return (true, text);
    }

    private static List<ActiveVehicleSegmentOption> BuildOptions(
        IReadOnlyList<VehicleOption> fleet,
        long effectiveId,
        string fallbackWord)
    {
        var options = new List<ActiveVehicleSegmentOption>(fleet.Count);
        foreach (var vehicle in fleet)
        {
            options.Add(
                new ActiveVehicleSegmentOption(
                    vehicle.Id,
                    VehicleLabels.Short(vehicle, fallbackWord),
                    vehicle.Model,
                    vehicle.Id == effectiveId));
        }

        return options;
    }
}

/// <summary>
/// PII-safe diagnostics for the ActiveVehicleSegment surface (P1/S11 diagnostics contract). The segment carries
/// user-facing content (the vehicle's display name / VIN, its battery and range, and the full fleet in the
/// popover), so the collector records ONLY the operational <c>view.opened</c> event with the surface slug —
/// never the label, the metrics, the selection or the fleet. Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class ActiveVehicleSegmentDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ActiveVehicleSegmentDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ActiveVehicleSegment</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ActiveVehicleSegmentRegistration.Slug}");
    }
}
