using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.SelectSurface;

/// <summary>
/// Canonical metadata for the <c>Select</c> shared surface — the native mirror of the module-level constants in
/// the web <c>Select</c> primitive (<c>web/src/components/ui/Select.tsx</c>), the shared accessible dropdown used
/// by settings forms, filter bars and bulk-action toolbars. The web component composes a form <c>&lt;Label&gt;</c>
/// (with a visible + screen-reader <c>required</c> marker) and an optional field-level <c>&lt;HelpIcon&gt;</c>
/// around a native <c>&lt;select&gt;</c>, so this carries the diagnostics slug, the three fixed i18n keys it owns
/// (the label's <c>form.required</c> marker, the help icon's per-field <c>a11y.helpFor</c> accessible name and its
/// generic <c>help.tooltip.iconLabel</c> fallback) with their verbatim English fallbacks, the Segoe Fluent glyph
/// that stands in for the web Lucide <c>HelpCircle</c>, and the shared corner-radius / border metrics. UI-free so
/// the mapping is asserted in tests without a XAML runtime.
/// </summary>
public static partial class SelectRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Select";

    /// <summary>i18n key for the label's required marker's screen-reader text (web <c>t('form.required')</c>).</summary>
    public const string RequiredKey = "translation.form.required";

    /// <summary>English fallback for <see cref="RequiredKey"/> (web Label second arg, verbatim).</summary>
    public const string RequiredFallback = "required";

    /// <summary>i18n key for the help icon's per-field accessible name (web <c>t('a11y.helpFor', { field })</c>).</summary>
    public const string HelpForKey = "translation.a11y.helpFor";

    /// <summary>English fallback for <see cref="HelpForKey"/> — a <c>{0}</c> field slot (web <c>`Help for ${forId}`</c>).</summary>
    public const string HelpForFallback = "Help for {0}";

    /// <summary>i18n key for the help icon's generic accessible name (web <c>t('help.tooltip.iconLabel')</c>).</summary>
    public const string HelpIconLabelKey = "translation.help.tooltip.iconLabel";

    /// <summary>English fallback for <see cref="HelpIconLabelKey"/> (web HelpIcon default, verbatim).</summary>
    public const string HelpIconLabelFallback = "More info";

    /// <summary>Segoe Fluent "Help" glyph — the native stand-in for the web Lucide <c>HelpCircle</c> help icon.</summary>
    public const string HelpGlyph = "\uE897";

    /// <summary>Trigger glyph font size for the field-level help icon (web <c>HelpCircle h-3.5 w-3.5</c> ≈ 14&#160;px).</summary>
    public const double HelpGlyphSize = 14;

    /// <summary>The dropdown corner radius — web <c>rounded-md</c> (0.375rem ≈ 6&#160;px), shared by every size.</summary>
    public const double CornerRadius = 6;

    /// <summary>The dropdown stroke width — web <c>border</c> (1&#160;px), shared by every size.</summary>
    public const double BorderThickness = 1;

    /// <summary>Vertical gap between the label row, the dropdown and the error / hint line — web root <c>space-y-1</c> (0.25rem ≈ 4&#160;px).</summary>
    public const double StackSpacing = 4;

    /// <summary>Horizontal gap between the label and the help icon — web label row <c>gap-1</c> (0.25rem ≈ 4&#160;px).</summary>
    public const double LabelGap = 4;

    /// <summary>Font size for the error / hint helper line — web <c>text-xs</c> (0.75rem ≈ 12&#160;px).</summary>
    public const double HelperFontSize = 12;

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespacePattern();

    /// <summary>
    /// Derive the field id from a label exactly as the web does
    /// (<c>label.toLowerCase().replace(/\s+/g, '-')</c>, <c>Select.tsx</c> L41): lower-case and replace every run of
    /// whitespace with a single hyphen. Used to wire the error / hint <c>aria-describedby</c> ids and the help
    /// icon's per-field accessible name when no explicit id is supplied.
    /// </summary>
    /// <param name="label">The label text.</param>
    /// <returns>The slugified field id.</returns>
    public static string Slugify(string label)
    {
        ArgumentNullException.ThrowIfNull(label);
        return WhitespacePattern().Replace(label, "-").ToLowerInvariant();
    }
}

/// <summary>
/// The sizing scale of the dropdown — the native mirror of the web <c>SelectProps['size']</c> union
/// (<c>'sm' | 'md' | 'lg' | 'auto'</c>, <c>Select.tsx</c> L29). The padding / font scale is parity-driven from the
/// web <c>sizeClasses</c> table, so <see cref="SelectMetricsTable.For"/> maps each member to the matching pixel
/// metrics. <see cref="Auto"/> follows the user's <c>ui_density</c> setting on the web; the native baseline density
/// resolves it to the standard (<see cref="Md"/>) spacing with a comfortable touch-row minimum height.
/// </summary>
public enum SelectSize
{
    /// <summary>web <c>'sm'</c> — <c>px-2 py-1.5 text-xs</c>: a dense 12&#160;px dropdown for inline filters.</summary>
    Sm,

    /// <summary>web <c>'md'</c> (default) — <c>px-3 py-2 text-sm</c>: the standard 14&#160;px form dropdown.</summary>
    Md,

    /// <summary>web <c>'lg'</c> — <c>px-4 py-2.5 text-base</c>: a prominent 16&#160;px dropdown.</summary>
    Lg,

    /// <summary>web <c>'auto'</c> — density-aware (<c>ui_density</c>); resolves to the standard density baseline.</summary>
    Auto,
}

/// <summary>
/// Where the help icon's tooltip sits relative to its trigger — the native analogue of the web
/// <c>HelpIconProps['side']</c> union (<c>'top' | 'bottom' | 'left' | 'right'</c>, <c>HelpIcon.tsx</c> L49).
/// <see cref="Top"/> is the web default. The WinUI view maps this to a <c>PlacementMode</c> at the platform boundary.
/// </summary>
public enum SelectHelpPlacement
{
    /// <summary>web <c>'top'</c> — above the trigger; the default.</summary>
    Top,

    /// <summary>web <c>'bottom'</c> — below the trigger.</summary>
    Bottom,

    /// <summary>web <c>'left'</c> — to the left of the trigger.</summary>
    Left,

    /// <summary>web <c>'right'</c> — to the right of the trigger.</summary>
    Right,
}

/// <summary>
/// The parity pixel metrics for a <see cref="SelectSize"/> — the native analogue of the web <c>sizeClasses</c>
/// table (<c>Select.tsx</c> L32-37). All values are device-independent pixels.
/// </summary>
/// <param name="FontSize">The dropdown text size (web <c>text-xs|sm|base</c> — 12 / 14 / 16&#160;px).</param>
/// <param name="PaddingX">The horizontal content padding (web <c>px-2|3|4</c> — 8 / 12 / 16&#160;px).</param>
/// <param name="PaddingY">The vertical content padding (web <c>py-1.5|2|2.5</c> — 6 / 8 / 10&#160;px).</param>
/// <param name="MinHeight">The minimum row height (web <c>auto</c> only — <c>min-h-d-row</c>; 0 for the fixed tiers).</param>
/// <param name="CornerRadius">The dropdown corner radius (web <c>rounded-md</c> — 6&#160;px).</param>
/// <param name="BorderThickness">The dropdown stroke width (web <c>border</c> — 1&#160;px).</param>
public readonly record struct SelectMetrics(
    double FontSize,
    double PaddingX,
    double PaddingY,
    double MinHeight,
    double CornerRadius,
    double BorderThickness);

/// <summary>
/// Pure projection from a <see cref="SelectSize"/> to its <see cref="SelectMetrics"/> — the native port of the web
/// <c>sizeClasses</c> lookup (<c>Select.tsx</c> L32-37). No WinUI types, so the parity scale is unit-tested without
/// a UI host.
/// </summary>
public static class SelectMetricsTable
{
    /// <summary>The standard density row minimum height resolved for <see cref="SelectSize.Auto"/> (web <c>min-h-d-row</c>).</summary>
    public const double DensityRowMinHeight = 32;

    /// <summary>The parity metrics for <paramref name="size"/> (the web <c>sizeClasses[size]</c> entry).</summary>
    /// <param name="size">The sizing scale.</param>
    public static SelectMetrics For(SelectSize size) => size switch
    {
        // web sm: px-2 py-1.5 text-xs.
        SelectSize.Sm => new SelectMetrics(12, 8, 6, 0, SelectRegistration.CornerRadius, SelectRegistration.BorderThickness),

        // web lg: px-4 py-2.5 text-base.
        SelectSize.Lg => new SelectMetrics(16, 16, 10, 0, SelectRegistration.CornerRadius, SelectRegistration.BorderThickness),

        // web auto: density-aware — the standard density baseline (md spacing + a comfortable touch-row min height).
        SelectSize.Auto => new SelectMetrics(14, 12, 8, DensityRowMinHeight, SelectRegistration.CornerRadius, SelectRegistration.BorderThickness),

        // web md (default): px-3 py-2 text-sm.
        _ => new SelectMetrics(14, 12, 8, 0, SelectRegistration.CornerRadius, SelectRegistration.BorderThickness),
    };
}

/// <summary>
/// A single selectable option — the native analogue of the web <c>SelectOption</c> interface
/// (<c>Select.tsx</c> L6-10): the submitted <see cref="Value"/>, the already-localized display <see cref="Label"/>
/// and the optional non-selectable <see cref="IsDisabled"/> flag. Pure data so the option list is asserted
/// headlessly.
/// </summary>
public sealed record SelectOption
{
    private SelectOption(string value, string label, bool isDisabled)
    {
        Value = value;
        Label = label;
        IsDisabled = isDisabled;
    }

    /// <summary>The value submitted when the option is chosen (web <c>option.value</c>).</summary>
    public string Value { get; }

    /// <summary>The already-localized display text (web <c>option.label</c>).</summary>
    public string Label { get; }

    /// <summary>Whether the option is shown but not selectable (web <c>option.disabled</c>).</summary>
    public bool IsDisabled { get; }

    /// <summary>Build an option.</summary>
    /// <param name="value">The submitted value (web <c>value</c>).</param>
    /// <param name="label">The already-localized display text (web <c>label</c>).</param>
    /// <param name="isDisabled">Whether the option is non-selectable (web <c>disabled</c>).</param>
    public static SelectOption Create(string value, string label, bool isDisabled = false)
    {
        ArgumentNullException.ThrowIfNull(value);
        ArgumentNullException.ThrowIfNull(label);
        return new SelectOption(value, label, isDisabled);
    }
}

/// <summary>
/// The optional field-level help affordance rendered next to the label — the native analogue of the web
/// <c>SelectProps['help']</c> (the <c>&lt;HelpIcon&gt;</c> props, <c>Select.tsx</c> L20 / <c>HelpIcon.tsx</c>
/// L36-54). The body resolves from the <see cref="I18nKey"/> (with <see cref="Content"/> as the fallback) or the
/// plain <see cref="Content"/>; <see cref="For"/> ties the icon to the field for the "Help for {{field}}"
/// accessible name; <see cref="AriaLabel"/> overrides that name entirely; <see cref="Side"/> places the tooltip.
/// Pure data so the help projection stays unit-testable.
/// </summary>
public sealed record SelectHelp
{
    private SelectHelp(string? content, string? i18nKey, string? forId, string? ariaLabel, SelectHelpPlacement side)
    {
        Content = content;
        I18nKey = i18nKey;
        For = forId;
        AriaLabel = ariaLabel;
        Side = side;
    }

    /// <summary>Plain help text, used when no <see cref="I18nKey"/> is supplied (web <c>content</c>).</summary>
    public string? Content { get; }

    /// <summary>i18n key for the help text; takes precedence over <see cref="Content"/> (web <c>i18nKey</c>).</summary>
    public string? I18nKey { get; }

    /// <summary>The field id the icon is tied to (web <c>for</c>); defaults to the select's resolved id.</summary>
    public string? For { get; }

    /// <summary>An explicit accessible-name override for the trigger (web <c>ariaLabel</c>).</summary>
    public string? AriaLabel { get; }

    /// <summary>Where the help tooltip sits relative to the trigger (web <c>side</c>; defaults to <see cref="SelectHelpPlacement.Top"/>).</summary>
    public SelectHelpPlacement Side { get; }

    /// <summary>Build a help affordance from plain text (web <c>content</c> path).</summary>
    /// <param name="content">The help text (web <c>content</c>).</param>
    /// <param name="forId">The field id the icon is tied to (web <c>for</c>); null uses the select's resolved id.</param>
    /// <param name="ariaLabel">Optional accessible-name override (web <c>ariaLabel</c>).</param>
    /// <param name="side">The tooltip placement (web <c>side</c>).</param>
    public static SelectHelp FromText(
        string content,
        string? forId = null,
        string? ariaLabel = null,
        SelectHelpPlacement side = SelectHelpPlacement.Top)
    {
        ArgumentNullException.ThrowIfNull(content);
        return new SelectHelp(content, null, forId, ariaLabel, side);
    }

    /// <summary>Build a help affordance from an i18n key + English fallback (web <c>i18nKey</c> path).</summary>
    /// <param name="i18nKey">The help text i18n key (web <c>i18nKey</c>).</param>
    /// <param name="content">The English fallback when the key is missing (web <c>content</c>).</param>
    /// <param name="forId">The field id the icon is tied to (web <c>for</c>); null uses the select's resolved id.</param>
    /// <param name="ariaLabel">Optional accessible-name override (web <c>ariaLabel</c>).</param>
    /// <param name="side">The tooltip placement (web <c>side</c>).</param>
    public static SelectHelp FromKey(
        string i18nKey,
        string content,
        string? forId = null,
        string? ariaLabel = null,
        SelectHelpPlacement side = SelectHelpPlacement.Top)
    {
        ArgumentException.ThrowIfNullOrEmpty(i18nKey);
        ArgumentNullException.ThrowIfNull(content);
        return new SelectHelp(content, i18nKey, forId, ariaLabel, side);
    }

    /// <summary>Build a help affordance from the raw web prop shape (the <c>&lt;HelpIcon&gt;</c> props).</summary>
    /// <param name="content">The plain help text (web <c>content</c>); used when <paramref name="i18nKey"/> is absent.</param>
    /// <param name="i18nKey">The help text i18n key (web <c>i18nKey</c>); takes precedence over <paramref name="content"/>.</param>
    /// <param name="forId">The field id the icon is tied to (web <c>for</c>).</param>
    /// <param name="ariaLabel">Optional accessible-name override (web <c>ariaLabel</c>).</param>
    /// <param name="side">The tooltip placement (web <c>side</c>).</param>
    public static SelectHelp Create(
        string? content = null,
        string? i18nKey = null,
        string? forId = null,
        string? ariaLabel = null,
        SelectHelpPlacement side = SelectHelpPlacement.Top) =>
        new(content, i18nKey, forId, ariaLabel, side);
}

/// <summary>
/// The immutable render state of the select — the native analogue of the web <c>Select</c> props that drive its
/// appearance (<c>Select.tsx</c> L12-30): the <see cref="Options"/> list (web <c>options</c>), the optional
/// <see cref="Label"/> / <see cref="Help"/> / <see cref="Error"/> / <see cref="Hint"/> / <see cref="Prompt"/>
/// (web same-named props), the <see cref="Size"/> (web <c>size</c>), the <see cref="IsDisabled"/> / <see cref="IsRequired"/>
/// flags (web <c>disabled</c> / <c>required</c>), the controlled <see cref="SelectedValue"/> (web <c>value</c>) and the
/// explicit <see cref="Id"/> (web <c>id</c>). Exposes the web-derived helpers — the resolved field <see cref="SelectId"/>
/// (web L41), the error-over-hint precedence (<see cref="ShowHint"/>, web L81 <c>hint &amp;&amp; !error</c>), the
/// selected-option lookup and the <see cref="WithSelectedValue"/> transition. Pure data — no WinUI types — so every
/// branch is asserted headlessly.
/// </summary>
public sealed record SelectState
{
    /// <summary>The selectable options (web <c>options</c>); defaults to empty (the empty-options state).</summary>
    public IReadOnlyList<SelectOption> Options { get; init; } = Array.Empty<SelectOption>();

    /// <summary>The optional field label, already localized by the caller (web <c>label</c>).</summary>
    public string? Label { get; init; }

    /// <summary>The optional field-level help affordance shown next to the label (web <c>help</c>).</summary>
    public SelectHelp? Help { get; init; }

    /// <summary>The optional validation error message, already localized (web <c>error</c>); takes precedence over the hint.</summary>
    public string? Error { get; init; }

    /// <summary>The optional helper hint, already localized (web <c>hint</c>); hidden while an error is present.</summary>
    public string? Hint { get; init; }

    /// <summary>The optional empty-selection prompt, already localized (web Select.tsx L23).</summary>
    public string? Prompt { get; init; }

    /// <summary>The sizing scale (web <c>size</c>, default <see cref="SelectSize.Md"/>).</summary>
    public SelectSize Size { get; init; } = SelectSize.Md;

    /// <summary>Whether the dropdown is non-interactive and dimmed (web <c>disabled</c>).</summary>
    public bool IsDisabled { get; init; }

    /// <summary>Whether the field is required — renders the label's <c>*</c> marker (web <c>required</c>).</summary>
    public bool IsRequired { get; init; }

    /// <summary>The currently selected value (web controlled <c>value</c>); null shows the empty-selection prompt.</summary>
    public string? SelectedValue { get; init; }

    /// <summary>The explicit field id (web <c>id</c>); null derives the id from the label.</summary>
    public string? Id { get; init; }

    /// <summary>
    /// The resolved field id (web <c>selectId = id || label?.toLowerCase().replace(/\s+/g, '-')</c>, L41): the
    /// explicit <see cref="Id"/>, else the slugified <see cref="Label"/>, else null.
    /// </summary>
    public string? SelectId =>
        !string.IsNullOrEmpty(Id) ? Id
        : !string.IsNullOrEmpty(Label) ? SelectRegistration.Slugify(Label!)
        : null;

    /// <summary>Whether a label is shown (web <c>{label &amp;&amp; ...}</c>, L44).</summary>
    public bool HasLabel => !string.IsNullOrEmpty(Label);

    /// <summary>Whether a validation error is shown (web <c>{error &amp;&amp; ...}</c>, L80).</summary>
    public bool HasError => !string.IsNullOrEmpty(Error);

    /// <summary>Whether the hint is shown — only when there is no error (web <c>{hint &amp;&amp; !error &amp;&amp; ...}</c>, L81).</summary>
    public bool ShowHint => !string.IsNullOrEmpty(Hint) && !HasError;

    /// <summary>Whether the empty-selection prompt is shown (web Select.tsx L73).</summary>
    public bool HasPrompt => !string.IsNullOrEmpty(Prompt);

    /// <summary>Whether any options are present (false is the empty-options state — the dropdown still renders).</summary>
    public bool HasOptions => Options.Count > 0;

    /// <summary>The currently selected option, or null when nothing matches <see cref="SelectedValue"/>.</summary>
    public SelectOption? SelectedOption =>
        SelectedValue is null ? null : Options.FirstOrDefault(o => string.Equals(o.Value, SelectedValue, StringComparison.Ordinal));

    /// <summary>The index of the selected option within <see cref="Options"/>, or -1 when nothing is selected.</summary>
    public int SelectedIndex
    {
        get
        {
            if (SelectedValue is null)
            {
                return -1;
            }

            for (int i = 0; i < Options.Count; i++)
            {
                if (string.Equals(Options[i].Value, SelectedValue, StringComparison.Ordinal))
                {
                    return i;
                }
            }

            return -1;
        }
    }

    /// <summary>
    /// Whether <paramref name="value"/> is a selectable option — present in <see cref="Options"/> and not disabled
    /// (the browser refuses to select a disabled <c>&lt;option&gt;</c>). A null clears the selection (the empty-selection prompt).
    /// </summary>
    /// <param name="value">The candidate value, or null to clear.</param>
    /// <returns><see langword="true"/> when the value can be selected.</returns>
    public bool CanSelect(string? value)
    {
        if (value is null)
        {
            return true;
        }

        return Options.Any(o => string.Equals(o.Value, value, StringComparison.Ordinal) && !o.IsDisabled);
    }

    /// <summary>Return a copy with <paramref name="value"/> selected (no validation — see <see cref="CanSelect"/>).</summary>
    /// <param name="value">The new selected value, or null to clear.</param>
    public SelectState WithSelectedValue(string? value) => this with { SelectedValue = value };
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="SelectState"/> — everything the web component derives
/// before returning JSX (<c>Select.tsx</c> L40-82): the <see cref="LabelText"/> and whether the label row renders
/// (<see cref="HasLabel"/>), the required marker (<see cref="ShowRequiredMarker"/>) and the composed
/// <see cref="AccessibleName"/> Narrator reads (web Label's visible <c>*</c> plus the visually-hidden
/// "&lt;label&gt; required"), the help affordance (<see cref="HelpVisible"/> / <see cref="HelpText"/> /
/// <see cref="HelpAccessibleLabel"/> / <see cref="HelpGlyph"/> / <see cref="HelpPlacement"/>, web <c>&lt;HelpIcon&gt;</c>),
/// the <see cref="Options"/> + <see cref="PromptText"/> + <see cref="SelectedIndex"/>, the validation
/// <see cref="ErrorText"/> (<see cref="HasError"/>) and the <see cref="HintText"/> (<see cref="ShowHint"/>) with the
/// web error-over-hint precedence, the <see cref="DescribedById"/> + <see cref="DescribedText"/> the dropdown points
/// at (web <c>aria-describedby</c>), and the <see cref="Metrics"/>. Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="HasLabel">Whether the label row renders (web <c>{label &amp;&amp; ...}</c>).</param>
/// <param name="LabelText">The label display text (web <c>label</c>).</param>
/// <param name="ShowRequiredMarker">Whether the required <c>*</c> marker renders (web <c>required</c> within the label).</param>
/// <param name="AccessibleName">The dropdown's accessible name (web label content incl. the SR-only "required").</param>
/// <param name="HelpVisible">Whether the help icon renders (web <c>{label &amp;&amp; help}</c> with non-empty text).</param>
/// <param name="HelpText">The resolved help body (web <c>i18nKey ? t(...) : content</c>).</param>
/// <param name="HelpAccessibleLabel">The help trigger's accessible name (web <c>ariaLabel ?? helpFor ?? "More info"</c>).</param>
/// <param name="HelpGlyph">The help trigger glyph (web Lucide <c>HelpCircle</c> stand-in).</param>
/// <param name="HelpGlyphSize">The help trigger glyph font size (web <c>HelpCircle</c> sizing).</param>
/// <param name="HelpPlacement">Where the help tooltip sits (web <c>side</c>).</param>
/// <param name="Options">The selectable options (web <c>options</c>).</param>
/// <param name="HasOptions">Whether any options are present (the empty-options state when false).</param>
/// <param name="HasPrompt">Whether the empty-selection prompt is shown (web Select.tsx L73).</param>
/// <param name="PromptText">The empty-selection prompt text (web Select.tsx L23).</param>
/// <param name="SelectedValue">The selected value (web controlled <c>value</c>); null shows the empty-selection prompt.</param>
/// <param name="SelectedIndex">The selected option index, or -1 when nothing is selected.</param>
/// <param name="HasError">Whether a validation error is shown (web <c>error</c>).</param>
/// <param name="ErrorText">The validation error text (web <c>error</c>).</param>
/// <param name="ShowHint">Whether the hint is shown — only when there is no error (web <c>hint &amp;&amp; !error</c>).</param>
/// <param name="HintText">The helper hint text (web <c>hint</c>).</param>
/// <param name="DescribedById">The id the dropdown's description points at (web <c>aria-describedby</c>); null when none.</param>
/// <param name="DescribedText">The error / hint text Narrator reads as the dropdown's help text.</param>
/// <param name="IsDisabled">Whether the dropdown is non-interactive (web <c>disabled</c>).</param>
/// <param name="Metrics">The parity pixel metrics for the size (web <c>sizeClasses[size]</c>).</param>
/// <param name="SelectId">The resolved field id (web <c>selectId</c>).</param>
public sealed record SelectDisplay(
    bool HasLabel,
    string LabelText,
    bool ShowRequiredMarker,
    string AccessibleName,
    bool HelpVisible,
    string HelpText,
    string HelpAccessibleLabel,
    string HelpGlyph,
    double HelpGlyphSize,
    SelectHelpPlacement HelpPlacement,
    IReadOnlyList<SelectOption> Options,
    bool HasOptions,
    bool HasPrompt,
    string PromptText,
    string? SelectedValue,
    int SelectedIndex,
    bool HasError,
    string ErrorText,
    bool ShowHint,
    string HintText,
    string? DescribedById,
    string DescribedText,
    bool IsDisabled,
    SelectMetrics Metrics,
    string? SelectId);

/// <summary>
/// Pure projection from a <see cref="SelectState"/> to its <see cref="SelectDisplay"/> — the native port of
/// <c>web/src/components/ui/Select.tsx</c> (composing <c>Label.tsx</c> and <c>HelpIcon.tsx</c>). Reproduces the web
/// derivations exactly: the dropdown's accessible name is the label plus the visually-hidden localized "required"
/// (web Label, L52-60); the help icon renders only inside the label row, resolves its body from the i18n key or the
/// plain content (web HelpIcon L65) and renders nothing when that body is empty (web L69), with the accessible name
/// being the explicit aria-label, else the per-field "Help for {{field}}", else the generic "More info" (web
/// L71-75); the hint is shown only when there is no error (web L81); and the dropdown's <c>aria-describedby</c>
/// points at the error id, else the hint id (web L70). No WinUI types — so the projection is unit-tested without a
/// UI host, and the view binds to its result.
/// </summary>
public static class SelectProjection
{
    /// <summary>Project <paramref name="state"/> into a render-ready display, resolving strings through <paramref name="localizer"/>.</summary>
    /// <param name="state">The immutable render state (the web props).</param>
    /// <param name="localizer">The i18n facade (P1/S10) every string resolves through (web <c>useTranslation</c>).</param>
    /// <returns>The render-ready display model.</returns>
    public static SelectDisplay Project(SelectState state, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasLabel = state.HasLabel;
        string label = state.Label ?? string.Empty;
        bool showRequiredMarker = hasLabel && state.IsRequired;

        // web Label (L52-60): the visible `*` is aria-hidden; a VisuallyHidden " required" is appended so the
        // paired control's accessible name reads "<label> required".
        string accessibleName = hasLabel
            ? (state.IsRequired
                ? $"{label} {localizer.GetString(SelectRegistration.RequiredKey, SelectRegistration.RequiredFallback)}"
                : label)
            : string.Empty;

        (bool helpVisible, string helpText, string helpAccessibleLabel) = ProjectHelp(state, localizer);

        bool hasError = state.HasError;
        bool showHint = state.ShowHint;
        string errorText = state.Error ?? string.Empty;
        string hintText = state.Hint ?? string.Empty;

        // web select (L70): aria-describedby = error ? `${id}-error` : hint ? `${id}-hint` : undefined.
        string? selectId = state.SelectId;
        string? describedById =
            selectId is null ? null
            : hasError ? $"{selectId}-error"
            : showHint ? $"{selectId}-hint"
            : null;
        string describedText = hasError ? errorText : showHint ? hintText : string.Empty;

        return new SelectDisplay(
            HasLabel: hasLabel,
            LabelText: label,
            ShowRequiredMarker: showRequiredMarker,
            AccessibleName: accessibleName,
            HelpVisible: helpVisible,
            HelpText: helpText,
            HelpAccessibleLabel: helpAccessibleLabel,
            HelpGlyph: SelectRegistration.HelpGlyph,
            HelpGlyphSize: SelectRegistration.HelpGlyphSize,
            HelpPlacement: state.Help?.Side ?? SelectHelpPlacement.Top,
            Options: state.Options,
            HasOptions: state.HasOptions,
            HasPrompt: state.HasPrompt,
            PromptText: state.Prompt ?? string.Empty,
            SelectedValue: state.SelectedValue,
            SelectedIndex: state.SelectedIndex,
            HasError: hasError,
            ErrorText: errorText,
            ShowHint: showHint,
            HintText: hintText,
            DescribedById: describedById,
            DescribedText: describedText,
            IsDisabled: state.IsDisabled,
            Metrics: SelectMetricsTable.For(state.Size),
            SelectId: selectId);
    }

    // web Select (L53): the HelpIcon is nested inside the label block, so it renders only when both a label and a
    // help prop are present; web HelpIcon (L65-75): resolve the body, render nothing when empty, and compose the
    // per-field / generic accessible name.
    private static (bool Visible, string Text, string AccessibleLabel) ProjectHelp(SelectState state, ILocalizer localizer)
    {
        if (!state.HasLabel || state.Help is not { } help)
        {
            return (false, string.Empty, string.Empty);
        }

        // web HelpIcon L65: i18nKey ? t(i18nKey, { defaultValue: content ?? '' }) : (content ?? '').
        string text = !string.IsNullOrEmpty(help.I18nKey)
            ? localizer.GetString(help.I18nKey!, help.Content ?? string.Empty)
            : (help.Content ?? string.Empty);

        // web HelpIcon L69: render nothing when no help content is supplied.
        if (string.IsNullOrEmpty(text))
        {
            return (false, string.Empty, string.Empty);
        }

        // web HelpIcon L71-75: ariaLabel ?? (forId ? `Help for ${forId}` : 'More info'); forId = help.for ?? selectId.
        string? forId = !string.IsNullOrEmpty(help.For) ? help.For : state.SelectId;
        string accessibleLabel =
            !string.IsNullOrEmpty(help.AriaLabel) ? help.AriaLabel!
            : !string.IsNullOrEmpty(forId)
                ? string.Format(
                    CultureInfo.CurrentCulture,
                    localizer.GetString(SelectRegistration.HelpForKey, SelectRegistration.HelpForFallback),
                    forId)
                : localizer.GetString(SelectRegistration.HelpIconLabelKey, SelectRegistration.HelpIconLabelFallback);

        return (true, text, accessibleLabel);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>Select</c> surface (P1/S11 diagnostics contract). A select's label, options,
/// hint and error can all carry user-facing copy, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never the label, options or selected value.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class SelectDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public SelectDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Select</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SelectRegistration.Slug}");
    }
}
