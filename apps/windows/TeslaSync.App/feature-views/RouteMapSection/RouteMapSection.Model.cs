using System.Globalization;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <c>RouteMapSection</c> feature view — the native port of
/// web/src/features/driving/components/drive-detail/RouteMapSection.tsx. The web source is a pure presentational
/// component: it receives the already-derived <c>drive</c>, <c>trail</c>, <c>startPos</c>, <c>endPos</c>,
/// <c>centerPos</c> and <c>speedSegments</c> props from the parent drive-detail page (the page owns the query) and
/// performs no fetching, so there is deliberately no fetch-driven error / stale / offline branch to reproduce here —
/// those belong to the parent page, not this section (the same precedent the sibling <c>DriveDetailHeader</c> /
/// <c>QuickNav</c> surfaces follow). The web component's own conditional renders map to <see cref="Route"/> (a
/// meaningful GPS trail), <see cref="Stationary"/> (a recorded drive whose every coordinate is one frozen GPS fix)
/// and <see cref="Empty"/> (no trail at all). The defensive <see cref="Loading"/> branch renders skeleton chrome
/// while the parent has not resolved the drive yet, so the surface is never a blank box.
/// </summary>
public enum RouteMapSectionState
{
    /// <summary>The parent has not resolved the drive yet — render skeleton chrome.</summary>
    Loading,

    /// <summary>A meaningful GPS trail — render the speed-coloured polylines, start/end markers and speed legend.</summary>
    Route,

    /// <summary>
    /// A drive whose every GPS coordinate is within ~10 m of the first (a frozen Fleet-Telemetry fix) — render a
    /// single anchor marker plus the "route can't be plotted" notice instead of a polyline that collapses to a dot.
    /// </summary>
    Stationary,

    /// <summary>No trail at all — render the "no route data" empty state.</summary>
    Empty,
}

/// <summary>
/// One speed-coloured leg of the route polyline (the native analogue of the web <c>SpeedSegment</c>: a two-point
/// <c>positions</c> array plus a <c>color</c>). The colour is assigned by the parent data layer from the leg's SI
/// speed (the web <c>useDriveDetailData</c> hook), exactly as the web component receives it pre-coloured — this
/// section never recomputes it. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Positions">The ordered coordinates of the leg (web <c>seg.positions</c>); typically two points.</param>
/// <param name="ColorHex">The leg's stroke colour as a <c>#rrggbb</c> hex string (web <c>seg.color</c>).</param>
public sealed record RouteSpeedSegment(IReadOnlyList<GeoPoint> Positions, string ColorHex);

/// <summary>
/// The already-derived route inputs the web component receives as props — the native analogue of the
/// <c>RouteMapSectionProps</c> bundle the parent <c>useDriveDetailData</c> hook builds. The parent drive-detail page
/// owns the query and feeds these resolved values (or a null <see cref="RouteMapSectionModel.Route"/> while it is
/// still loading). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Positions">
/// The raw drive positions (web <c>drive.positions</c>), used only to decide whether the trail is a meaningful route
/// or a single frozen GPS fix — the web component derives <c>hasRoute</c> / the anchor from these, not from the trail.
/// </param>
/// <param name="Trail">The ordered polyline path (web <c>trail</c>); an empty trail is the whole-surface empty state.</param>
/// <param name="StartPos">The first trail coordinate (web <c>startPos</c>), or null.</param>
/// <param name="EndPos">The last trail coordinate when the trail has &gt; 1 point (web <c>endPos</c>), or null.</param>
/// <param name="CenterPos">The initial map centre (web <c>centerPos</c>).</param>
/// <param name="SpeedSegments">The pre-coloured polyline legs (web <c>speedSegments</c>).</param>
/// <param name="StartTs">When the drive started (web <c>drive.startTs</c>), or null.</param>
/// <param name="EndTs">When the drive ended (web <c>drive.endTs</c>); null for a live in-progress drive.</param>
public sealed record RouteSnapshot(
    IReadOnlyList<GeoPoint> Positions,
    IReadOnlyList<GeoPoint> Trail,
    GeoPoint? StartPos,
    GeoPoint? EndPos,
    GeoPoint CenterPos,
    IReadOnlyList<RouteSpeedSegment> SpeedSegments,
    DateTimeOffset? StartTs,
    DateTimeOffset? EndTs);

/// <summary>
/// The render-time data model the <c>RouteMapSection</c> view binds to. The section is presentational: the parent
/// drive-detail page owns the query and feeds the resolved <see cref="Route"/> (or null while it has not resolved).
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Route">The resolved route inputs the section reads, or null while the parent is still loading.</param>
public sealed record RouteMapSectionModel(RouteSnapshot? Route)
{
    /// <summary>The initial model: the parent is still resolving the drive, so the skeleton branch renders.</summary>
    public static RouteMapSectionModel Pending { get; } = new((RouteSnapshot?)null);
}

/// <summary>
/// The fully projected, render-ready view of the section for one input model — the native analogue of what the web
/// <c>RouteMapSection</c> returns. Carries the resolved <see cref="State"/>, the map viewport, the polyline legs, the
/// start / end / anchor markers and their popup copy, the speed legend (thresholds converted to the user's display
/// unit at this display boundary, never on disk) and the localized chrome. Every measurement string is produced here
/// so the view is a thin renderer and every branch is asserted headlessly.
/// </summary>
public sealed record RouteMapSectionDisplay
{
    /// <summary>The mutually-exclusive surface state.</summary>
    public required RouteMapSectionState State { get; init; }

    /// <summary>The section heading (web <c>t('driveDetail.route', 'Route')</c>).</summary>
    public string Title { get; init; } = string.Empty;

    /// <summary>True when the trail is a meaningful route (drives the polyline / markers / speed-legend branch).</summary>
    public bool HasRoute { get; init; }

    /// <summary>The initial map centre (web <c>center={centerPos}</c>, or the anchor for a stationary fix).</summary>
    public GeoPoint Center { get; init; }

    /// <summary>The initial integer zoom (web <c>zoom={trail.length &gt; 1 ? 13 : 3}</c>, or 15 for a stationary fix).</summary>
    public int Zoom { get; init; }

    /// <summary>True when the view should fit the map to <see cref="Trail"/> once laid out (web <c>FitBounds</c>).</summary>
    public bool FitToTrail { get; init; }

    /// <summary>The polyline path used for the fit-to-bounds pass.</summary>
    public IReadOnlyList<GeoPoint> Trail { get; init; } = Array.Empty<GeoPoint>();

    /// <summary>The speed-coloured polyline legs (web <c>speedSegments</c>); empty unless <see cref="HasRoute"/>.</summary>
    public IReadOnlyList<RouteSpeedSegment> SpeedSegments { get; init; } = Array.Empty<RouteSpeedSegment>();

    /// <summary>The green start marker (web <c>startPos</c> CircleMarker), or null.</summary>
    public GeoPoint? StartMarker { get; init; }

    /// <summary>The red end marker (web <c>endPos</c> CircleMarker), or null.</summary>
    public GeoPoint? EndMarker { get; init; }

    /// <summary>The cyan "last known location" anchor marker for a stationary fix, or null.</summary>
    public GeoPoint? AnchorMarker { get; init; }

    /// <summary>Start marker / legend label (web <c>t('driveDetail.start', 'Start')</c>).</summary>
    public string StartLabel { get; init; } = string.Empty;

    /// <summary>End marker / legend label (web <c>t('driveDetail.end', 'End')</c>).</summary>
    public string EndLabel { get; init; } = string.Empty;

    /// <summary>Start popup detail line (web <c>formatDateTime(drive.startTs)</c>).</summary>
    public string StartPopupDetail { get; init; } = string.Empty;

    /// <summary>End popup detail line (web <c>drive.endTs ? formatDateTime(drive.endTs) : t('driveDetail.inProgress')</c>).</summary>
    public string EndPopupDetail { get; init; } = string.Empty;

    /// <summary>Anchor popup title (web <c>t('driveDetail.lastKnown', 'Last known location')</c>).</summary>
    public string AnchorLabel { get; init; } = string.Empty;

    /// <summary>True when the speed legend is shown (web <c>hasRoute &amp;&amp; trail.length &gt; 1</c>).</summary>
    public bool ShowSpeedLegend { get; init; }

    /// <summary>The low speed threshold converted to the display unit and formatted (web <c>fmtNumber(toSpeedDisplay(LOW))</c>).</summary>
    public string SpeedLowDisplay { get; init; } = string.Empty;

    /// <summary>The medium speed threshold converted to the display unit and formatted.</summary>
    public string SpeedMedDisplay { get; init; } = string.Empty;

    /// <summary>The high speed threshold converted to the display unit and formatted.</summary>
    public string SpeedHighDisplay { get; init; } = string.Empty;

    /// <summary>The display speed unit label (web <c>speedUnit</c>, e.g. "mph" / "km/h").</summary>
    public string SpeedUnitLabel { get; init; } = string.Empty;

    /// <summary>The start legend time (web <c>formatTime(drive.startTs)</c>).</summary>
    public string StartLegendTime { get; init; } = string.Empty;

    /// <summary>True when the end legend run is shown (web <c>{drive.endTs &amp;&amp; …}</c>).</summary>
    public bool ShowEndLegend { get; init; }

    /// <summary>The end legend time (web <c>formatTime(drive.endTs)</c>).</summary>
    public string EndLegendTime { get; init; } = string.Empty;

    /// <summary>The stationary notice heading (web <c>t('driveDetail.stationaryRouteTitle')</c>).</summary>
    public string StationaryTitle { get; init; } = string.Empty;

    /// <summary>The stationary notice body (web <c>t('driveDetail.stationaryRouteBody')</c>).</summary>
    public string StationaryBody { get; init; } = string.Empty;

    /// <summary>The empty-state copy (web <c>t('driveDetail.noRouteData', 'No route data available for this drive')</c>).</summary>
    public string EmptyMessage { get; init; } = string.Empty;

    /// <summary>The Narrator announcement while the skeleton renders.</summary>
    public string LoadingLabel { get; init; } = string.Empty;

    /// <summary>The Narrator name for the whole surface.</summary>
    public string AutomationName { get; init; } = string.Empty;
}

/// <summary>
/// Pure GPS-trail geometry helpers — the native port of web/src/lib/geo.ts (<c>isValidLatLng</c>,
/// <c>hasMeaningfulRoute</c>, <c>firstValidIndex</c>). A <c>(0, 0)</c> coordinate is rejected as the canonical Tesla
/// "GPS not yet fixed" sentinel, and a trail is "meaningful" only when two valid coordinates are at least
/// <see cref="MinMeaningfulRouteMeters"/> apart, so a frozen single-fix drive is detected rather than drawn as a dot.
/// Reuses the shared <see cref="CoordinateSummary.HaversineMeters"/> great-circle distance. UI-free and unit-tested.
/// </summary>
public static class RouteGeometry
{
    /// <summary>Minimum separation (metres) for two GPS samples to count as a meaningful route (web <c>MIN_MEANINGFUL_ROUTE_METERS</c>).</summary>
    public const double MinMeaningfulRouteMeters = 10;

    /// <summary>True when <paramref name="point"/> is finite, non-zero and within valid global bounds (web <c>isValidLatLng</c>).</summary>
    public static bool IsValid(GeoPoint point)
    {
        double lat = point.Lat;
        double lng = point.Lng;
        if (!double.IsFinite(lat) || !double.IsFinite(lng))
        {
            return false;
        }

        if (lat == 0 && lng == 0)
        {
            return false;
        }

        return lat is >= -90 and <= 90 && lng is >= -180 and <= 180;
    }

    /// <summary>The index of the first valid coordinate, or -1 when none exists (web <c>firstValidIndex</c>).</summary>
    public static int FirstValidIndex(IReadOnlyList<GeoPoint> positions)
    {
        ArgumentNullException.ThrowIfNull(positions);
        for (int i = 0; i < positions.Count; i++)
        {
            if (IsValid(positions[i]))
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>
    /// True when <paramref name="positions"/> holds at least two valid coordinates separated by
    /// <see cref="MinMeaningfulRouteMeters"/> or more (web <c>hasMeaningfulRoute</c>). Short-circuits on the first
    /// sample beyond the threshold.
    /// </summary>
    public static bool HasMeaningfulRoute(IReadOnlyList<GeoPoint> positions)
    {
        ArgumentNullException.ThrowIfNull(positions);
        int anchorIdx = FirstValidIndex(positions);
        if (anchorIdx < 0)
        {
            return false;
        }

        GeoPoint anchor = positions[anchorIdx];
        for (int i = anchorIdx + 1; i < positions.Count; i++)
        {
            GeoPoint p = positions[i];
            if (!IsValid(p))
            {
                continue;
            }

            if (CoordinateSummary.HaversineMeters(anchor, p) >= MinMeaningfulRouteMeters)
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>
/// Pure projection from a <see cref="RouteMapSectionModel"/> to its <see cref="RouteMapSectionDisplay"/> — the native
/// port of web/src/features/driving/components/drive-detail/RouteMapSection.tsx. Reproduces the web derivations
/// exactly: the whole-surface empty when <c>trail.length === 0</c>; the meaningful-route vs frozen-fix split via
/// <see cref="RouteGeometry.HasMeaningfulRoute"/> over <c>drive.positions</c>; the <c>zoom = trail.length &gt; 1 ? 13
/// : 3</c> initial view with the <c>FitBounds</c> refinement; the end-time popup that falls back to
/// <c>t('driveDetail.inProgress')</c> for a live drive; and the speed legend whose SI thresholds
/// (<see cref="SpeedSegmentLowMps"/> … <see cref="SpeedSegmentHighMps"/>) are converted to the user's display unit
/// here at the render boundary (never stored). Every label resolves through the i18n facade with the same keys the
/// web source feeds into <c>t()</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class RouteMapSectionProjection
{
    /// <summary>The low speed-band threshold in SI m/s (web <c>SPEED_SEGMENT_LOW_MPS</c> = 30 mph).</summary>
    public const double SpeedSegmentLowMps = 30 * 0.44704;

    /// <summary>The medium speed-band threshold in SI m/s (web <c>SPEED_SEGMENT_MED_MPS</c> = 60 mph).</summary>
    public const double SpeedSegmentMedMps = 60 * 0.44704;

    /// <summary>The high speed-band threshold in SI m/s (web <c>SPEED_SEGMENT_HIGH_MPS</c> = 100 mph).</summary>
    public const double SpeedSegmentHighMps = 100 * 0.44704;

    /// <summary>
    /// The fraction digits the speed-legend thresholds are formatted with. Mirrors the web <c>fmtNumber</c> default
    /// global precision (<c>useSettings</c> initialises it to 2), keeping the legend deterministic.
    /// </summary>
    public const int LegendPrecision = 2;

    private const int RouteZoom = 13;
    private const int SparseZoom = 3;
    private const int StationaryZoom = 15;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and unit prefs.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="unitPref">The user's display-unit preferences (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="now">The clock used for the (absolute) date/time formatting; only affects relative variants.</param>
    public static RouteMapSectionDisplay Project(
        RouteMapSectionModel model, ILocalizer localizer, UnitPref unitPref, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(unitPref);

        string title = localizer.GetString(RouteMapSectionRegistration.RouteKey, RouteMapSectionRegistration.RouteFallback);
        string loadingLabel = localizer.GetString(RouteMapSectionRegistration.LoadingKey, RouteMapSectionRegistration.LoadingFallback);

        if (model.Route is not { } route)
        {
            return new RouteMapSectionDisplay
            {
                State = RouteMapSectionState.Loading,
                Title = title,
                LoadingLabel = loadingLabel,
                AutomationName = loadingLabel,
            };
        }

        string emptyMessage = localizer.GetString(
            RouteMapSectionRegistration.NoRouteDataKey, RouteMapSectionRegistration.NoRouteDataFallback);

        // Web: trail.length > 0 ? (map) : (empty state). An empty trail is the whole-surface empty.
        if (route.Trail.Count == 0)
        {
            return new RouteMapSectionDisplay
            {
                State = RouteMapSectionState.Empty,
                Title = title,
                EmptyMessage = emptyMessage,
                LoadingLabel = loadingLabel,
                AutomationName = emptyMessage,
            };
        }

        string startLabel = localizer.GetString(RouteMapSectionRegistration.StartKey, RouteMapSectionRegistration.StartFallback);
        string endLabel = localizer.GetString(RouteMapSectionRegistration.EndKey, RouteMapSectionRegistration.EndFallback);
        string anchorLabel = localizer.GetString(RouteMapSectionRegistration.LastKnownKey, RouteMapSectionRegistration.LastKnownFallback);
        string inProgress = localizer.GetString(RouteMapSectionRegistration.InProgressKey, RouteMapSectionRegistration.InProgressFallback);

        // Web parity: startPos popup shows formatDateTime(startTs); endPos popup falls back to "In progress" when live.
        string startPopupDetail = DateTimeFormatting.Format(route.StartTs, DateTimeVariant.Full, now);
        string endPopupDetail = route.EndTs is not null
            ? DateTimeFormatting.Format(route.EndTs, DateTimeVariant.Full, now)
            : inProgress;

        // Web legend: "Start: {formatTime(startTs)}"; "{drive.endTs && End: {formatTime(endTs)}}".
        string startLegendTime = DateTimeFormatting.Format(route.StartTs, DateTimeVariant.Time, now);
        bool showEndLegend = route.EndTs is not null;
        string endLegendTime = DateTimeFormatting.Format(route.EndTs, DateTimeVariant.Time, now);

        // Web: route legend thresholds converted to the display unit (SI m/s -> user's speed unit) at render time.
        string speedUnitLabel = UnitLabels.Label(unitPref.Speed);
        string speedLow = FormatSpeedDisplay(SpeedSegmentLowMps, unitPref);
        string speedMed = FormatSpeedDisplay(SpeedSegmentMedMps, unitPref);
        string speedHigh = FormatSpeedDisplay(SpeedSegmentHighMps, unitPref);

        bool hasRoute = RouteGeometry.HasMeaningfulRoute(route.Positions);

        var common = new RouteMapSectionDisplay
        {
            State = hasRoute ? RouteMapSectionState.Route : RouteMapSectionState.Stationary,
            Title = title,
            HasRoute = hasRoute,
            Trail = route.Trail,
            StartLabel = startLabel,
            EndLabel = endLabel,
            AnchorLabel = anchorLabel,
            StartPopupDetail = startPopupDetail,
            EndPopupDetail = endPopupDetail,
            StartLegendTime = startLegendTime,
            ShowEndLegend = showEndLegend,
            EndLegendTime = endLegendTime,
            SpeedLowDisplay = speedLow,
            SpeedMedDisplay = speedMed,
            SpeedHighDisplay = speedHigh,
            SpeedUnitLabel = speedUnitLabel,
            EmptyMessage = emptyMessage,
            LoadingLabel = loadingLabel,
            AutomationName = title,
        };

        if (hasRoute)
        {
            // Web: speed-coloured polylines + green start + red end markers; FitBounds to the trail.
            return common with
            {
                Center = route.CenterPos,
                Zoom = route.Trail.Count > 1 ? RouteZoom : SparseZoom,
                FitToTrail = true,
                SpeedSegments = route.SpeedSegments,
                StartMarker = route.StartPos,
                EndMarker = route.EndPos,
                ShowSpeedLegend = route.Trail.Count > 1,
            };
        }

        // Stationary: a single anchor marker at the first valid fix + the "route can't be plotted" notice.
        int anchorIdx = RouteGeometry.FirstValidIndex(route.Positions);
        GeoPoint? anchor = anchorIdx >= 0 ? route.Positions[anchorIdx] : null;

        return common with
        {
            Center = anchor ?? route.CenterPos,
            Zoom = StationaryZoom,
            FitToTrail = false,
            AnchorMarker = anchor,
            StationaryTitle = localizer.GetString(
                RouteMapSectionRegistration.StationaryTitleKey, RouteMapSectionRegistration.StationaryTitleFallback),
            StationaryBody = localizer.GetString(
                RouteMapSectionRegistration.StationaryBodyKey, RouteMapSectionRegistration.StationaryBodyFallback),
        };
    }

    private static string FormatSpeedDisplay(double mps, UnitPref pref)
    {
        double value = UnitConverters.SpeedFromSi(mps, pref.Speed);
        return NumberFormatting.Format(value, pref.Locale, LegendPrecision);
    }
}

/// <summary>
/// Canonical metadata for the <c>RouteMapSection</c> feature surface — the native mirror of the web component at
/// web/src/features/driving/components/drive-detail/RouteMapSection.tsx: the stable diagnostics slug, the i18n keys +
/// English fallbacks the web source feeds into <c>t()</c> (plus the shared <c>common.loading</c> key backing the
/// defensive skeleton's Narrator label), and the Segoe Fluent glyphs standing in for the web Lucide icons. The
/// <c>driveDetail.lastKnown</c> / <c>driveDetail.stationaryRouteTitle</c> / <c>driveDetail.stationaryRouteBody</c>
/// keys are absent from the en catalog on both platforms, so each resolves to the verbatim web <c>t()</c> fallback —
/// exact parity with the web render. UI-free so the metadata is asserted in tests.
/// </summary>
public static class RouteMapSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "RouteMapSection";

    /// <summary>i18n key for the section heading (web <c>t('driveDetail.route', 'Route')</c>).</summary>
    public const string RouteKey = "driveDetail.route";

    /// <summary>English fallback for the heading — verbatim from the web source.</summary>
    public const string RouteFallback = "Route";

    /// <summary>i18n key for the start marker / legend label (web <c>t('driveDetail.start', 'Start')</c>).</summary>
    public const string StartKey = "driveDetail.start";

    /// <summary>English fallback for the start label — verbatim from the web source.</summary>
    public const string StartFallback = "Start";

    /// <summary>i18n key for the end marker / legend label (web <c>t('driveDetail.end', 'End')</c>).</summary>
    public const string EndKey = "driveDetail.end";

    /// <summary>English fallback for the end label — verbatim from the web source.</summary>
    public const string EndFallback = "End";

    /// <summary>i18n key for the live-drive end-time fallback (web <c>t('driveDetail.inProgress', 'In progress')</c>).</summary>
    public const string InProgressKey = "driveDetail.inProgress";

    /// <summary>English fallback for the in-progress copy — verbatim from the web source.</summary>
    public const string InProgressFallback = "In progress";

    /// <summary>i18n key for the stationary anchor popup (web <c>t('driveDetail.lastKnown', 'Last known location')</c>).</summary>
    public const string LastKnownKey = "driveDetail.lastKnown";

    /// <summary>English fallback for the anchor popup — verbatim from the web source.</summary>
    public const string LastKnownFallback = "Last known location";

    /// <summary>i18n key for the stationary notice heading (web <c>t('driveDetail.stationaryRouteTitle', …)</c>).</summary>
    public const string StationaryTitleKey = "driveDetail.stationaryRouteTitle";

    /// <summary>English fallback for the stationary notice heading — verbatim from the web source.</summary>
    public const string StationaryTitleFallback = "Route can't be plotted";

    /// <summary>i18n key for the stationary notice body (web <c>t('driveDetail.stationaryRouteBody', …)</c>).</summary>
    public const string StationaryBodyKey = "driveDetail.stationaryRouteBody";

    /// <summary>English fallback for the stationary notice body — verbatim from the web source.</summary>
    public const string StationaryBodyFallback =
        "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. " +
        "The drive's distance, duration, and other stats below are unaffected.";

    /// <summary>i18n key for the empty-state copy (web <c>t('driveDetail.noRouteData', …)</c>).</summary>
    public const string NoRouteDataKey = "driveDetail.noRouteData";

    /// <summary>English fallback for the empty-state copy — verbatim from the web source.</summary>
    public const string NoRouteDataFallback = "No route data available for this drive";

    /// <summary>i18n key for the defensive skeleton's Narrator announcement.</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for the skeleton's Narrator announcement.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>Segoe Fluent "MapPin" glyph — the web Lucide <c>MapPin</c> icon (heading + empty state).</summary>
    public const string MapPinGlyph = "\uE707";

    /// <summary>Segoe Fluent "Flag" glyph — the web Lucide <c>Flag</c> icon (start / end legend runs).</summary>
    public const string FlagGlyph = "\uEB4F";

    /// <summary>Segoe Fluent "Streaming" glyph — the web Lucide <c>Navigation2</c> icon (stationary notice).</summary>
    public const string NavigationGlyph = "\uE809";
}

/// <summary>
/// PII-safe diagnostics for the <c>RouteMapSection</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a coordinate, address, drive id or timestamp —
/// so a diagnostics line can never leak a user's trip whereabouts. Thread-safe.
/// </summary>
public sealed class RouteMapSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public RouteMapSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RouteMapSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={RouteMapSectionRegistration.Slug}"));
    }
}
