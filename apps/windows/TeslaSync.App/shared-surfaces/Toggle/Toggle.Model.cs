namespace TeslaSync.App.SharedSurfaces.ToggleSurface;

/// <summary>
/// Canonical metadata for the <c>Toggle</c> shared surface — the native mirror of the web <c>Toggle</c>
/// primitive (<c>web/src/components/ui/Toggle.tsx</c>): the stable diagnostics slug. The web component is
/// anonymous (it renders no titles of its own — the optional inline label is a caller-supplied, already
/// localized string), so this metadata carries only the slug the surface registers under. UI-free so it is
/// asserted without a XAML host.
/// </summary>
public static class ToggleRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Toggle";
}

/// <summary>
/// The visual size of the switch — the native mirror of the web <c>size</c> union (<c>'sm' | 'md'</c> in
/// <c>web/src/components/ui/Toggle.tsx</c>). The track and thumb dimensions are a parity-driven pixel scale
/// (the web Tailwind <c>h-5 w-9</c> / <c>h-6 w-11</c> track and <c>h-3.5</c> / <c>h-5</c> thumb classes), so
/// <see cref="ToggleMetricsTable.For"/> maps each member to the matching pixel metrics rather than a
/// typographic token role.
/// </summary>
public enum ToggleSize
{
    /// <summary>web <c>'sm'</c> — a 36&#215;20&#160;px track with a 14&#160;px thumb, used inline next to dense text.</summary>
    Sm,

    /// <summary>web <c>'md'</c> (default) — a 44&#215;24&#160;px track with a 20&#160;px thumb, the standard form size.</summary>
    Md,
}

/// <summary>
/// The mutually-exclusive visual state the track renders — the native projection of the web button's
/// <c>checked</c> branch (<c>web/src/components/ui/Toggle.tsx</c>). The web track shows exactly one of these:
/// the neutral off track with the thumb at the start (<see cref="Off"/>, web
/// <c>bg-gray-300 dark:bg-gray-600</c>) or the accent on track with the thumb slid to the end
/// (<see cref="On"/>, web <c>bg-cyan-500 dark:bg-cyan-600</c> + the <c>translate-x</c> thumb shift). This is
/// the complete state set the source renders: the primitive is presentational and prop-driven (its consuming
/// page owns any data fetching), so — like the shipped <c>Checkbox</c> / <c>ScoreBadge</c> / <c>Combobox</c>
/// surfaces — it has no loading / empty / error / stale / offline chrome to reproduce. Unlike the web
/// <c>Checkbox</c>, the web <c>Toggle</c> exposes no <c>disabled</c> or <c>indeterminate</c> prop, so the
/// surface faithfully omits those states too.
/// </summary>
public enum ToggleVisualState
{
    /// <summary>The neutral off track with the thumb at the start (web switch with <c>checked == false</c>).</summary>
    Off,

    /// <summary>The accent on track with the thumb slid to the end (web switch with <c>checked == true</c>).</summary>
    On,
}

/// <summary>
/// The parity pixel metrics for a <see cref="ToggleSize"/> — the native analogue of the web <c>trackSize</c>,
/// <c>thumbSize</c> and <c>thumbTranslate</c> tables (<c>web/src/components/ui/Toggle.tsx</c>). All values are
/// device-independent pixels. The derived <see cref="ThumbInset"/>, <see cref="ThumbTravel"/>,
/// <see cref="TrackCornerRadius"/> and <see cref="ThumbCornerRadius"/> are computed from the raw dimensions so
/// the thumb is perfectly centered in the track and slides between symmetric end insets — the polished,
/// Windows-idiomatic reading of the web geometry, whose computed travel equals the web
/// <c>translate-x-4</c> / <c>translate-x-5</c> shift exactly.
/// </summary>
/// <param name="TrackWidth">The track width (web <c>w-9</c> = 36&#160;px / <c>w-11</c> = 44&#160;px).</param>
/// <param name="TrackHeight">The track height (web <c>h-5</c> = 20&#160;px / <c>h-6</c> = 24&#160;px).</param>
/// <param name="ThumbSize">The thumb edge length (web <c>h/w-3.5</c> = 14&#160;px / <c>h/w-5</c> = 20&#160;px).</param>
/// <param name="LabelFontSize">The inline label font size (web label <c>text-sm</c> — 14&#160;px).</param>
/// <param name="Gap">The gap between the track and the label (web <c>gap-2</c> — 8&#160;px).</param>
public readonly record struct ToggleMetrics(
    double TrackWidth,
    double TrackHeight,
    double ThumbSize,
    double LabelFontSize,
    double Gap)
{
    /// <summary>
    /// The inset of the thumb from each track edge — half the difference between the track height and the
    /// thumb so the thumb is vertically centered (the native reading of the web <c>translate-y</c> offset).
    /// </summary>
    public double ThumbInset => (TrackHeight - ThumbSize) / 2;

    /// <summary>
    /// The horizontal distance the thumb slides from off to on — the track width less the thumb and both end
    /// insets. Equals the web <c>translate-x-4</c> (16&#160;px) / <c>translate-x-5</c> (20&#160;px) shift.
    /// </summary>
    public double ThumbTravel => TrackWidth - ThumbSize - (2 * ThumbInset);

    /// <summary>The track corner radius — half the track height, making the web <c>rounded-full</c> pill.</summary>
    public double TrackCornerRadius => TrackHeight / 2;

    /// <summary>The thumb corner radius — half the thumb size, making the web <c>rounded-full</c> circle.</summary>
    public double ThumbCornerRadius => ThumbSize / 2;
}

/// <summary>
/// Pure projection from a <see cref="ToggleSize"/> to its <see cref="ToggleMetrics"/> — the native port of the
/// web <c>trackSize</c> / <c>thumbSize</c> / <c>thumbTranslate</c> lookups
/// (<c>web/src/components/ui/Toggle.tsx</c>). No WinUI types, so the parity scale is unit-tested without a UI
/// host.
/// </summary>
public static class ToggleMetricsTable
{
    /// <summary>Inline label font size — web label <c>text-sm</c> (0.875rem &#8776; 14&#160;px), shared by every size.</summary>
    public const double LabelFontSize = 14;

    /// <summary>Gap between the track and the inline label — web <c>gap-2</c> (0.5rem &#8776; 8&#160;px).</summary>
    public const double Gap = 8;

    /// <summary>The parity metrics for <paramref name="size"/> (the web <c>trackSize[size]</c> / <c>thumbSize[size]</c> entry).</summary>
    /// <param name="size">The visual size.</param>
    public static ToggleMetrics For(ToggleSize size) => size switch
    {
        // web sm: track h-5 w-9 (20 x 36 px), thumb h-3.5 w-3.5 (14 px), travel translate-x-4 (16 px).
        ToggleSize.Sm => new ToggleMetrics(36, 20, 14, LabelFontSize, Gap),

        // web md (default): track h-6 w-11 (24 x 44 px), thumb h-5 w-5 (20 px), travel translate-x-5 (20 px).
        _ => new ToggleMetrics(44, 24, 20, LabelFontSize, Gap),
    };
}

/// <summary>
/// The outcome of a user-driven toggle — the new immutable <see cref="State"/> and the boolean the web
/// <c>onChange(checked)</c> callback reports (<see cref="IsChecked"/>). The web <c>Toggle</c> has no disabled
/// guard, so a toggle always flips the value; this type mirrors the web change payload for the view-model and
/// keeps the transition headlessly testable.
/// </summary>
/// <param name="State">The state after the toggle.</param>
/// <param name="IsChecked">The boolean reported to the web <c>onChange</c> callback.</param>
public readonly record struct ToggleResult(ToggleState State, bool IsChecked);

/// <summary>
/// The immutable render state of the switch — the native analogue of the web <c>Toggle</c> props that drive
/// its appearance (<c>web/src/components/ui/Toggle.tsx</c>): <see cref="IsChecked"/> (web <c>checked</c>),
/// <see cref="Size"/> (web <c>size</c>) and the optional inline <see cref="Label"/> (web <c>label</c>).
/// Exposes the projected <see cref="VisualState"/> and the accessible name, plus the pure <see cref="Toggle"/>
/// transition that flips the value the way the web button's <c>onChange(!checked)</c> handler does. Pure data
/// — no WinUI types — so every branch is asserted headlessly.
/// </summary>
/// <param name="IsChecked">Whether the switch is on (web <c>checked</c>).</param>
/// <param name="Size">The visual size (web <c>size</c>, default <see cref="ToggleSize.Md"/>).</param>
/// <param name="Label">The optional inline label, already localized by the caller (web <c>label</c>).</param>
public sealed record ToggleState(
    bool IsChecked = false,
    ToggleSize Size = ToggleSize.Md,
    string? Label = null)
{
    /// <summary>The projected visual state — the accent on track when checked, otherwise the neutral off track.</summary>
    public ToggleVisualState VisualState => IsChecked ? ToggleVisualState.On : ToggleVisualState.Off;

    /// <summary>
    /// The accessible name Narrator reads — the caller-supplied inline label (web: the switch's label is its
    /// accessible name, associated via <c>aria-labelledby</c>). Empty when the surface is mounted without a
    /// label (the web anonymous case, where the consuming page supplies an <c>aria-label</c> through the
    /// spread props).
    /// </summary>
    public string AccessibleName => Label ?? string.Empty;

    /// <summary>
    /// Apply a user toggle, flipping the on/off value the way the web button's <c>onClick</c> fires
    /// <c>onChange(!checked)</c>. The web component has no disabled state, so this always changes the value.
    /// </summary>
    /// <returns>The next state and the reported boolean.</returns>
    public ToggleResult Toggle()
    {
        ToggleState next = this with { IsChecked = !IsChecked };
        return new ToggleResult(next, next.IsChecked);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>Toggle</c> surface (P1/S11 diagnostics contract). A switch's label can
/// carry arbitrary user-facing content, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never the label or the on/off value.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class ToggleDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public ToggleDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Toggle</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ToggleRegistration.Slug}");
    }
}
