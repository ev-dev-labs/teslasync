using System.Text;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.RouteDisplaySurface;

/// <summary>
/// Canonical metadata for the <c>RouteDisplay</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/data-display/RouteDisplay.tsx</c>: the stable diagnostics slug and the Segoe Fluent
/// Icons glyph that stands in for the web Lucide <c>MapPin</c> icon (the same <c>\uE707</c> "MapPin" glyph the
/// map tile layer and route-playback surfaces use). UI-free so the metadata is asserted in tests.
/// </summary>
public static class RouteDisplayRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "RouteDisplay";

    /// <summary>Segoe Fluent "MapPin" glyph — the web Lucide <c>MapPin</c> icon, shared with the map surfaces.</summary>
    public const string MapPinGlyph = "\uE707";
}

/// <summary>
/// The render-time data model the <c>RouteDisplay</c> view binds to — the native analogue of the web
/// <c>RouteDisplayProps</c> (<c>{ start, end?, roundTripThresholdM?, showIcon? }</c> in
/// web/src/components/data-display/RouteDisplay.tsx). The web component is purely presentational: its parent (a
/// Drives / Charging / Trips history row) owns any data fetching and feeds already-resolved endpoints, so —
/// exactly like React re-rendering the element with already-resolved props — there is no fetch-driven loading /
/// error / stale / offline branch to reproduce here; the only branches are the three the web renders ("no
/// location data", a round trip, and a distinct start → end), all of which always render and never hide. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Start">The starting endpoint (web <c>start</c>); an empty endpoint renders the no-location line.</param>
/// <param name="End">The ending endpoint (web <c>end</c>); <see langword="null"/> is an explicit single location.</param>
/// <param name="RoundTripThresholdMeters">
/// The coordinate threshold below which start ≈ end collapses to a round trip (web <c>roundTripThresholdM</c>,
/// default 100 m).
/// </param>
/// <param name="ShowIcon">When true the leading map-pin icon is rendered (web <c>showIcon</c>, default true).</param>
public sealed record RouteDisplayModel(
    RouteEndpoint Start,
    RouteEndpoint? End = null,
    double RoundTripThresholdMeters = RouteLogic.DefaultRoundTripThresholdMeters,
    bool ShowIcon = true)
{
    /// <summary>The initial / no-data model — an empty start and no end, rendering the muted no-location line.</summary>
    public static RouteDisplayModel None { get; } = new(new RouteEndpoint());

    /// <summary>A single-location model (web: only <c>start</c> supplied) — always a round trip with no note.</summary>
    /// <param name="start">The single endpoint (web <c>start</c>).</param>
    /// <param name="showIcon">When true the leading map-pin icon is rendered (web <c>showIcon</c>, default true).</param>
    public static RouteDisplayModel SingleLocation(RouteEndpoint start, bool showIcon = true) =>
        new(start, null, RouteLogic.DefaultRoundTripThresholdMeters, showIcon);

    /// <summary>A start → end model (web: both <c>start</c> and <c>end</c> supplied).</summary>
    /// <param name="start">The starting endpoint (web <c>start</c>).</param>
    /// <param name="end">The ending endpoint (web <c>end</c>).</param>
    /// <param name="roundTripThresholdMeters">The round-trip coordinate threshold (web <c>roundTripThresholdM</c>).</param>
    /// <param name="showIcon">When true the leading map-pin icon is rendered (web <c>showIcon</c>, default true).</param>
    public static RouteDisplayModel Between(
        RouteEndpoint start,
        RouteEndpoint end,
        double roundTripThresholdMeters = RouteLogic.DefaultRoundTripThresholdMeters,
        bool showIcon = true) =>
        new(start, end, roundTripThresholdMeters, showIcon);
}

/// <summary>
/// One run of the rendered route line — a slice of text and whether it is de-emphasised. Mirrors the web
/// opacity split: the resolved labels render at the ambient secondary foreground, while the no-location text and
/// the trailing "↻ round trip" note carry the web <c>opacity-60</c> de-emphasis (the native muted text token).
/// </summary>
/// <param name="Text">The visible text of this run.</param>
/// <param name="Muted">True when the run is de-emphasised (web <c>opacity-60</c> → the muted text token).</param>
public sealed record RouteDisplaySegment(string Text, bool Muted);

/// <summary>
/// The fully projected, render-ready view of a <see cref="RouteDisplayModel"/> — the native analogue of
/// everything the web component derives before returning JSX (web/src/components/data-display/RouteDisplay.tsx):
/// the resolved <see cref="Kind"/> (no-location / round-trip / point-to-point), the <see cref="ShowIcon"/> /
/// <see cref="IconGlyph"/> passthrough, the ordered <see cref="Segments"/> (each carrying its own muted flag),
/// the concatenated <see cref="VisibleText"/>, and the <see cref="AutomationName"/> Narrator reads. The web
/// component has no explicit <c>aria-label</c>, so the accessible name is the line's text content — exactly the
/// concatenation of the visible segments (the decorative map-pin is <c>aria-hidden</c> and contributes nothing).
/// Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Kind">Which layout the web resolved (no-location / round-trip / point-to-point).</param>
/// <param name="ShowIcon">Whether the leading map-pin icon is rendered (web <c>showIcon</c>).</param>
/// <param name="IconGlyph">The Segoe Fluent map-pin glyph (web Lucide <c>MapPin</c>).</param>
/// <param name="Segments">The ordered visible runs, each with its own muted flag.</param>
/// <param name="VisibleText">The whole line concatenated (the sighted reading order).</param>
/// <param name="AutomationName">The accessible name Narrator reads (the web line's text content).</param>
public sealed record RouteDisplayDisplay(
    RouteKind Kind,
    bool ShowIcon,
    string IconGlyph,
    IReadOnlyList<RouteDisplaySegment> Segments,
    string VisibleText,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="RouteDisplayModel"/> to its <see cref="RouteDisplayDisplay"/> — the native
/// port of web/src/components/data-display/RouteDisplay.tsx. The endpoint labelling, haversine distance and
/// round-trip detection are delegated to <see cref="RouteLogic"/> (the shared core port of the web
/// <c>endpointLabel</c> / <c>haversineMeters</c> helpers); this projection layers on the three web render
/// branches and the i18n exactly as the web source does:
/// <list type="bullet">
///   <item><description><c>RouteKind.None</c> (web <c>!startLabel &amp;&amp; !endLabel</c>) → a single muted
///   <c>route.noLocationData</c> run.</description></item>
///   <item><description><c>RouteKind.RoundTrip</c> → the start label at full emphasis, plus — only when an
///   explicit <c>end</c> was supplied (web <c>!isExplicitSingle</c>) — a muted " ↻ <c>route.roundTrip</c>"
///   note.</description></item>
///   <item><description><c>RouteKind.PointToPoint</c> → a single full-emphasis "<c>{start}</c> →
///   <c>{end}</c>" run, each side falling back to <c>route.noLocationData</c> when its label is missing.</description></item>
/// </list>
/// Every string resolves through the i18n facade with the exact keys the web source uses. No WinUI types — so
/// the projection is unit-tested without a UI host.
/// </summary>
public static class RouteDisplayProjection
{
    /// <summary>i18n key for the no-location text (web <c>'route.noLocationData'</c>).</summary>
    public const string NoLocationKey = "route.noLocationData";

    /// <summary>English fallback for <see cref="NoLocationKey"/> (web default value).</summary>
    public const string NoLocationFallback = "No location data";

    /// <summary>i18n key for the round-trip note (web <c>'route.roundTrip'</c>).</summary>
    public const string RoundTripKey = "route.roundTrip";

    /// <summary>English fallback for <see cref="RoundTripKey"/> (web default value).</summary>
    public const string RoundTripFallback = "round trip";

    /// <summary>The clockwise-circle-arrow glyph (U+21BB) prefixing the round-trip note (web <c>↻</c>).</summary>
    public const string RoundTripGlyph = "\u21BB";

    /// <summary>The arrow joining a distinct start and end, surrounded by spaces (web <c>` → `</c>, U+2192).</summary>
    public const string Arrow = " \u2192 ";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static RouteDisplayDisplay Project(RouteDisplayModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string noLocation = localizer.GetString(NoLocationKey, NoLocationFallback);
        RouteResult route = RouteLogic.Resolve(model.Start, model.End, model.RoundTripThresholdMeters);

        var segments = new List<RouteDisplaySegment>(2);
        switch (route.Kind)
        {
            case RouteKind.None:
                // web: !startLabel && !endLabel → a single muted "No location data" span.
                segments.Add(new RouteDisplaySegment(noLocation, Muted: true));
                break;

            case RouteKind.RoundTrip:
                // web: {startLabel}{!isExplicitSingle && <span className="opacity-60"> ↻ {roundTrip}</span>}.
                segments.Add(new RouteDisplaySegment(route.StartLabel ?? noLocation, Muted: false));
                if (!route.IsExplicitSingle)
                {
                    string roundTrip = localizer.GetString(RoundTripKey, RoundTripFallback);
                    segments.Add(new RouteDisplaySegment($" {RoundTripGlyph} {roundTrip}", Muted: true));
                }

                break;

            default:
                // web: {startLabel ?? noLocation} → {endLabel ?? noLocation} — one full-emphasis run.
                string start = route.StartLabel ?? noLocation;
                string end = route.EndLabel ?? noLocation;
                segments.Add(new RouteDisplaySegment(start + Arrow + end, Muted: false));
                break;
        }

        string visible = Concat(segments);

        return new RouteDisplayDisplay(
            Kind: route.Kind,
            ShowIcon: model.ShowIcon,
            IconGlyph: RouteDisplayRegistration.MapPinGlyph,
            Segments: segments,
            VisibleText: visible,
            AutomationName: visible);
    }

    private static string Concat(IReadOnlyList<RouteDisplaySegment> segments)
    {
        var sb = new StringBuilder();
        foreach (RouteDisplaySegment segment in segments)
        {
            sb.Append(segment.Text);
        }

        return sb.ToString();
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>RouteDisplay</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the addresses or coordinates — so a
/// diagnostics line can never leak a vehicle's location history. Thread-safe.
/// </summary>
public sealed class RouteDisplayDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public RouteDisplayDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RouteDisplay</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RouteDisplayRegistration.Slug}");
    }
}
