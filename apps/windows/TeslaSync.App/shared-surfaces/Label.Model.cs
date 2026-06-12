// Per-surface sub-namespace (the VisuallyHidden surface's isolation pattern): this surface ships a public
// type literally named Label (the WinUI view), which would otherwise collide in the flat
// TeslaSync.App.SharedSurfaces namespace with the span-based typography Label atom
// (TeslaSync.App.Components.UI.Label) the web source explicitly calls out as a distinct component. Keeping the
// form-label surface in its own namespace resolves that without renaming the parity-named type.
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.LabelSurface;

/// <summary>
/// Canonical metadata for the <c>Label</c> shared surface — the native mirror of the web form-label primitive
/// at <c>web/src/components/ui/Label.tsx</c>: the stable diagnostics slug. UI-free so the metadata is asserted
/// in headless tests.
/// </summary>
public static class LabelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "Label";
}

/// <summary>
/// The render-time data model the <c>Label</c> surface binds to — the native analogue of the web
/// <c>LabelProps</c> (web/src/components/ui/Label.tsx, <c>extends LabelHTMLAttributes&lt;HTMLLabelElement&gt;</c>).
/// The web component is a purely presentational form <c>&lt;label&gt;</c>: its parent owns any data and feeds an
/// already-localized child label string, so — exactly like React re-rendering the element with resolved props —
/// there is no fetch-driven loading / error / stale / offline branch to reproduce here. The only conditional
/// branch is the web component's own: the optional <see cref="Required"/> marker (the visible aria-hidden
/// <c>*</c> plus the visually-hidden "required" accessible text).
/// <para>
/// <see cref="Text"/> is the caller-supplied, already-localized label text (the web <c>children</c>; web call
/// sites pass <c>t(...)</c> results); the only string this surface owns is the required marker's accessible word
/// (web <c>t('form.required', 'required')</c>), resolved through the i18n facade in <see cref="LabelProjection"/>.
/// <see cref="HtmlFor"/> mirrors the web <c>htmlFor</c> attribute — the id of the control this label names — and
/// is carried through for the view's control association. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </para>
/// </summary>
public sealed record LabelModel
{
    /// <summary>Creates a model from the web props.</summary>
    /// <param name="text">The visible label text (web <c>children</c>); already localized by the caller. Empty is allowed.</param>
    /// <param name="required">Marks the field required — visible asterisk + visually-hidden accessible word (web <c>required</c>).</param>
    /// <param name="htmlFor">Optional id of the control this label names (web <c>htmlFor</c>); used by the view to wire the association.</param>
    public LabelModel(string text, bool required = false, string? htmlFor = null)
    {
        ArgumentNullException.ThrowIfNull(text);

        Text = text;
        Required = required;
        HtmlFor = htmlFor;
    }

    /// <summary>The visible label text (web <c>children</c>).</summary>
    public string Text { get; }

    /// <summary>Whether the field is required (web <c>required</c>).</summary>
    public bool Required { get; }

    /// <summary>The optional id of the control this label names (web <c>htmlFor</c>); null when unassociated.</summary>
    public string? HtmlFor { get; }

    /// <summary>An empty initial model (blank text, not required) — the surface's default render state.</summary>
    public static LabelModel Empty { get; } = new(string.Empty);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="LabelModel"/> — the native analogue of the JSX the web
/// component returns (web/src/components/ui/Label.tsx). It carries the always-present <see cref="Text"/>, the
/// required marker (<see cref="ShowRequired"/> with its decorative <see cref="RequiredGlyph"/> and its
/// screen-reader-only <see cref="RequiredText"/>), the composed <see cref="AccessibleName"/> the label exposes
/// (and a paired control inherits through the association), and the pass-through <see cref="HtmlFor"/>. Pure data
/// so every value is asserted headlessly.
/// </summary>
/// <param name="Text">The visible label text (web <c>children</c>); always rendered.</param>
/// <param name="ShowRequired">Whether the required marker renders (web <c>required ? ... : null</c>).</param>
/// <param name="RequiredGlyph">The visible, decorative required glyph (web aria-hidden <c>*</c>); meaningful only when <see cref="ShowRequired"/>.</param>
/// <param name="RequiredText">The visually-hidden required word voiced by the screen reader (web <c>VisuallyHidden</c> content); null when not required.</param>
/// <param name="AccessibleName">The composed accessible name — "<c>{Text} {required}</c>" when required, else <see cref="Text"/> (web label accessible-name computation: the aria-hidden glyph excluded, the visually-hidden word included).</param>
/// <param name="HtmlFor">The id of the control this label names (web <c>htmlFor</c>); null when unassociated.</param>
public sealed record LabelDisplay(
    string Text,
    bool ShowRequired,
    string RequiredGlyph,
    string? RequiredText,
    string AccessibleName,
    string? HtmlFor);

/// <summary>
/// Pure projection from a <see cref="LabelModel"/> to its <see cref="LabelDisplay"/> — the native port of
/// web/src/components/ui/Label.tsx. Reproduces the web render exactly:
/// <list type="bullet">
///   <item><description>the visible label text is rendered verbatim (web <c>{children}</c>).</description></item>
///   <item><description>when <c>required</c>, a visible <c>*</c> is shown (web aria-hidden span, so it is
///   excluded from the accessible name and never voiced as "asterisk") together with a visually-hidden
///   "required" word (web <c>VisuallyHidden</c>, so it IS voiced) — satisfying WCAG 3.3.2.</description></item>
///   <item><description>the composed accessible name is "<c>{text} {required}</c>" (web label accessible-name:
///   the {' '} separator + the visually-hidden word, the aria-hidden glyph omitted), collapsing to just the
///   required word when the label text is empty and to just the text when not required.</description></item>
///   <item><description>the required word resolves through the i18n facade with the web literal
///   (<c>t('form.required', 'required')</c>) as the key and English fallback.</description></item>
/// </list>
/// The caller-supplied <see cref="LabelModel.Text"/> is already localized, so only the required word is keyed
/// here. No WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public static class LabelProjection
{
    /// <summary>i18n key for the required word (web <c>t('form.required', 'required')</c>).</summary>
    public const string RequiredKey = "form.required";

    /// <summary>English fallback for <see cref="RequiredKey"/> — the web literal <c>'required'</c>.</summary>
    public const string RequiredFallback = "required";

    /// <summary>The visible, decorative required glyph (web aria-hidden <c>*</c>).</summary>
    public const string RequiredGlyph = "*";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the required word resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static LabelDisplay Project(LabelModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // web: required ? <VisuallyHidden>{` ${t('form.required', 'required')}`}</VisuallyHidden> : null.
        string? requiredText = model.Required
            ? localizer.GetString(RequiredKey, RequiredFallback)
            : null;

        return new LabelDisplay(
            Text: model.Text,
            ShowRequired: model.Required,
            RequiredGlyph: RequiredGlyph,
            RequiredText: requiredText,
            AccessibleName: ComposeAccessibleName(model.Text, requiredText),
            HtmlFor: model.HtmlFor);
    }

    // web label accessible name: "{children} {required}" with the aria-hidden "*" excluded. The leading-space
    // template literal in the web VisuallyHidden is a join artifact the browser collapses, so the canonical
    // composition uses a single separating space and drops it entirely when either side is absent.
    private static string ComposeAccessibleName(string text, string? requiredText)
    {
        if (string.IsNullOrEmpty(requiredText))
        {
            return text;
        }

        return string.IsNullOrEmpty(text) ? requiredText : $"{text} {requiredText}";
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>Label</c> surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never the label text (which can carry user-facing content) —
/// so a diagnostics line can never leak form content. Thread-safe.
/// </summary>
public sealed class LabelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public LabelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Label</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LabelRegistration.Slug}");
    }
}
