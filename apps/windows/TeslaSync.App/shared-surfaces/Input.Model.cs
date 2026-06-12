using System.Globalization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.InputSurface;

/// <summary>
/// Canonical metadata for the <c>Input</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/ui/Input.tsx</c>: the stable diagnostics slug. UI-free so the metadata is asserted in
/// headless tests.
/// </summary>
public static class InputRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "Input";
}

/// <summary>
/// The sizing scale a <see cref="InputModel"/> selects — the native analogue of the web
/// <c>InputProps['size']</c> union (<c>'sm' | 'md' | 'lg' | 'auto'</c>, web/src/components/ui/Input.tsx). The
/// fixed scales mirror the web Tailwind size classes; <see cref="Auto"/> follows the user's density preference
/// (the web <c>px-d-pad-x py-d-pad-y text-d-base min-h-d-row</c> density utilities), resolving through the
/// density-aware design tokens at the render boundary with the <see cref="Md"/> metrics as the fallback.
/// </summary>
public enum InputSize
{
    /// <summary>Compact field — web <c>px-2 py-1.5 text-xs</c>.</summary>
    Sm,

    /// <summary>Default field — web <c>px-3 py-2 text-sm</c> (the web back-compat default).</summary>
    Md,

    /// <summary>Roomy field — web <c>px-4 py-2.5 text-base</c>.</summary>
    Lg,

    /// <summary>Density-following field — web <c>px-d-pad-x py-d-pad-y text-d-base min-h-d-row</c>.</summary>
    Auto,
}

/// <summary>
/// The fixed layout metrics for an <see cref="InputSize"/> — the native analogue of the web
/// <c>sizeClasses</c> map (web/src/components/ui/Input.tsx). Holds the field padding, minimum row height and the
/// font-size design-token key (with a pixel fallback) the view applies to the hosted field. Pure data (no WinUI
/// types) so the size → metrics mapping is unit-tested without a UI host; the view resolves
/// <see cref="FontSizeTokenKey"/> through the typography tokens so light / dark / high-contrast and the system
/// font scale all flow from the design system.
/// </summary>
/// <param name="PaddingLeft">Left text padding in DIPs (web <c>px-*</c>).</param>
/// <param name="PaddingTop">Top text padding in DIPs (web <c>py-*</c>).</param>
/// <param name="PaddingRight">Right text padding in DIPs (web <c>px-*</c>).</param>
/// <param name="PaddingBottom">Bottom text padding in DIPs (web <c>py-*</c>).</param>
/// <param name="MinHeight">Minimum field height in DIPs.</param>
/// <param name="FontSizeTokenKey">The typography token key the view resolves for the field font size.</param>
/// <param name="FontSizeFallback">The font size in DIPs used when the token is unavailable (web pixel size).</param>
public sealed record InputMetrics(
    double PaddingLeft,
    double PaddingTop,
    double PaddingRight,
    double PaddingBottom,
    double MinHeight,
    string FontSizeTokenKey,
    double FontSizeFallback)
{
    /// <summary>Reserved left padding when a leading icon is present (web <c>pl-10</c> = 2.5rem).</summary>
    public const double IconReserve = 40;

    /// <summary>Reserved right padding when a trailing suffix is present (web <c>pr-10</c> = 2.5rem).</summary>
    public const double SuffixReserve = 40;

    /// <summary>Leading icon inset from the field's left edge (web <c>left-3</c> = 0.75rem).</summary>
    public const double IconInset = 12;

    /// <summary>Trailing suffix inset from the field's right edge (web <c>right-3</c> = 0.75rem).</summary>
    public const double SuffixInset = 12;

    /// <summary>Resolve the fixed metrics for <paramref name="size"/> (the web <c>sizeClasses[size]</c> lookup).</summary>
    /// <param name="size">The selected sizing scale.</param>
    /// <returns>The padding / min-height / font metrics for the size; <see cref="InputSize.Auto"/> returns the
    /// density fallback (the <see cref="InputSize.Md"/> metrics), which the view overlays with density tokens.</returns>
    public static InputMetrics For(InputSize size) => size switch
    {
        // web `sm`: px-2 py-1.5 text-xs
        InputSize.Sm => new InputMetrics(8, 6, 8, 6, 32, "TsTypeBodySmFontSize", 12),

        // web `lg`: px-4 py-2.5 text-base
        InputSize.Lg => new InputMetrics(16, 10, 16, 10, 48, "TsTypePanelFontSize", 16),

        // web `md` (default) and `auto`'s density fallback: px-3 py-2 text-sm
        _ => new InputMetrics(12, 8, 12, 8, 40, "TsTypeBodyFontSize", 14),
    };
}

/// <summary>
/// The inline help descriptor an <see cref="InputModel"/> may carry — the native mirror of the web
/// <c>HelpIconProps</c> the input composes beside its label (web/src/components/ui/HelpIcon.tsx, used via
/// <c>InputProps.help</c> in web/src/components/ui/Input.tsx). <see cref="I18nKey"/> (preferred) resolves the
/// help text through the i18n facade with <see cref="Content"/> as the English fallback; <see cref="For"/> is
/// the field id surfaced in the affordance's accessible name as "Help for {id}" (defaulting to the input's
/// resolved id, the web <c>for={help.for ?? inputId}</c>); and <see cref="AriaLabel"/> overrides the accessible
/// name entirely (the web <c>ariaLabel</c>). Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="I18nKey">The i18n key for the help text (web <c>i18nKey</c>), or null for a one-off.</param>
/// <param name="Content">The English fallback / one-off help text (web <c>content</c>), or null.</param>
/// <param name="For">The field id surfaced in the accessible name (web <c>for</c>); null defaults to the input id.</param>
/// <param name="AriaLabel">An explicit accessible-name override (web <c>ariaLabel</c>), or null.</param>
public sealed record InputHelp(
    string? I18nKey = null,
    string? Content = null,
    string? For = null,
    string? AriaLabel = null);

/// <summary>
/// The render-time data model an <c>Input</c> surface binds to — the native analogue of the web
/// <c>InputProps</c> (web/src/components/ui/Input.tsx). The web component is purely presentational: its parent
/// owns the value and any data fetching and feeds already-localized strings, so — exactly like React
/// re-rendering the element with resolved props — there is no fetch-driven loading / error / stale / offline
/// branch to reproduce. The branches are the web component's own conditional renders: the optional label (with
/// its required marker and help affordance), the leading icon and trailing suffix (supplied to the view as
/// content), the validation <see cref="Error"/> XOR the helper <see cref="Hint"/> (error takes precedence,
/// hiding the hint), and the size scale.
/// <para>
/// <see cref="Label"/>, <see cref="Hint"/>, <see cref="Error"/> and the help <see cref="InputHelp.Content"/>
/// are caller-supplied, already-localized strings (the web call sites pass <c>t(...)</c> results); the only
/// strings this surface owns are the required marker's accessible word and the help affordance's accessible
/// name, resolved through the i18n facade in <see cref="InputProjection"/>. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host. The leading icon and trailing suffix are arbitrary visuals
/// (the web <c>icon</c> / <c>suffix</c> ReactNodes) supplied to the view directly, exactly as React passes
/// elements, so they live on the view rather than in this data model.
/// </para>
/// </summary>
public sealed record InputModel
{
    /// <summary>Creates a model from the web props.</summary>
    /// <param name="label">The optional field label (web <c>label</c>); blank renders no label row.</param>
    /// <param name="promptText">The empty-field prompt shown when the field is blank; blank treated as absent.</param>
    /// <param name="id">The caller-supplied control id (web <c>id</c>); blank falls back to the label slug.</param>
    /// <param name="hint">Helper text shown when there is no error (web <c>hint</c>); blank treated as absent.</param>
    /// <param name="error">Validation error (web <c>error</c>); when set the hint is hidden; blank treated as absent.</param>
    /// <param name="required">Marks the field required — visual asterisk + accessible word + aria-required (web <c>required</c>).</param>
    /// <param name="disabled">Disables the field (web <c>disabled</c>).</param>
    /// <param name="size">The sizing scale (web <c>size</c>); defaults to <see cref="InputSize.Md"/> like the web.</param>
    /// <param name="help">The optional inline help descriptor (web <c>help</c>), or null.</param>
    public InputModel(
        string? label = null,
        string? promptText = null,
        string? id = null,
        string? hint = null,
        string? error = null,
        bool required = false,
        bool disabled = false,
        InputSize size = InputSize.Md,
        InputHelp? help = null)
    {
        Label = label;
        Id = id;

        // web uses JS truthiness for the prompt/hint/error, so an empty string is falsy and behaves as absent;
        // normalise blank to null to reproduce that precisely. (`id` keeps its empty-string behaviour for the
        // truthy-OR id derivation in the projection, matching the web `id || label?...`.)
        PromptText = string.IsNullOrEmpty(promptText) ? null : promptText;
        Hint = string.IsNullOrEmpty(hint) ? null : hint;
        Error = string.IsNullOrEmpty(error) ? null : error;
        Required = required;
        Disabled = disabled;
        Size = size;
        Help = help;
    }

    /// <summary>The optional field label (web <c>label</c>).</summary>
    public string? Label { get; }

    /// <summary>The empty-field prompt shown when the field is blank; null renders no prompt.</summary>
    // parity:allow PromptText mirrors the web input `placeholder` attribute (the empty-field prompt text).
    public string? PromptText { get; }

    /// <summary>The caller-supplied control id (web <c>id</c>); blank falls back to the label slug.</summary>
    public string? Id { get; }

    /// <summary>The helper text (web <c>hint</c>); null / blank renders no hint (and only when there is no error).</summary>
    public string? Hint { get; }

    /// <summary>The validation error (web <c>error</c>); null / blank renders no error and keeps the hint.</summary>
    public string? Error { get; }

    /// <summary>Whether the field is required (web <c>required</c>).</summary>
    public bool Required { get; }

    /// <summary>Whether the field is disabled (web <c>disabled</c>).</summary>
    public bool Disabled { get; }

    /// <summary>The sizing scale (web <c>size</c>).</summary>
    public InputSize Size { get; }

    /// <summary>The optional inline help descriptor (web <c>help</c>), or null.</summary>
    public InputHelp? Help { get; }

    /// <summary>An empty initial model (no label, prompt, hint or error) — the surface's default render state.</summary>
    public static InputModel Empty { get; } = new();

    /// <summary>True when a label is present (web <c>label</c> truthy → the label row renders).</summary>
    public bool HasLabel => !string.IsNullOrEmpty(Label);

    /// <summary>True when a validation error is present (web <c>error</c> truthy).</summary>
    public bool HasError => !string.IsNullOrEmpty(Error);

    /// <summary>True when helper hint text is present (web <c>hint</c> truthy).</summary>
    public bool HasHint => !string.IsNullOrEmpty(Hint);
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="InputModel"/> — the native analogue of the derived
/// values the web component computes before returning JSX (web/src/components/ui/Input.tsx): the resolved
/// <see cref="InputId"/> (web <c>id || label?.toLowerCase().replace(/\s+/g,'-')</c>), the label row
/// (<see cref="HasLabel"/> + the visible <see cref="Label"/> + the required marker
/// <see cref="ShowRequiredMarker"/> and the <see cref="LabelAccessibleName"/> the web <c>&lt;Label&gt;</c>
/// builds), the help affordance (<see cref="ShowHelp"/> + <see cref="HelpText"/> +
/// <see cref="HelpAccessibleName"/> + <see cref="HelpDescribedById"/>), the input accessibility
/// (<see cref="Required"/> = aria-required, <see cref="Invalid"/> = aria-invalid,
/// <see cref="DescribedById"/> = aria-describedby), and the mutually-exclusive error / hint rows
/// (<see cref="ShowError"/> / <see cref="ShowHint"/> with their text and ids). Pure data so every value is
/// asserted headlessly.
/// </summary>
/// <param name="InputId">The resolved control id (web <c>inputId</c>); null when neither id nor label is supplied.</param>
/// <param name="HasLabel">Whether the label row renders (web <c>label &amp;&amp; ...</c>).</param>
/// <param name="Label">The visible label text (web <c>{label}</c>); empty when no label.</param>
/// <param name="LabelAccessibleName">The label's accessible name including the required word (web <c>&lt;Label&gt;</c>).</param>
/// <param name="ShowRequiredMarker">Whether the visible required asterisk renders (web required <c>*</c>).</param>
/// <param name="RequiredWord">The localized required word (web <c>form.required</c>); null when not required.</param>
/// <param name="ShowHelp">Whether the help affordance renders (web: inside the label block — needs a label, help present, and non-empty text).</param>
/// <param name="HelpText">The resolved help text shown in the affordance's tooltip (web <c>{text}</c>).</param>
/// <param name="HelpAccessibleName">The affordance's accessible name (web <c>aria-label</c>); empty when no help.</param>
/// <param name="HelpDescribedById">The help body id the affordance references (web <c>`${for}-help`</c>); null when none.</param>
/// <param name="Required">Whether the field is required — aria-required (web <c>required</c>).</param>
/// <param name="Disabled">Whether the field is disabled (web <c>disabled</c>).</param>
/// <param name="Invalid">Whether the field is invalid — aria-invalid (web <c>error ? 'true' : undefined</c>).</param>
/// <param name="DescribedById">The id the input's aria-describedby points at (error id XOR hint id), or null.</param>
/// <param name="ShowError">Whether the error row renders (web <c>error</c> truthy).</param>
/// <param name="ErrorText">The error message (web <c>{error}</c>); null when no error.</param>
/// <param name="ErrorId">The error element id (web <c>`${inputId}-error`</c>); null when no error.</param>
/// <param name="ShowHint">Whether the hint row renders (web <c>hint &amp;&amp; !error</c>).</param>
/// <param name="HintText">The hint message (web <c>{hint}</c>); null when the hint is hidden.</param>
/// <param name="HintId">The hint element id (web <c>`${inputId}-hint`</c>); null when the hint is hidden.</param>
/// <param name="Metrics">The size layout metrics (web <c>sizeClasses[size]</c>).</param>
public sealed record InputDisplay(
    string? InputId,
    bool HasLabel,
    string Label,
    string LabelAccessibleName,
    bool ShowRequiredMarker,
    string? RequiredWord,
    bool ShowHelp,
    string HelpText,
    string HelpAccessibleName,
    string? HelpDescribedById,
    bool Required,
    bool Disabled,
    bool Invalid,
    string? DescribedById,
    bool ShowError,
    string? ErrorText,
    string? ErrorId,
    bool ShowHint,
    string? HintText,
    string? HintId,
    InputMetrics Metrics);

/// <summary>
/// Pure projection from an <see cref="InputModel"/> to its <see cref="InputDisplay"/> — the native port of
/// web/src/components/ui/Input.tsx and the label / help-resolution halves of its composed
/// <c>&lt;Label&gt;</c> (web/src/components/ui/Label.tsx) and <c>&lt;HelpIcon&gt;</c>
/// (web/src/components/ui/HelpIcon.tsx). Reproduces the web derivations exactly:
/// <list type="bullet">
///   <item><description><c>inputId = id || label?.toLowerCase().replace(/\s+/g,'-')</c> — a truthy <c>id</c>
///   wins, otherwise a non-null label is slugged, otherwise the id is absent.</description></item>
///   <item><description>the required marker shows the visible <c>*</c> while the label's accessible name gains
///   the localized <c>form.required</c> word (the web visually-hidden "required").</description></item>
///   <item><description>the help affordance's <c>for</c> defaults to the input id (web
///   <c>for={help.for ?? inputId}</c>); its accessible name is the explicit override, else
///   <c>a11y.helpFor</c> with the field id, else <c>help.tooltip.iconLabel</c>; and it renders only inside the
///   label block (web <c>{label &amp;&amp; ...{help &amp;&amp; &lt;HelpIcon&gt;}}</c>) and when its text
///   resolves non-empty (the web <c>if (!text) return null</c>).</description></item>
///   <item><description><c>aria-invalid = error ? 'true' : undefined</c>; <c>aria-required</c> mirrors
///   <c>required</c>; and <c>aria-describedby = error ? `${inputId}-error` : hint ? `${inputId}-hint` :
///   undefined</c>.</description></item>
///   <item><description>the error row and the hint row are mutually exclusive — an error hides the hint.</description></item>
/// </list>
/// No WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public static partial class InputProjection
{
    /// <summary>i18n key for the required marker's accessible word (the composed <c>&lt;Label&gt;</c> uses <c>form.required</c>).</summary>
    public const string RequiredWordKey = "form.required";

    /// <summary>English fallback for <see cref="RequiredWordKey"/> — the web literal <c>t('form.required', 'required')</c>.</summary>
    public const string RequiredWordFallback = "required";

    /// <summary>i18n key for the per-field help affordance label (the composed <c>&lt;HelpIcon&gt;</c> uses <c>a11y.helpFor</c>).</summary>
    public const string HelpForKey = "a11y.helpFor";

    /// <summary>English fallback for <see cref="HelpForKey"/> ("{0}" is replaced with the field id).</summary>
    public const string HelpForFallback = "Help for {0}";

    /// <summary>i18n key for the generic help affordance label (the composed <c>&lt;HelpIcon&gt;</c> uses <c>help.tooltip.iconLabel</c>).</summary>
    public const string IconLabelKey = "help.tooltip.iconLabel";

    /// <summary>English fallback for <see cref="IconLabelKey"/>.</summary>
    public const string IconLabelFallback = "More info";

    /// <summary>Suffix appended to the input id for the error element id (web <c>-error</c>).</summary>
    public const string ErrorIdSuffix = "-error";

    /// <summary>Suffix appended to the input id for the hint element id (web <c>-hint</c>).</summary>
    public const string HintIdSuffix = "-hint";

    /// <summary>Suffix appended to the help <c>for</c> for the help body id (web <c>-help</c>).</summary>
    public const string HelpIdSuffix = "-help";

    /// <summary>
    /// The value a missing id interpolates to inside the web template literals
    /// (<c>`${inputId}-error`</c>); JavaScript renders <c>undefined</c> as the string "undefined". Reproduced
    /// verbatim so the error / hint element ids and the input's <c>aria-describedby</c> stay byte-identical to
    /// the web runtime (and keep matching each other) in the degenerate no-id, no-label case. In practice every
    /// call site supplies an id or a label, so this token never surfaces.
    /// </summary>
    public const string MissingIdToken = "undefined";

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex WhitespaceRun();

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the required word and help accessible name resolve through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static InputDisplay Project(InputModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // web: const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
        // truthy-OR: a non-empty id wins; otherwise a non-null label is slugged; otherwise undefined.
        string? inputId =
            !string.IsNullOrEmpty(model.Id) ? model.Id
            : model.Label is null ? null
            : Slugify(model.Label);

        // The web template literals interpolate inputId directly; a missing id becomes "undefined".
        string anchor = inputId ?? MissingIdToken;

        string label = model.Label ?? string.Empty;
        bool hasLabel = model.HasLabel;

        string? requiredWord = model.Required
            ? localizer.GetString(RequiredWordKey, RequiredWordFallback)
            : null;

        // web <Label>: children, then (when required) a hidden "required" word appended to the accessible name.
        string labelAccessibleName = hasLabel && model.Required
            ? string.Create(CultureInfo.CurrentCulture, $"{label} {requiredWord}")
            : label;

        // web HelpIcon `for`: help.for ?? inputId (nullish).
        string? helpFor = model.Help?.For ?? inputId;
        string helpText = ResolveHelpText(model.Help, localizer);

        // web renders the HelpIcon INSIDE the `{label && (...)}` block, so the help affordance only appears
        // when there is a label (in addition to help being present and its resolved text non-empty — the web
        // `if (!text) return null` inside HelpIcon).
        bool showHelp = hasLabel && model.Help is not null && helpText.Length > 0;
        string helpName = showHelp ? ResolveHelpName(model.Help!, helpFor, localizer) : string.Empty;
        string? helpDescribedById = showHelp && !string.IsNullOrEmpty(helpFor) ? helpFor + HelpIdSuffix : null;

        bool hasError = model.HasError;
        bool showHint = model.HasHint && !hasError;

        // web: errorId = `${inputId}-error` (rendered only when the error row shows); hintId = `${inputId}-hint`.
        string? errorId = hasError ? anchor + ErrorIdSuffix : null;
        string? hintId = showHint ? anchor + HintIdSuffix : null;

        // web: aria-describedby = error ? errorId : hint ? hintId : undefined.
        string? describedById = hasError ? errorId : showHint ? hintId : null;

        return new InputDisplay(
            InputId: inputId,
            HasLabel: hasLabel,
            Label: label,
            LabelAccessibleName: labelAccessibleName,
            ShowRequiredMarker: hasLabel && model.Required,
            RequiredWord: requiredWord,
            ShowHelp: showHelp,
            HelpText: helpText,
            HelpAccessibleName: helpName,
            HelpDescribedById: helpDescribedById,
            Required: model.Required,
            Disabled: model.Disabled,
            Invalid: hasError,
            DescribedById: describedById,
            ShowError: hasError,
            ErrorText: hasError ? model.Error : null,
            ErrorId: errorId,
            ShowHint: showHint,
            HintText: showHint ? model.Hint : null,
            HintId: hintId,
            Metrics: InputMetrics.For(model.Size));
    }

    /// <summary>Slugs a label the web way — <c>label.toLowerCase().replace(/\s+/g, '-')</c>.</summary>
    /// <param name="label">The label to slug (already known non-null by the caller).</param>
    /// <returns>The lower-cased label with every whitespace run collapsed to a single hyphen.</returns>
    public static string Slugify(string label)
    {
        ArgumentNullException.ThrowIfNull(label);
        return WhitespaceRun().Replace(label.ToLowerInvariant(), "-");
    }

    private static string ResolveHelpText(InputHelp? help, ILocalizer localizer)
    {
        if (help is null)
        {
            return string.Empty;
        }

        // web: i18nKey ? t(i18nKey, { defaultValue: content ?? '' }) : (content ?? '')
        if (!string.IsNullOrEmpty(help.I18nKey))
        {
            return localizer.GetString(help.I18nKey, help.Content ?? string.Empty);
        }

        return help.Content ?? string.Empty;
    }

    private static string ResolveHelpName(InputHelp help, string? helpFor, ILocalizer localizer)
    {
        // web: ariaLabel ?? (for ? t('a11y.helpFor', { field: for }) : t('help.tooltip.iconLabel'))
        if (!string.IsNullOrEmpty(help.AriaLabel))
        {
            return help.AriaLabel;
        }

        if (!string.IsNullOrEmpty(helpFor))
        {
            string template = localizer.GetString(HelpForKey, HelpForFallback);
            return string.Format(CultureInfo.CurrentCulture, template, helpFor);
        }

        return localizer.GetString(IconLabelKey, IconLabelFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>Input</c> surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never the label, prompt, hint, error or help text (which
/// can carry user-facing content) — so a diagnostics line can never leak form content. Thread-safe.
/// </summary>
public sealed class InputDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public InputDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Input</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InputRegistration.Slug}");
    }
}
