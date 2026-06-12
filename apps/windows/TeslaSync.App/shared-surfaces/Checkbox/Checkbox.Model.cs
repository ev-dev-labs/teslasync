namespace TeslaSync.App.SharedSurfaces.CheckboxSurface;

/// <summary>
/// Canonical metadata for the <c>Checkbox</c> shared surface — the native mirror of the web
/// <c>Checkbox</c> primitive (<c>web/src/components/ui/Checkbox.tsx</c>): the stable diagnostics slug. The
/// web component is anonymous (it renders no titles or labels of its own — the optional inline label is a
/// caller-supplied <c>ReactNode</c>), so this metadata carries only the slug the surface registers under.
/// UI-free so it is asserted without a XAML host.
/// </summary>
public static class CheckboxRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Checkbox";
}

/// <summary>
/// The visual size of the box — the native mirror of the web <c>CheckboxSize</c> union
/// (<c>'sm' | 'md' | 'lg'</c> in <c>web/src/components/ui/Checkbox.tsx</c>). The box and glyph dimensions are
/// a parity-driven pixel scale (the web Tailwind <c>h-3.5</c> / <c>h-4</c> / <c>h-5</c> box and
/// <c>h-2.5</c> / <c>h-3</c> / <c>h-3.5</c> icon classes), so <see cref="CheckboxMetricsTable.For"/> maps each
/// member to the matching pixel metrics rather than a typographic token role.
/// </summary>
public enum CheckboxSize
{
    /// <summary>web <c>'sm'</c> — a 14&#160;px box with a 10&#160;px glyph, used inline next to dense text.</summary>
    Sm,

    /// <summary>web <c>'md'</c> (default) — a 16&#160;px box with a 12&#160;px glyph, the standard form size.</summary>
    Md,

    /// <summary>web <c>'lg'</c> — a 20&#160;px box with a 14&#160;px glyph, used for prominent toggles.</summary>
    Lg,
}

/// <summary>
/// The mutually-exclusive visual state the box renders — the native projection of the web indicator's
/// <c>peer-checked</c> / <c>peer-indeterminate</c> branches (<c>web/src/components/ui/Checkbox.tsx</c>). The
/// web indicator shows exactly one of these: the empty box (<see cref="Unchecked"/>), the box with a check
/// glyph (<see cref="Checked"/>, web <c>Check</c> icon), or the box with a mixed dash (<see cref="Indeterminate"/>,
/// web <c>Minus</c> icon). The indeterminate (mixed) state takes precedence over checked exactly as the web
/// effect <c>el.indeterminate = indeterminate</c> overrides the visual regardless of the <c>checked</c> prop.
/// This is the complete state set the source renders: the primitive is presentational and prop-driven (its
/// consuming page owns any data fetching), so — like the shipped <c>ScoreBadge</c> / <c>Combobox</c> surfaces —
/// it has no loading / error / stale / offline chrome to reproduce.
/// </summary>
public enum CheckboxToggleState
{
    /// <summary>The empty box (web indicator with neither <c>checked</c> nor <c>indeterminate</c>).</summary>
    Unchecked,

    /// <summary>The box with a check glyph (web <c>peer-checked</c> + <c>Check</c> icon).</summary>
    Checked,

    /// <summary>The box with a mixed dash (web <c>peer-indeterminate</c> + <c>Minus</c> icon).</summary>
    Indeterminate,
}

/// <summary>
/// The parity pixel metrics for a <see cref="CheckboxSize"/> — the native analogue of the web <c>sizes</c>
/// table (<c>web/src/components/ui/Checkbox.tsx</c>). All values are device-independent pixels.
/// </summary>
/// <param name="BoxSize">The box edge length (web <c>sizes[size].box</c> — <c>h/w-3.5|4|5</c>).</param>
/// <param name="GlyphSize">The check / dash glyph size (web <c>sizes[size].icon</c> — <c>h/w-2.5|3|3.5</c>).</param>
/// <param name="LabelFontSize">The inline label font size (web label <c>text-sm</c> — 14&#160;px).</param>
/// <param name="Gap">The gap between the box and the label (web <c>gap-2</c> — 8&#160;px).</param>
/// <param name="CornerRadius">The box corner radius (web <c>rounded</c> — 4&#160;px).</param>
/// <param name="BorderThickness">The box stroke width (the Fluent checkbox stroke).</param>
public readonly record struct CheckboxMetrics(
    double BoxSize,
    double GlyphSize,
    double LabelFontSize,
    double Gap,
    double CornerRadius,
    double BorderThickness);

/// <summary>
/// Pure projection from a <see cref="CheckboxSize"/> to its <see cref="CheckboxMetrics"/> — the native port of
/// the web <c>sizes</c> lookup (<c>web/src/components/ui/Checkbox.tsx</c>). No WinUI types, so the parity scale
/// is unit-tested without a UI host.
/// </summary>
public static class CheckboxMetricsTable
{
    /// <summary>Inline label font size — web label <c>text-sm</c> (0.875rem ≈ 14&#160;px), shared by every size.</summary>
    public const double LabelFontSize = 14;

    /// <summary>Gap between the box and the inline label — web <c>gap-2</c> (0.5rem ≈ 8&#160;px).</summary>
    public const double Gap = 8;

    /// <summary>Box corner radius — web <c>rounded</c> (0.25rem ≈ 4&#160;px).</summary>
    public const double CornerRadius = 4;

    /// <summary>Box stroke width — the Fluent Design checkbox stroke (Windows 11 HIG).</summary>
    public const double BorderThickness = 2;

    /// <summary>The parity metrics for <paramref name="size"/> (the web <c>sizes[size]</c> entry).</summary>
    /// <param name="size">The visual size.</param>
    public static CheckboxMetrics For(CheckboxSize size) => size switch
    {
        // web sm: box h-3.5 w-3.5 (14 px), icon h-2.5 w-2.5 (10 px).
        CheckboxSize.Sm => new CheckboxMetrics(14, 10, LabelFontSize, Gap, CornerRadius, BorderThickness),

        // web lg: box h-5 w-5 (20 px), icon h-3.5 w-3.5 (14 px).
        CheckboxSize.Lg => new CheckboxMetrics(20, 14, LabelFontSize, Gap, CornerRadius, BorderThickness),

        // web md (default): box h-4 w-4 (16 px), icon h-3 w-3 (12 px).
        _ => new CheckboxMetrics(16, 12, LabelFontSize, Gap, CornerRadius, BorderThickness),
    };
}

/// <summary>
/// The outcome of a user-driven toggle — the new immutable <see cref="State"/>, the boolean the web
/// <c>onChange(checked)</c> callback reports (<see cref="IsChecked"/>), and whether the interaction actually
/// changed anything (<see cref="Changed"/>; false when the checkbox is disabled, matching the web
/// <c>if (disabled) return;</c> guard that fires no <c>onChange</c>).
/// </summary>
/// <param name="State">The state after the toggle (unchanged when the checkbox is disabled).</param>
/// <param name="IsChecked">The boolean reported to the web <c>onChange</c> callback.</param>
/// <param name="Changed">Whether the toggle changed the state and should fire the change event.</param>
public readonly record struct CheckboxToggleResult(CheckboxState State, bool IsChecked, bool Changed);

/// <summary>
/// The immutable render state of the checkbox — the native analogue of the web <c>Checkbox</c> props that
/// drive its appearance (<c>web/src/components/ui/Checkbox.tsx</c>): <see cref="IsChecked"/> (web
/// <c>checked</c>), <see cref="IsIndeterminate"/> (web <c>indeterminate</c>), <see cref="IsDisabled"/> (web
/// <c>disabled</c>), <see cref="Size"/> (web <c>size</c>) and the optional inline <see cref="Label"/> (web
/// <c>label</c>). Exposes the projected <see cref="ToggleState"/> and the accessible name, plus the pure
/// <see cref="Toggle"/> transition that reproduces the browser's checkbox semantics. Pure data — no WinUI
/// types — so every branch is asserted headlessly.
/// </summary>
/// <param name="IsChecked">Whether the box is checked (web <c>checked</c>).</param>
/// <param name="IsIndeterminate">Whether the box shows the mixed dash (web <c>indeterminate</c>); overrides checked.</param>
/// <param name="IsDisabled">Whether the box is non-interactive and dimmed (web <c>disabled</c>).</param>
/// <param name="Size">The visual size (web <c>size</c>, default <see cref="CheckboxSize.Md"/>).</param>
/// <param name="Label">The optional inline label, already localized by the caller (web <c>label</c>).</param>
public sealed record CheckboxState(
    bool IsChecked = false,
    bool IsIndeterminate = false,
    bool IsDisabled = false,
    CheckboxSize Size = CheckboxSize.Md,
    string? Label = null)
{
    /// <summary>
    /// The projected visual state — indeterminate takes precedence over checked (web
    /// <c>el.indeterminate = indeterminate</c> wins over the <c>checked</c> prop), then checked, then the
    /// empty box.
    /// </summary>
    public CheckboxToggleState ToggleState =>
        IsIndeterminate ? CheckboxToggleState.Indeterminate
        : IsChecked ? CheckboxToggleState.Checked
        : CheckboxToggleState.Unchecked;

    /// <summary>
    /// The accessible name Narrator reads — the caller-supplied inline label (web: the checkbox's label is
    /// its accessible name). Empty when the surface is mounted without a label (the web anonymous case, where
    /// the consuming page supplies an <c>aria-label</c> through the spread input props).
    /// </summary>
    public string AccessibleName => Label ?? string.Empty;

    /// <summary>
    /// Apply a user toggle, reproducing the browser checkbox semantics the web <c>onChange</c> handler relies
    /// on: a disabled box is unchanged and reports no change (web <c>if (disabled) return;</c>); clicking an
    /// indeterminate box resolves it to checked and clears the mixed state (the browser sets
    /// <c>checked = true, indeterminate = false</c>); otherwise the checked flag flips.
    /// </summary>
    /// <returns>The next state, the reported boolean, and whether anything changed.</returns>
    public CheckboxToggleResult Toggle()
    {
        if (IsDisabled)
        {
            return new CheckboxToggleResult(this, IsChecked, Changed: false);
        }

        bool nextChecked = IsIndeterminate || !IsChecked;
        CheckboxState next = this with { IsChecked = nextChecked, IsIndeterminate = false };
        return new CheckboxToggleResult(next, nextChecked, Changed: true);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>Checkbox</c> surface (P1/S11 diagnostics contract). A checkbox's label can
/// carry arbitrary user-facing content, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never the label or the checked value.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class CheckboxDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public CheckboxDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Checkbox</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CheckboxRegistration.Slug}");
    }
}
