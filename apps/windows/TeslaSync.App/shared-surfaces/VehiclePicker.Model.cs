using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the app-wide vehicle picker surface — the native mirror of the web
/// <c>VehiclePicker</c> (web/src/components/layout/VehiclePicker.tsx). The web component is the persistent,
/// sidebar-header vehicle selector wired to the global <c>useSelectedVehicle()</c> store and the unified pin
/// store (<c>usePinned('vehicle')</c>): it floats pinned vehicles to the top in pin-position order, prefixes
/// each pinned option with a 📌 glyph, labels every option <c>display_name || vin || "Vehicle {id}"</c>, and —
/// the defining behaviour — hides itself entirely for fleets of zero or one vehicle (including while the fleet
/// is still loading) so it adds no noise in the common single-vehicle case. This metadata carries the
/// diagnostics slug the surface registers under, the single i18n key the web source passes to <c>t()</c>
/// (<see cref="AriaKey"/>, web <c>t('vehiclePicker.aria', 'Select vehicle')</c>) and the locale-independent
/// pinned-row prefix. The key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects
/// and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class VehiclePickerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "VehiclePicker";

    /// <summary>i18n key for the trigger's accessible name — the one key the web source passes to <c>t()</c> (web <c>vehiclePicker.aria</c>).</summary>
    public const string AriaKey = "translation.vehiclePicker.aria";

    /// <summary>English fallback for <see cref="AriaKey"/> (web second arg, verbatim).</summary>
    public const string AriaFallback = "Select vehicle";

    /// <summary>
    /// The locale-independent prefix prepended to a pinned vehicle's label — the native reproduction of the web
    /// source's <c>`📌 ${base}`</c> (a U+1F4CC PUSHPIN glyph and a trailing space). Not a translatable string; the
    /// web hard-codes the same glyph for every locale.
    /// </summary>
    public const string PinnedPrefix = "\U0001F4CC ";
}

/// <summary>
/// The two mutually-exclusive states the app-wide vehicle picker renders — the native projection of the web
/// source's single visibility branch (web/src/components/layout/VehiclePicker.tsx L59:
/// <c>if (vehicles.length &lt;= 1) return null;</c>). The web component is binary: it renders the icon + select
/// when the fleet holds two or more vehicles, and renders nothing otherwise. Because the web
/// <c>useSelectedVehicle()</c> / <c>usePinned()</c> reads carry no freshness or connectivity dimension and the
/// web source hides while the fleet is still loading, the data-source lifecycle states (loading, resolved-empty,
/// failed, stale, offline) all collapse into <see cref="Hidden"/> exactly as the web source collapses them into
/// its <c>return null</c>; there is no separate loading / empty / error / stale / offline chrome to reproduce.
/// </summary>
public enum VehiclePickerStatus
{
    /// <summary>
    /// The fleet holds at most one vehicle (zero or one), is still loading, resolved empty, or failed — the
    /// surface renders nothing (web <c>return null</c>). The single-vehicle case is intentionally collapsed here:
    /// there is nothing meaningful to pick.
    /// </summary>
    Hidden,

    /// <summary>The fleet holds two or more vehicles — the populated picker (web's only rendered branch).</summary>
    Ready,
}

/// <summary>
/// PII-safe diagnostics for the app-wide vehicle picker surface (P1/S11 diagnostics contract). A vehicle
/// picker's option labels carry user-facing content (display names, VINs) and its selection is a vehicle id, so
/// the collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug —
/// never the fleet, the labels, the pins, or the selected id. Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class VehiclePickerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehiclePickerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehiclePicker</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={VehiclePickerRegistration.Slug}"));
    }
}
