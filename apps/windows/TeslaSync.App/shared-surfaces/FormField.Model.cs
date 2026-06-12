using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.FormFieldSurface;

/// <summary>
/// Canonical metadata for the <c>FormField</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/forms/FormField.tsx</c>: the stable diagnostics slug. UI-free so the metadata is
/// asserted in headless tests.
/// </summary>
public static class FormFieldRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "FormField";
}

/// <summary>
/// The render-time data model the <c>FormField</c> surface binds to — the native analogue of the web
/// <c>FormFieldProps</c> (web/src/components/forms/FormField.tsx). The web component is a purely
/// presentational label + control + hint/error wrapper: its parent owns the control and any data fetching
/// and feeds already-localized strings, so — exactly like React re-rendering the element with resolved
/// props — there is no fetch-driven loading / error / stale / offline branch to reproduce here. The only
/// branches are the web component's own conditional renders: the optional required marker, and the
/// validation <see cref="Error"/> XOR the <see cref="Hint"/> (error takes precedence, hiding the hint).
/// <para>
/// <see cref="Label"/>, <see cref="Hint"/> and <see cref="Error"/> are caller-supplied, already-localized
/// strings (the web call sites pass <c>t(...)</c> results, e.g. <c>t('alerts.signal', 'Signal')</c>); the
/// only string this surface owns is the required marker's accessible name (web
/// <c>aria-label="required"</c>), resolved through the i18n facade in <see cref="FormFieldProjection"/>.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </para>
/// </summary>
public sealed record FormFieldModel
{
    /// <summary>Creates a model from the web props.</summary>
    /// <param name="label">The required visible label (web <c>label</c>); already localized by the caller.</param>
    /// <param name="htmlFor">
    /// Optional caller-supplied control id (web <c>htmlFor</c>). When null the surface uses the generated
    /// <c>useId</c> value; mirroring the web <c>htmlFor ?? autoId</c> (nullish) coalescing, only a null value
    /// falls back — an explicit empty string is preserved.
    /// </param>
    /// <param name="hint">Helper / hint text shown when there is no error (web <c>hint</c>); blank is treated as absent.</param>
    /// <param name="error">Validation error (web <c>error</c>); when set the hint is hidden; blank is treated as absent.</param>
    /// <param name="required">Marks the field required — visual asterisk + accessible label (web <c>required</c>).</param>
    public FormFieldModel(string label, string? htmlFor = null, string? hint = null, string? error = null, bool required = false)
    {
        ArgumentNullException.ThrowIfNull(label);

        Label = label;
        HtmlFor = htmlFor;

        // web uses JS truthiness for hint/error (`error ? ... : hint ? ...`), so an empty string is falsy and
        // behaves as absent; normalise blank to null to reproduce that precisely.
        Hint = string.IsNullOrEmpty(hint) ? null : hint;
        Error = string.IsNullOrEmpty(error) ? null : error;
        Required = required;
    }

    /// <summary>The required visible label (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>The optional caller-supplied control id (web <c>htmlFor</c>); null uses the generated id.</summary>
    public string? HtmlFor { get; }

    /// <summary>The helper / hint text (web <c>hint</c>); null / blank renders no hint.</summary>
    public string? Hint { get; }

    /// <summary>The validation error (web <c>error</c>); null / blank renders no error and keeps the hint.</summary>
    public string? Error { get; }

    /// <summary>Whether the field is required (web <c>required</c>).</summary>
    public bool Required { get; }

    /// <summary>An empty initial model (blank label, no hint / error) — the surface's default render state.</summary>
    public static FormFieldModel Empty { get; } = new(string.Empty);

    /// <summary>True when a validation error is present (web <c>error</c> truthy).</summary>
    public bool HasError => Error is not null;

    /// <summary>True when hint text is present (web <c>hint</c> truthy).</summary>
    public bool HasHint => Hint is not null;
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="FormFieldModel"/> — the native analogue of the
/// derived values the web component computes before returning JSX (web/src/components/forms/FormField.tsx):
/// the resolved <see cref="FieldId"/> (web <c>htmlFor ?? useId()</c>), the conditional <see cref="ErrorId"/>
/// (web <c>error ? `${fieldId}-error` : undefined</c>) and <see cref="HintId"/> (web
/// <c>hint &amp;&amp; !error ? `${fieldId}-hint` : undefined</c>), the always-present <see cref="Label"/>,
/// the required marker (<see cref="ShowRequired"/> + its accessible <see cref="RequiredAutomationName"/>),
/// and the mutually-exclusive error / hint rows (<see cref="ShowError"/> / <see cref="ShowHint"/> with their
/// text). Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="FieldId">The resolved control id (web <c>fieldId = htmlFor ?? autoId</c>).</param>
/// <param name="ErrorId">The error element id (web <c>`${fieldId}-error`</c>); null when no error shows.</param>
/// <param name="HintId">The hint element id (web <c>`${fieldId}-hint`</c>); null when no hint shows.</param>
/// <param name="Label">The visible label text (web <c>label</c>); always rendered.</param>
/// <param name="ShowRequired">Whether the required asterisk renders (web <c>required &amp;&amp; ...</c>).</param>
/// <param name="RequiredAutomationName">The asterisk's accessible name (web <c>aria-label="required"</c>); null when not required.</param>
/// <param name="ShowError">Whether the error row renders (web <c>error ? ... </c>).</param>
/// <param name="ErrorText">The error message shown in the alert row (web <c>{error}</c>); null when no error.</param>
/// <param name="ShowHint">Whether the hint row renders (web <c>hint &amp;&amp; !error</c>).</param>
/// <param name="HintText">The hint message (web <c>{hint}</c>); null when the hint is hidden.</param>
public sealed record FormFieldDisplay(
    string FieldId,
    string? ErrorId,
    string? HintId,
    string Label,
    bool ShowRequired,
    string? RequiredAutomationName,
    bool ShowError,
    string? ErrorText,
    bool ShowHint,
    string? HintText);

/// <summary>
/// Pure projection from a <see cref="FormFieldModel"/> (plus the generated <c>useId</c> value) to its
/// <see cref="FormFieldDisplay"/> — the native port of web/src/components/forms/FormField.tsx. Reproduces the
/// web derivations exactly:
/// <list type="bullet">
///   <item><description><c>fieldId = htmlFor ?? autoId</c> (only a null <c>htmlFor</c> falls back to the
///   generated id, matching the web nullish coalesce).</description></item>
///   <item><description><c>errorId = error ? `${fieldId}-error` : undefined</c>.</description></item>
///   <item><description><c>hintId = hint &amp;&amp; !error ? `${fieldId}-hint` : undefined</c>.</description></item>
///   <item><description>the error row and the hint row are mutually exclusive — an error hides the hint
///   (the always-rendered branches; the surface never collapses to nothing when both are absent, it simply
///   shows the label + control).</description></item>
///   <item><description>the required marker's accessible name resolves through the i18n facade with the
///   web literal (<c>aria-label="required"</c>) as the key's English fallback.</description></item>
/// </list>
/// The caller-supplied <see cref="FormFieldModel.Label"/> / <see cref="FormFieldModel.Hint"/> /
/// <see cref="FormFieldModel.Error"/> are already localized, so only the required marker is keyed here. No
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public static class FormFieldProjection
{
    /// <summary>i18n key for the required marker's accessible name.</summary>
    public const string RequiredAriaKey = "formField.required";

    /// <summary>English fallback for <see cref="RequiredAriaKey"/> — the web literal <c>aria-label="required"</c>.</summary>
    public const string RequiredAriaFallback = "required";

    /// <summary>Suffix appended to the field id for the error element id (web <c>-error</c>).</summary>
    public const string ErrorIdSuffix = "-error";

    /// <summary>Suffix appended to the field id for the hint element id (web <c>-hint</c>).</summary>
    public const string HintIdSuffix = "-hint";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the required marker's accessible name resolves through (P1/S10).</param>
    /// <param name="autoId">The generated <c>useId</c> value supplied by the <see cref="IFieldIdProvider"/> seam (P1/S8).</param>
    /// <returns>The render-ready display model.</returns>
    public static FormFieldDisplay Project(FormFieldModel model, ILocalizer localizer, string autoId)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(autoId);

        // web: const fieldId = htmlFor ?? autoId  (nullish — an explicit "" is kept).
        string fieldId = model.HtmlFor ?? autoId;

        bool hasError = model.HasError;
        bool showHint = model.HasHint && !hasError;

        // web: const errorId = error ? `${fieldId}-error` : undefined.
        string? errorId = hasError ? fieldId + ErrorIdSuffix : null;

        // web: const hintId = hint && !error ? `${fieldId}-hint` : undefined.
        string? hintId = showHint ? fieldId + HintIdSuffix : null;

        string? requiredName = model.Required
            ? localizer.GetString(RequiredAriaKey, RequiredAriaFallback)
            : null;

        return new FormFieldDisplay(
            FieldId: fieldId,
            ErrorId: errorId,
            HintId: hintId,
            Label: model.Label,
            ShowRequired: model.Required,
            RequiredAutomationName: requiredName,
            ShowError: hasError,
            ErrorText: hasError ? model.Error : null,
            ShowHint: showHint,
            HintText: showHint ? model.Hint : null);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FormField</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the label, hint or error text (which
/// can carry user-facing content) — so a diagnostics line can never leak form content. Thread-safe.
/// </summary>
public sealed class FormFieldDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public FormFieldDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FormField</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FormFieldRegistration.Slug}");
    }
}
