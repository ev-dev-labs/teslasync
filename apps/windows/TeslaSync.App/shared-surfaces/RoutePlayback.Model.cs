using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + the render-contract i18n keys for the trip route-playback surface — the native mirror of
/// the web <c>RoutePlayback</c> (web/src/components/maps/RoutePlayback.tsx). The web component is a self-contained
/// widget: an interactive map with a GPS-trail polyline, start/end dots, an animated current-position marker, a
/// floating layer switcher, an inline metric chip and a bottom playback transport, plus an empty state when the
/// trip has no GPS points. It resolves exactly two strings through <c>t()</c> — the empty-state message
/// (<c>maps.routePlayback.empty</c>) and the map application landmark's accessible name
/// (<c>maps.routePlayback.mapLabel</c>) — so this metadata carries those keys + their English fallbacks verbatim,
/// the diagnostics slug the surface registers under, and the transport control labels the inline
/// <c>PlaybackControls</c> composition needs (web <c>replay.controls.*</c>). Every key carries the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects (the convention every shipped surface
/// uses) and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class RoutePlaybackRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RoutePlayback";

    /// <summary>i18n key for the empty-state message (web <c>maps.routePlayback.empty</c>).</summary>
    public const string EmptyKey = "translation.maps.routePlayback.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/> (web second arg, verbatim).</summary>
    public const string EmptyFallback = "No GPS points to replay for this route.";

    /// <summary>i18n key for the map application landmark's accessible name (web <c>maps.routePlayback.mapLabel</c>).</summary>
    public const string MapLabelKey = "translation.maps.routePlayback.mapLabel";

    /// <summary>English fallback for <see cref="MapLabelKey"/> (web second arg, verbatim).</summary>
    public const string MapLabelFallback = "Route playback map";

    /// <summary>i18n key for the reset/rewind control (web <c>replay.controls.reset</c>).</summary>
    public const string ResetKey = "translation.replay.controls.reset";

    /// <summary>English fallback for <see cref="ResetKey"/>.</summary>
    public const string ResetFallback = "Reset";

    /// <summary>i18n key for the play control (web <c>replay.controls.play</c>).</summary>
    public const string PlayKey = "translation.replay.controls.play";

    /// <summary>English fallback for <see cref="PlayKey"/>.</summary>
    public const string PlayFallback = "Play";

    /// <summary>i18n key for the pause control (web <c>replay.controls.pause</c>).</summary>
    public const string PauseKey = "translation.replay.controls.pause";

    /// <summary>English fallback for <see cref="PauseKey"/>.</summary>
    public const string PauseFallback = "Pause";

    /// <summary>i18n key for the stop control (web <c>replay.controls.stop</c>).</summary>
    public const string StopKey = "translation.replay.controls.stop";

    /// <summary>English fallback for <see cref="StopKey"/>.</summary>
    public const string StopFallback = "Stop";

    /// <summary>i18n key for the speed control's accessible name (web <c>replay.controls.speed</c>).</summary>
    public const string SpeedKey = "translation.replay.controls.speed";

    /// <summary>English fallback for <see cref="SpeedKey"/>.</summary>
    public const string SpeedFallback = "Playback speed";

    /// <summary>Default visible map height in effective pixels (web <c>height = 400</c>).</summary>
    public const double DefaultHeight = 400;

    /// <summary>Map zoom used when the trail spans more than one point (web <c>trail.length &gt; 1 ? 13</c>).</summary>
    public const int MultiPointZoom = 13;

    /// <summary>Map zoom used for a single-point trail (web <c>: 15</c>).</summary>
    public const int SinglePointZoom = 15;
}

/// <summary>
/// Pure projection helpers for the inline metric chip the surface renders over the top-right of the map — the
/// native port of the web chip (web/src/components/maps/RoutePlayback.tsx L381-L394). The web chip shows the
/// 1-based position within the trail (<c>{currentIndex + 1}/{points.length}</c>) and, when present, the
/// already-display-unit speed (<c>{fmtNumber(speed, 1)} km/h</c>) and state-of-charge
/// (<c>{fmtNumber(soc, 0)}%</c>). The numeric formatting flows through the same
/// <see cref="ScalarFormatters"/> the rest of the app uses as its <c>fmtNumber</c> counterpart, so grouping and
/// rounding match every other readout. Static and culture-explicit so the chip text is unit-tested without a UI
/// thread.
/// </summary>
public static class RoutePlaybackChip
{
    /// <summary>Speed readout fraction digits (web <c>fmtNumber(speed, 1)</c>).</summary>
    public const int SpeedPrecision = 1;

    /// <summary>State-of-charge readout fraction digits (web <c>fmtNumber(soc, 0)</c>).</summary>
    public const int SocPrecision = 0;

    /// <summary>The 1-based "{index + 1}/{count}" position label (web <c>{currentIndex + 1}/{points.length}</c>).</summary>
    public static string PositionLabel(int index, int count) =>
        string.Create(CultureInfo.InvariantCulture, $"{index + 1}/{count}");

    /// <summary>The speed readout with the web's literal <c>km/h</c> suffix (web <c>{fmtNumber(speed, 1)} km/h</c>).</summary>
    public static string SpeedText(double speed) =>
        $"{ScalarFormatters.FormatNumber(speed, SpeedPrecision)} km/h";

    /// <summary>The state-of-charge readout with a trailing percent (web <c>{fmtNumber(soc, 0)}%</c>).</summary>
    public static string SocText(double soc) =>
        $"{ScalarFormatters.FormatNumber(soc, SocPrecision)}%";
}

/// <summary>
/// PII-safe diagnostics for the route-playback surface (P1/S11 diagnostics contract). The surface carries only a
/// transient playback cursor and the GPS trail it was handed, so the collector records nothing but the
/// operational <c>view.opened</c> event with the surface slug — never a coordinate, position or speed.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class RoutePlaybackDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public RoutePlaybackDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RoutePlayback</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RoutePlaybackRegistration.Slug}");
    }
}
