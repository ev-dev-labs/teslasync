using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + the two render-contract i18n keys for the trip-replay timeline scrubber — the native
/// mirror of the web <c>TimelineScrubber</c> (web/src/components/data-display/TimelineScrubber.tsx). The web
/// component is presentational and fully controlled: it draws a progress track with keyframe marker ticks, a
/// hover preview tooltip and a drag-to-scrub playhead, announcing the chosen position through its
/// <c>onSeek</c> prop. It resolves exactly two strings through <c>t()</c> — the slider <c>aria-label</c>
/// (<c>replay.controls.progress</c>) and the marker percent suffix (<c>replay.markers.atPercent</c>) — so this
/// metadata carries those keys + their English fallbacks verbatim, plus the diagnostics slug the surface
/// registers under. The keys carry the <c>translation.</c> catalog prefix the WinUI resource bridge expects and
/// resolve against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class TimelineScrubberRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TimelineScrubber";

    /// <summary>i18n key for the slider's accessible name (web <c>replay.controls.progress</c>).</summary>
    public const string ProgressKey = "translation.replay.controls.progress";

    /// <summary>English fallback for <see cref="ProgressKey"/> (web second arg, verbatim).</summary>
    public const string ProgressFallback = "Playback progress";

    /// <summary>
    /// i18n key for the marker percent suffix (web <c>replay.markers.atPercent</c>). The web source interpolates
    /// <c>{{pct}}</c>; the catalog stores the value with the .NET positional token <c>{0}</c>, so the
    /// resolved string is composed with <see cref="string.Format(IFormatProvider, string, object)"/>.
    /// </summary>
    public const string AtPercentKey = "translation.replay.markers.atPercent";

    /// <summary>
    /// English fallback for <see cref="AtPercentKey"/> in .NET positional form — the transform of the web
    /// <c>'at {{pct}}%'</c> token into <c>'at {0}%'</c>, matching the P1/S10 catalog entry.
    /// </summary>
    public const string AtPercentFallback = "at {0}%";

    /// <summary>
    /// Smooth-scrub interval in milliseconds: while dragging, intermediate seeks are emitted at most this often
    /// (web <c>SCRUB_INTERVAL_MS = 50</c>).
    /// </summary>
    public const long SmoothScrubIntervalMs = 50;
}

/// <summary>
/// The kinds of keyframe marker the scrubber renders along the track — the native port of the web
/// <c>TimelineMarkerKind</c> union (web/src/components/data-display/TimelineScrubber.tsx L11-L19). Each maps to
/// a stable wire token (<see cref="TimelineMarkerKinds.Wire"/>) and a theme-aware tick brush
/// (<see cref="TimelineMarkerKinds.BrushKey"/>).
/// </summary>
public enum TimelineMarkerKind
{
    /// <summary>Drive start (web <c>'start'</c>).</summary>
    Start,

    /// <summary>Drive end (web <c>'stop'</c>).</summary>
    Stop,

    /// <summary>Charging session began (web <c>'charge-start'</c>).</summary>
    ChargeStart,

    /// <summary>Charging session ended (web <c>'charge-stop'</c>).</summary>
    ChargeStop,

    /// <summary>A notably fast segment (web <c>'fast-segment'</c>).</summary>
    FastSegment,

    /// <summary>A regeneration power peak (web <c>'regen-peak'</c>).</summary>
    RegenPeak,

    /// <summary>A low state-of-charge moment (web <c>'low-soc'</c>).</summary>
    LowSoc,

    /// <summary>A generic clustered event (web <c>'event'</c>).</summary>
    Event,
}

/// <summary>
/// Pure mapping helpers for <see cref="TimelineMarkerKind"/> — the native port of the web kind union + its
/// <c>MARKER_COLORS</c> token map (web/src/components/data-display/TimelineScrubber.tsx L11-L84). <see cref="Wire"/>
/// renders the exact kebab-case identifier the web source uses (so the no-label accessible name and the tooltip
/// fallback read identically to the web), and <see cref="BrushKey"/> maps each kind onto a theme-aware
/// design-token brush resource key (never a hard-coded hex), mirroring the web Tailwind severity colours. Static
/// and side-effect-free so the mapping is unit-tested without a UI thread.
/// </summary>
public static class TimelineMarkerKinds
{
    /// <summary>The web wire identifier for a kind (e.g. <see cref="TimelineMarkerKind.ChargeStart"/> → <c>charge-start</c>).</summary>
    public static string Wire(TimelineMarkerKind kind) => kind switch
    {
        TimelineMarkerKind.Start => "start",
        TimelineMarkerKind.Stop => "stop",
        TimelineMarkerKind.ChargeStart => "charge-start",
        TimelineMarkerKind.ChargeStop => "charge-stop",
        TimelineMarkerKind.FastSegment => "fast-segment",
        TimelineMarkerKind.RegenPeak => "regen-peak",
        TimelineMarkerKind.LowSoc => "low-soc",
        _ => "event",
    };

    /// <summary>
    /// The theme-aware tick brush resource key for a kind. Maps the web <c>MARKER_COLORS</c> Tailwind classes onto
    /// the generated design tokens: start/charge-start → success, stop/low-soc → danger, charge-stop/fast-segment
    /// → warning, regen-peak → the regen chart accent, and the generic event → muted text. Resolved against the
    /// merged token dictionaries at the view layer so light / dark / high-contrast all flow from W1.
    /// </summary>
    public static string BrushKey(TimelineMarkerKind kind) => kind switch
    {
        TimelineMarkerKind.Start => "TsColorSuccessBrush",
        TimelineMarkerKind.Stop => "TsColorDangerBrush",
        TimelineMarkerKind.ChargeStart => "TsColorSuccessBrush",
        TimelineMarkerKind.ChargeStop => "TsColorWarningBrush",
        TimelineMarkerKind.FastSegment => "TsColorWarningBrush",
        TimelineMarkerKind.RegenPeak => "TsChartRegenBrush",
        TimelineMarkerKind.LowSoc => "TsColorDangerBrush",
        _ => "TsColorTextMutedBrush",
    };
}

/// <summary>
/// A notable moment along the timeline — the native port of the web <c>TimelineMarker</c> interface
/// (web/src/components/data-display/TimelineScrubber.tsx L21-L31). <see cref="At"/> is the normalised 0..1
/// position (clamped on construction, like the web <c>left</c> clamp); <see cref="Kind"/> drives the tick colour
/// and the no-label accessible name; <see cref="Label"/> is the optional hover-tooltip / accessible label;
/// <see cref="Href"/> is the optional route a click can follow instead of seeking; and <see cref="Count"/>
/// surfaces a clustered-event count badge when greater than one.
/// </summary>
public sealed class TimelineMarker
{
    /// <summary>Creates a marker at a normalised position (clamped to 0..1), with an optional label/href/count.</summary>
    public TimelineMarker(
        double at,
        TimelineMarkerKind kind,
        string? label = null,
        string? href = null,
        int? count = null)
    {
        At = TimelineScrubberMath.Clamp01(at);
        Kind = kind;
        Label = label;
        Href = href;
        Count = count;
    }

    /// <summary>Normalised 0..1 position along the timeline (web <c>at</c>).</summary>
    public double At { get; }

    /// <summary>The marker kind, driving its tick colour (web <c>kind</c>).</summary>
    public TimelineMarkerKind Kind { get; }

    /// <summary>Optional label rendered in the marker's tooltip and accessible name (web <c>label</c>).</summary>
    public string? Label { get; }

    /// <summary>Optional route a marker click can follow instead of seeking (web <c>href</c>).</summary>
    public string? Href { get; }

    /// <summary>Optional clustered-event count; a badge is shown when greater than one (web <c>count</c>).</summary>
    public int? Count { get; }

    /// <summary>True when a clustered-event count badge should be shown (web <c>count != null &amp;&amp; count &gt; 1</c>).</summary>
    public bool ShowCountBadge => Count is > 1;
}

/// <summary>
/// Pre-formatted preview values sampled for a normalised timeline position — the native port of the web
/// <c>TimelinePreviewPoint</c> interface (web/src/components/data-display/TimelineScrubber.tsx L33-L41). The
/// scrubber does no number formatting itself: the caller's sampler returns already-formatted strings (e.g.
/// <c>"63 mph"</c>), which the hover tooltip renders verbatim.
/// </summary>
public sealed class TimelinePreviewPoint
{
    /// <summary>Creates a preview point for a normalised position with optional pre-formatted readouts.</summary>
    public TimelinePreviewPoint(
        double at,
        string? speed = null,
        string? power = null,
        string? soc = null,
        string? elevation = null)
    {
        At = TimelineScrubberMath.Clamp01(at);
        Speed = speed;
        Power = power;
        Soc = soc;
        Elevation = elevation;
    }

    /// <summary>The normalised 0..1 position this preview was sampled for (web <c>at</c>).</summary>
    public double At { get; }

    /// <summary>Pre-formatted speed readout, or null (web <c>speed</c>).</summary>
    public string? Speed { get; }

    /// <summary>Pre-formatted power readout, or null (web <c>power</c>).</summary>
    public string? Power { get; }

    /// <summary>Pre-formatted state-of-charge readout, or null (web <c>soc</c>).</summary>
    public string? Soc { get; }

    /// <summary>Pre-formatted elevation readout, or null (web <c>elevation</c>).</summary>
    public string? Elevation { get; }

    /// <summary>True when at least one readout is present (drives whether the tooltip has measurement rows).</summary>
    public bool HasReadouts =>
        !string.IsNullOrEmpty(Speed) ||
        !string.IsNullOrEmpty(Power) ||
        !string.IsNullOrEmpty(Soc) ||
        !string.IsNullOrEmpty(Elevation);
}

/// <summary>
/// The pure geometry + formatting helpers behind the scrubber — the native port of the web component's inline
/// maths (web/src/components/data-display/TimelineScrubber.tsx: the <c>clamp</c> calls, <c>positionAtClientX</c>,
/// <c>ariaValueText</c>, the preview-time formatting and the marker accessible-name composition). Every method is
/// static, culture-explicit and side-effect-free so the scrubber's behaviour is unit-tested without a view or a
/// UI thread. Rounding mirrors JavaScript's <c>Math.round</c> (half away from zero) for the non-negative percent
/// and clock values the surface produces.
/// </summary>
public static class TimelineScrubberMath
{
    /// <summary>Clamp a value to 0..1, treating NaN as 0 (web <c>Math.max(0, Math.min(1, v))</c>).</summary>
    public static double Clamp01(double value) =>
        double.IsNaN(value) ? 0 : Math.Max(0, Math.Min(1, value));

    /// <summary>Clamp an optional buffered position to 0..1, preserving null (web <c>clampedBuffered</c>).</summary>
    public static double? ClampBuffered(double? value) =>
        value is null ? null : Clamp01(value.Value);

    /// <summary>
    /// Map a pointer X (in track-local pixels) to a normalised 0..1 position (web <c>positionAtClientX</c>:
    /// <c>(clientX - rect.left) / rect.width</c>, clamped). A non-positive <paramref name="width"/> yields 0.
    /// </summary>
    public static double NormalizedFromX(double clientX, double left, double width) =>
        width <= 0 ? 0 : Clamp01((clientX - left) / width);

    /// <summary>The integer percent for a normalised position (web <c>Math.round(value * 100)</c>).</summary>
    public static int Percent(double normalized) =>
        (int)Math.Round(Clamp01(normalized) * 100, MidpointRounding.AwayFromZero);

    /// <summary>The percent (0..100, as a double) used for absolute positioning of the fill / playhead / ghost.</summary>
    public static double PercentExact(double normalized) => Clamp01(normalized) * 100;

    /// <summary>
    /// Format a duration in seconds as the web clock string <c>m:ss</c> (web template
    /// <c>`${m}:${String(sec).padStart(2, '0')}`</c>, with <c>m = Math.floor(s / 60)</c>). Minutes are not
    /// zero-padded and may exceed 59 (the web source does not roll over into hours); seconds are always two
    /// digits. Negative inputs are floored at zero.
    /// </summary>
    public static string FormatClock(double seconds)
    {
        long total = (long)Math.Round(Math.Max(0, seconds), MidpointRounding.AwayFromZero);
        long minutes = total / 60;
        long secs = total % 60;
        return string.Create(CultureInfo.InvariantCulture, $"{minutes}:{secs:D2}");
    }

    /// <summary>
    /// The slider <c>aria-valuetext</c> — the formatted playback time at the current progress, or null when the
    /// duration is non-finite or non-positive (web <c>ariaValueText</c>: returns <c>undefined</c> in that case).
    /// </summary>
    public static string? AriaValueText(double duration, double progress)
    {
        if (!double.IsFinite(duration) || duration <= 0)
        {
            return null;
        }

        return FormatClock(duration * Clamp01(progress));
    }

    /// <summary>
    /// The preview tooltip's time line — the formatted time at <paramref name="previewAt"/>, or null when the
    /// duration is non-finite or non-positive (web <c>previewTimeStr</c>).
    /// </summary>
    public static string? PreviewTimeText(double duration, double previewAt)
    {
        if (!double.IsFinite(duration) || duration <= 0)
        {
            return null;
        }

        return FormatClock(duration * Clamp01(previewAt));
    }

    /// <summary>
    /// The marker's accessible name — the native port of the web <c>TimelineMarkerTick</c> aria-label
    /// (web/src/components/data-display/TimelineScrubber.tsx L387-L389): when the marker has a label it reads
    /// <c>"{label} {atPercent}"</c> (the percent suffix resolved through the i18n facade and composed with the
    /// resolved <c>{0}</c> template); otherwise it reads <c>"{kind} {pct}%"</c> using the raw wire kind, exactly
    /// like the web fallback.
    /// </summary>
    public static string MarkerAccessibleName(TimelineMarker marker, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(marker);
        ArgumentNullException.ThrowIfNull(localizer);

        int pct = Percent(marker.At);
        if (!string.IsNullOrEmpty(marker.Label))
        {
            string template = localizer.GetString(
                TimelineScrubberRegistration.AtPercentKey,
                TimelineScrubberRegistration.AtPercentFallback);
            string suffix = string.Format(CultureInfo.CurrentCulture, template, pct);
            return string.Create(CultureInfo.CurrentCulture, $"{marker.Label} {suffix}");
        }

        return string.Create(
            CultureInfo.InvariantCulture,
            $"{TimelineMarkerKinds.Wire(marker.Kind)} {pct}%");
    }

    /// <summary>
    /// The marker's tooltip content — the marker label, falling back to the raw wire kind (web
    /// <c>content={marker.label ?? marker.kind}</c>).
    /// </summary>
    public static string MarkerTooltip(TimelineMarker marker)
    {
        ArgumentNullException.ThrowIfNull(marker);
        return string.IsNullOrEmpty(marker.Label) ? TimelineMarkerKinds.Wire(marker.Kind) : marker.Label;
    }
}

/// <summary>
/// PII-safe diagnostics for the timeline scrubber (P1/S11 diagnostics contract). The surface carries only a
/// transient playback position and interaction state, so the collector records nothing but the operational
/// <c>view.opened</c> event with the surface slug — never a position, marker or seek. Thread-safe; mirrors the
/// shipped surfaces' collectors.
/// </summary>
public sealed class TimelineScrubberDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public TimelineScrubberDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TimelineScrubber</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TimelineScrubberRegistration.Slug}");
    }
}
