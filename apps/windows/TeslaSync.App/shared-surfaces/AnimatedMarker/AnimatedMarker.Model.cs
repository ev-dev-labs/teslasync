using System;
using System.Globalization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The render classification of the <c>AnimatedMarker</c> surface — the native expansion of the data lifecycle
/// the web marker rides on. The web component (web/src/components/maps/AnimatedMarker.tsx) is a leaf that
/// re-renders whenever its parent feeds it a new <c>position</c>; on Windows that position is bound to a
/// cache-then-network live-position seam, so the marker reproduces every state of that seam rather than assuming
/// a value is always present. <see cref="Live"/> is the steady "fresh fix" state (pulsing dot); <see cref="Stale"/>
/// / <see cref="Offline"/> keep the last good fix visible (dimmed) with a freshness chip; and
/// <see cref="Loading"/> / <see cref="Empty"/> / <see cref="Error"/> render friendly centered chrome instead of a
/// blank box.
/// </summary>
public enum AnimatedMarkerVisualState
{
    /// <summary>First fix in flight, no cached position yet — a centered progress affordance.</summary>
    Loading,

    /// <summary>The position query resolved with nothing to show — a friendly centered empty state.</summary>
    Empty,

    /// <summary>The position query failed with no cached fix — a centered error state with retry.</summary>
    Error,

    /// <summary>A cached fix is shown but it is past the freshness window — dimmed marker + stale chip.</summary>
    Stale,

    /// <summary>The connection dropped; the last good fix (if any) is shown dimmed with an offline chip.</summary>
    Offline,

    /// <summary>A fresh fix is shown with the pulsing dot and (when known) the heading pointer.</summary>
    Live,
}

/// <summary>
/// One immutable marker fix — the three inputs the web <c>&lt;AnimatedMarker&gt;</c> renders from
/// (web/src/components/maps/AnimatedMarker.tsx): the <c>position</c> (<see cref="Position"/>), the optional
/// <c>heading</c> degrees (<see cref="Heading"/>) and the marker tint (<see cref="AccentBrushKey"/>, the native
/// token analogue of the web <c>color</c> prop whose default <c>#00b4d8</c> is our accent token). Pure data — no
/// WinUI types — so it is unit-tested without a render host. <see cref="FromRepositoryResult{T}"/> maps a
/// cache-then-network domain emission onto a marker fix while preserving the load status, exactly as a web map
/// passes a live vehicle position straight into the marker.
/// </summary>
/// <param name="Position">The geographic fix the marker is pinned to (web <c>position</c>).</param>
/// <param name="Heading">The travel heading in degrees, or null when unknown (web <c>heading</c>).</param>
/// <param name="AccentBrushKey">The marker tint token key (web <c>color</c>), or null for the default accent.</param>
public sealed record AnimatedMarkerSample(GeoPoint Position, double? Heading = null, string? AccentBrushKey = null)
{
    /// <summary>The tint token the dot fills with — the supplied key, or the default accent (web <c>#00b4d8</c>).</summary>
    public string ResolvedAccentBrushKey =>
        string.IsNullOrEmpty(AccentBrushKey) ? AnimatedMarkerRegistration.DefaultAccentBrushKey : AccentBrushKey;

    /// <summary>True when a finite heading is known (web <c>heading != null</c>); drives the rotated pointer.</summary>
    public bool HasHeading => Heading is { } h && double.IsFinite(h);

    /// <summary>The heading wrapped into [0, 360) degrees, or 0 when unknown.</summary>
    public double NormalizedHeading => HasHeading ? (((Heading!.Value % 360) + 360) % 360) : 0;

    /// <summary>Create a fix from raw latitude/longitude with an optional heading and tint.</summary>
    /// <param name="lat">Latitude in decimal degrees.</param>
    /// <param name="lng">Longitude in decimal degrees.</param>
    /// <param name="heading">Optional travel heading in degrees.</param>
    /// <param name="accentBrushKey">Optional tint token key.</param>
    public static AnimatedMarkerSample At(double lat, double lng, double? heading = null, string? accentBrushKey = null) =>
        new(new GeoPoint(lat, lng), heading, accentBrushKey);

    /// <summary>
    /// Project a cache-then-network <see cref="RepositoryResult{T}"/> of a domain read-model onto a marker fix
    /// while preserving the emission's <see cref="LoadStatus"/>, fetch time, staleness and error — the native
    /// wiring for "feed the live vehicle position into the marker". When the result carries a value (cached,
    /// refreshing, loaded or offline-cached) the selectors pull the fix out of it; when there is no value yet
    /// (initial load, a success-but-empty response, or a hard failure with no cache) the marker fix is absent and
    /// the surface renders its loading / empty / error / offline chrome. WinUI-free so it is unit-tested against
    /// an in-memory result.
    /// </summary>
    /// <typeparam name="T">The repository's domain read-model type whose value carries the fix.</typeparam>
    /// <param name="result">The repository emission to read the latest value from.</param>
    /// <param name="selectPosition">Selector that pulls the geographic fix out of the value.</param>
    /// <param name="selectHeading">Optional selector that pulls the heading (degrees) out of the value.</param>
    /// <param name="selectAccentBrushKey">Optional selector that pulls the tint token key out of the value.</param>
    public static RepositoryResult<AnimatedMarkerSample> FromRepositoryResult<T>(
        RepositoryResult<T> result,
        Func<T, GeoPoint> selectPosition,
        Func<T, double?>? selectHeading = null,
        Func<T, string?>? selectAccentBrushKey = null)
    {
        ArgumentNullException.ThrowIfNull(result);
        ArgumentNullException.ThrowIfNull(selectPosition);

        // A fix only exists in the value-bearing states; Loading / Empty / Error carry none (HasValue keys off
        // Value != null, which is unreliable for a value-type T whose default is non-null).
        bool hasValue = result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;
        AnimatedMarkerSample? sample = null;
        if (hasValue)
        {
            var value = result.Value!;
            sample = new AnimatedMarkerSample(
                selectPosition(value),
                selectHeading?.Invoke(value),
                selectAccentBrushKey?.Invoke(value));
        }

        return new RepositoryResult<AnimatedMarkerSample>(result.Status, sample, result.FetchedAt, result.IsStale, result.Error);
    }
}

/// <summary>
/// The pure viewport geometry behind the marker's "keep me in view" behaviour — the headless analogue of the web
/// effect's <c>!map.getBounds().contains(target)</c> guard (web/src/components/maps/AnimatedMarker.tsx L56). Kept
/// WinUI-free (operates on <see cref="GeoBounds"/> + <see cref="GeoPoint"/>) so the pan decision is unit-tested
/// without a map control.
/// </summary>
public static class AnimatedMarkerGeometry
{
    /// <summary>
    /// True when the marker should ask the map to pan so the fix is visible — i.e. the bounds are a valid
    /// viewport and the fix falls outside them (web <c>!map.getBounds().contains(target)</c>). An invalid /
    /// unknown viewport returns false (there is nothing meaningful to pan toward).
    /// </summary>
    /// <param name="visibleBounds">The map's current visible bounds (web <c>map.getBounds()</c>).</param>
    /// <param name="position">The marker fix (web <c>target</c>).</param>
    public static bool ShouldPanToKeepInView(GeoBounds visibleBounds, GeoPoint position) =>
        visibleBounds.IsValid && !visibleBounds.Contains(position);
}

/// <summary>
/// Canonical metadata for the AnimatedMarker surface — the native analogue of the module-level constants in
/// web/src/components/maps/AnimatedMarker.tsx (the 24px icon, the inner-dot inset, the default <c>#00b4d8</c>
/// colour) plus the live-state-to-chrome mapping the native surface adds. Carries the diagnostics slug, the
/// automation id, the marker metrics, the per-state i18n keys (each with the English fallback shared with the
/// <c>Strings/{lang}/Resources.resw</c> catalog) and the per-state token brush keys. UI-free so it is asserted in
/// tests.
/// </summary>
public static class AnimatedMarkerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AnimatedMarker";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "animated-marker";

    /// <summary>The default tint token (the native equivalent of the web <c>color = '#00b4d8'</c> accent).</summary>
    public const string DefaultAccentBrushKey = "TsColorAccentBrush";

    /// <summary>Outer pulsing halo diameter in DIPs (web 24px icon, halo fills it).</summary>
    public const double HaloDiameter = 26;

    /// <summary>Inner solid dot diameter in DIPs (web inner circle, <c>inset:4px</c> of the 24px icon).</summary>
    public const double DotDiameter = 14;

    /// <summary>Side length in DIPs of the triangular heading pointer drawn when a heading is known.</summary>
    public const double HeadingPointerSize = 10;

    /// <summary>Opacity the last good fix is dimmed to while stale (past the freshness window).</summary>
    public const double StaleMarkerOpacity = 0.6;

    /// <summary>Opacity the last good fix is dimmed to while offline.</summary>
    public const double OfflineMarkerOpacity = 0.45;

    /// <summary>i18n key for the loading label (web has none; native loading chrome).</summary>
    public const string LoadingKey = "translation.common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading...";

    /// <summary>i18n key for the empty (no-fix) message.</summary>
    public const string EmptyKey = "translation.mapOverview.noLocation";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No location data available yet";

    /// <summary>i18n key for the error label.</summary>
    public const string ErrorKey = "translation.error.loadFailed";

    /// <summary>English fallback for <see cref="ErrorKey"/>.</summary>
    public const string ErrorFallback = "Failed to load data";

    /// <summary>i18n key for the stale chip label.</summary>
    public const string StaleKey = "translation.mqtt.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>i18n key for the offline chip label.</summary>
    public const string OfflineKey = "translation.live.disconnected";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>i18n key for the live chip label.</summary>
    public const string LiveKey = "translation.Live";

    /// <summary>English fallback for <see cref="LiveKey"/>.</summary>
    public const string LiveFallback = "Live";

    /// <summary>i18n key for the retry affordance (error state).</summary>
    public const string RetryKey = "translation.error.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the accessible-name noun the marker describes.</summary>
    public const string VehicleKey = "translation.Vehicle";

    /// <summary>English fallback for <see cref="VehicleKey"/>.</summary>
    public const string VehicleFallback = "Vehicle";

    /// <summary>Classify a live-position load state into the marker's render state.</summary>
    /// <param name="state">The bound live-position state (web <c>position</c> lifecycle).</param>
    public static AnimatedMarkerVisualState Classify(LoadState<AnimatedMarkerSample> state)
    {
        ArgumentNullException.ThrowIfNull(state);
        return state switch
        {
            LoadState<AnimatedMarkerSample>.Loading => AnimatedMarkerVisualState.Loading,
            LoadState<AnimatedMarkerSample>.Empty => AnimatedMarkerVisualState.Empty,
            LoadState<AnimatedMarkerSample>.Error => AnimatedMarkerVisualState.Error,
            LoadState<AnimatedMarkerSample>.Offline => AnimatedMarkerVisualState.Offline,
            LoadState<AnimatedMarkerSample>.Cached c => c.Stale ? AnimatedMarkerVisualState.Stale : AnimatedMarkerVisualState.Live,
            LoadState<AnimatedMarkerSample>.Refreshing r => r.Stale ? AnimatedMarkerVisualState.Stale : AnimatedMarkerVisualState.Live,
            LoadState<AnimatedMarkerSample>.Loaded => AnimatedMarkerVisualState.Live,
            _ => AnimatedMarkerVisualState.Empty,
        };
    }

    /// <summary>The i18n key for a state's short label (chip or centered message).</summary>
    /// <param name="state">The render state.</param>
    public static string StatusLabelKey(AnimatedMarkerVisualState state) => state switch
    {
        AnimatedMarkerVisualState.Loading => LoadingKey,
        AnimatedMarkerVisualState.Empty => EmptyKey,
        AnimatedMarkerVisualState.Error => ErrorKey,
        AnimatedMarkerVisualState.Stale => StaleKey,
        AnimatedMarkerVisualState.Offline => OfflineKey,
        _ => LiveKey,
    };

    /// <summary>The English fallback for a state's short label.</summary>
    /// <param name="state">The render state.</param>
    public static string StatusLabelFallback(AnimatedMarkerVisualState state) => state switch
    {
        AnimatedMarkerVisualState.Loading => LoadingFallback,
        AnimatedMarkerVisualState.Empty => EmptyFallback,
        AnimatedMarkerVisualState.Error => ErrorFallback,
        AnimatedMarkerVisualState.Stale => StaleFallback,
        AnimatedMarkerVisualState.Offline => OfflineFallback,
        _ => LiveFallback,
    };

    /// <summary>The token brush key tinting a state's chip/status dot (semantic freshness colour).</summary>
    /// <param name="state">The render state.</param>
    public static string StatusAccentBrushKey(AnimatedMarkerVisualState state) => state switch
    {
        AnimatedMarkerVisualState.Live => "TsColorSuccessBrush",
        AnimatedMarkerVisualState.Stale => "TsColorWarningBrush",
        AnimatedMarkerVisualState.Offline => "TsColorDangerBrush",
        AnimatedMarkerVisualState.Error => "TsColorDangerBrush",
        _ => "TsColorTextMutedBrush",
    };
}

/// <summary>
/// The fully projected, render-ready view of a bound live-position state — everything the web component derives
/// before returning its marker plus the per-state chrome the native surface adds. Carries the resolved
/// <see cref="State"/>, whether/where to draw the marker (<see cref="ShowMarker"/>, <see cref="Position"/>,
/// <see cref="MarkerOpacity"/>), the heading pointer (<see cref="ShowHeadingArrow"/>, <see cref="HeadingDegrees"/>),
/// the marker tint (<see cref="AccentBrushKey"/>), whether the halo pulses (<see cref="ShowPulse"/> — gated by the
/// reduced-motion contract), which centered affordance to show when there is no fix (<see cref="ShowSpinner"/> /
/// <see cref="ShowEmptyPanel"/> / <see cref="ShowErrorPanel"/> / <see cref="ShowRetry"/>), the localized
/// <see cref="StatusLabel"/> + its <see cref="StatusAccentBrushKey"/>, the <see cref="RetryLabel"/> and the
/// accessible <see cref="AutomationName"/>. Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct AnimatedMarkerProjection
{
    private AnimatedMarkerProjection(
        AnimatedMarkerVisualState state,
        bool hasPosition,
        GeoPoint position,
        bool showMarker,
        double markerOpacity,
        bool hasHeading,
        bool showHeadingArrow,
        double headingDegrees,
        string accentBrushKey,
        bool showPulse,
        bool showSpinner,
        bool showEmptyPanel,
        bool showErrorPanel,
        bool showRetry,
        string statusLabel,
        string statusAccentBrushKey,
        string retryLabel,
        string automationName)
    {
        State = state;
        HasPosition = hasPosition;
        Position = position;
        ShowMarker = showMarker;
        MarkerOpacity = markerOpacity;
        HasHeading = hasHeading;
        ShowHeadingArrow = showHeadingArrow;
        HeadingDegrees = headingDegrees;
        AccentBrushKey = accentBrushKey;
        ShowPulse = showPulse;
        ShowSpinner = showSpinner;
        ShowEmptyPanel = showEmptyPanel;
        ShowErrorPanel = showErrorPanel;
        ShowRetry = showRetry;
        StatusLabel = statusLabel;
        StatusAccentBrushKey = statusAccentBrushKey;
        RetryLabel = retryLabel;
        AutomationName = automationName;
    }

    /// <summary>The resolved render state.</summary>
    public AnimatedMarkerVisualState State { get; }

    /// <summary>True when a fix is available to pin the marker to (value-bearing states).</summary>
    public bool HasPosition { get; }

    /// <summary>The geographic fix the marker is pinned to (meaningful only when <see cref="HasPosition"/>).</summary>
    public GeoPoint Position { get; }

    /// <summary>True when the coordinate marker (halo + dot) is drawn (Live / Stale / Offline with a fix).</summary>
    public bool ShowMarker { get; }

    /// <summary>The marker opacity — full when live, dimmed when stale/offline.</summary>
    public double MarkerOpacity { get; }

    /// <summary>True when the fix carries a known heading (data-level; web <c>heading != null</c>).</summary>
    public bool HasHeading { get; }

    /// <summary>True when the rotated heading pointer is actually drawn (a heading is known and the marker shows).</summary>
    public bool ShowHeadingArrow { get; }

    /// <summary>The heading rotation in degrees [0, 360) applied to the pointer (web <c>rotate(${heading}deg)</c>).</summary>
    public double HeadingDegrees { get; }

    /// <summary>The token brush key the dot fills with (web <c>color</c>).</summary>
    public string AccentBrushKey { get; }

    /// <summary>True when the halo pulse animation runs (live only, and only when motion is not reduced).</summary>
    public bool ShowPulse { get; }

    /// <summary>True when the centered loading spinner is shown (no fix yet).</summary>
    public bool ShowSpinner { get; }

    /// <summary>True when the centered empty state is shown (resolved with no fix, or offline with no cache).</summary>
    public bool ShowEmptyPanel { get; }

    /// <summary>True when the centered error state is shown (failed with no cached fix).</summary>
    public bool ShowErrorPanel { get; }

    /// <summary>True when the error state offers a retry affordance.</summary>
    public bool ShowRetry { get; }

    /// <summary>The localized short status label (chip text when a marker shows, otherwise the centered message).</summary>
    public string StatusLabel { get; }

    /// <summary>The token brush key tinting the status chip/dot (semantic freshness colour).</summary>
    public string StatusAccentBrushKey { get; }

    /// <summary>The localized retry-button label.</summary>
    public string RetryLabel { get; }

    /// <summary>The composed accessible name the automation peer reports (always non-empty).</summary>
    public string AutomationName { get; }

    /// <summary>
    /// Project a bound live-position state into a render-ready value, reproducing the web marker's composition
    /// (pulsing halo + heading-rotated dot) and expanding it across the data lifecycle the native surface binds
    /// to. The reduced-motion flag gates the pulse (the native equivalent of honouring
    /// <c>prefers-reduced-motion</c> for the web <c>replay-pulse</c> animation), and every visible string flows
    /// through the i18n facade.
    /// </summary>
    /// <param name="state">The bound live-position state (web <c>position</c> lifecycle).</param>
    /// <param name="reduceMotion">Whether the OS requests reduced motion (suppresses the halo pulse).</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    public static AnimatedMarkerProjection Project(
        LoadState<AnimatedMarkerSample> state,
        bool reduceMotion,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(localizer);

        var visual = AnimatedMarkerRegistration.Classify(state);
        var sample = state.ValueOrDefault;
        bool hasPosition = sample is not null;
        var position = sample?.Position ?? default;

        bool showMarker = hasPosition && visual is
            AnimatedMarkerVisualState.Live or AnimatedMarkerVisualState.Stale or AnimatedMarkerVisualState.Offline;

        double opacity = visual switch
        {
            AnimatedMarkerVisualState.Stale => AnimatedMarkerRegistration.StaleMarkerOpacity,
            AnimatedMarkerVisualState.Offline => AnimatedMarkerRegistration.OfflineMarkerOpacity,
            _ => 1.0,
        };

        bool hasHeading = sample?.HasHeading == true;
        bool showHeadingArrow = showMarker && hasHeading;
        double headingDegrees = hasHeading ? sample!.NormalizedHeading : 0;
        string accentBrushKey = sample?.ResolvedAccentBrushKey ?? AnimatedMarkerRegistration.DefaultAccentBrushKey;
        bool showPulse = visual == AnimatedMarkerVisualState.Live && !reduceMotion;

        bool showSpinner = visual == AnimatedMarkerVisualState.Loading;
        bool showErrorPanel = visual == AnimatedMarkerVisualState.Error;
        bool showEmptyPanel = !showMarker && !showSpinner && !showErrorPanel;
        bool showRetry = showErrorPanel;

        string statusLabel = localizer.GetString(
            AnimatedMarkerRegistration.StatusLabelKey(visual),
            AnimatedMarkerRegistration.StatusLabelFallback(visual));
        string statusAccentBrushKey = AnimatedMarkerRegistration.StatusAccentBrushKey(visual);
        string retryLabel = localizer.GetString(AnimatedMarkerRegistration.RetryKey, AnimatedMarkerRegistration.RetryFallback);
        string vehicle = localizer.GetString(AnimatedMarkerRegistration.VehicleKey, AnimatedMarkerRegistration.VehicleFallback);

        string automationName = showHeadingArrow
            ? string.Create(CultureInfo.InvariantCulture, $"{vehicle} \u2022 {statusLabel} \u00b7 {Math.Round(headingDegrees)}\u00b0")
            : $"{vehicle} \u2022 {statusLabel}";

        return new AnimatedMarkerProjection(
            state: visual,
            hasPosition: hasPosition,
            position: position,
            showMarker: showMarker,
            markerOpacity: opacity,
            hasHeading: hasHeading,
            showHeadingArrow: showHeadingArrow,
            headingDegrees: headingDegrees,
            accentBrushKey: accentBrushKey,
            showPulse: showPulse,
            showSpinner: showSpinner,
            showEmptyPanel: showEmptyPanel,
            showErrorPanel: showErrorPanel,
            showRetry: showRetry,
            statusLabel: statusLabel,
            statusAccentBrushKey: statusAccentBrushKey,
            retryLabel: retryLabel,
            automationName: automationName);
    }
}

/// <summary>
/// PII-safe diagnostics for the AnimatedMarker surface (P1/S11 diagnostics contract). The marker carries a vehicle
/// position, which is sensitive, so the collector records ONLY the operational <c>view.opened</c> event with the
/// surface slug — never the coordinate, heading or any fix value. Thread-safe; mirrors the peer surfaces'
/// diagnostics collectors.
/// </summary>
public sealed class AnimatedMarkerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AnimatedMarkerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AnimatedMarker</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AnimatedMarkerRegistration.Slug}");
    }
}
