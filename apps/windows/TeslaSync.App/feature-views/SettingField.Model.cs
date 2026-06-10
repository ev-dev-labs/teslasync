using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The inline help descriptor a <c>SettingField</c> may carry — the native mirror of the web
/// <c>SettingFieldHelp</c> interface (web/src/features/settings/components/SettingField.tsx). It feeds the
/// composed <c>HelpIcon</c>: <see cref="I18nKey"/> (preferred) resolves the help text through the i18n facade
/// with <see cref="Content"/> as the English fallback, and <see cref="For"/> is the field id that surfaces in
/// the affordance's accessible name as "Help for {id}". Pure data — no WinUI types — so the projection that
/// consumes it is unit-tested without a UI host.
/// </summary>
/// <param name="I18nKey">The i18n key for the help text (web <c>help.i18nKey</c>), or null for a one-off.</param>
/// <param name="Content">The English fallback / one-off help text (web <c>help.content</c>), or null.</param>
/// <param name="For">The field id surfaced in the affordance's accessible name (web <c>help.for</c>), or null.</param>
public sealed record SettingFieldHelp(string? I18nKey = null, string? Content = null, string? For = null);

/// <summary>
/// The render-time data model a <c>SettingField</c> view binds to — the native analogue of the web
/// component's props (web/src/features/settings/components/SettingField.tsx). The web source is a pure
/// presentational wrapper: it takes an already-resolved <see cref="Label"/> string and an optional
/// <see cref="Help"/> descriptor and performs no fetching. The field control itself (the web <c>children</c>)
/// is supplied to the view separately, exactly as React passes <c>children</c>. Pure data so the projection is
/// asserted headlessly.
/// </summary>
/// <param name="Label">The already-resolved, localized field label (web <c>label</c>).</param>
/// <param name="Help">The optional inline help descriptor (web <c>help</c>), or null when no help is attached.</param>
public sealed record SettingFieldModel(string Label, SettingFieldHelp? Help = null)
{
    /// <summary>The initial model for a freshly constructed view: an empty label and no help.</summary>
    public static SettingFieldModel Unlabeled { get; } = new(string.Empty);
}

/// <summary>
/// The fully projected, render-ready view of a <c>SettingField</c> input — the native analogue of everything
/// the web component computes before returning JSX (web/src/features/settings/components/SettingField.tsx).
/// Because the web source is pure presentational, there is no fetch lifecycle to reproduce: the generic
/// loading / error / stale / offline states do not exist on this surface (the parent settings page owns the
/// query lifecycle and only mounts a resolved field). The reproduced branches are exactly the conditional
/// renders the web source has: the label is always shown, and the inline help affordance renders only when a
/// help descriptor resolves to non-empty text (the web <c>{help &amp;&amp; &lt;HelpIcon&gt;}</c> gate together
/// with the icon's own <c>if (!text) return null</c>). Holds the natural-cased <see cref="Label"/> (the
/// accessible name), the <see cref="DisplayLabel"/> (the web <c>uppercase</c> visual), whether the help
/// affordance renders (<see cref="HasHelp"/>), the resolved <see cref="HelpText"/> (its tooltip / description),
/// and the <see cref="HelpAccessibleName"/> (the web <c>aria-label</c>). Pure data so every branch is asserted
/// headlessly.
/// </summary>
/// <param name="Label">The field label in its natural casing — the accessible name for the label element.</param>
/// <param name="DisplayLabel">The label upper-cased for display (the web <c>uppercase</c> transform).</param>
/// <param name="HasHelp">Whether the inline help affordance renders (help present and its text non-empty).</param>
/// <param name="HelpText">The resolved help text shown as the affordance's tooltip / description.</param>
/// <param name="HelpAccessibleName">The affordance's accessible name ("Help for {id}" or "More info").</param>
public sealed record SettingFieldDisplay(
    string Label,
    string DisplayLabel,
    bool HasHelp,
    string HelpText,
    string HelpAccessibleName);

/// <summary>
/// Pure projection from a <see cref="SettingFieldModel"/> to its <see cref="SettingFieldDisplay"/> — the native
/// port of web/src/features/settings/components/SettingField.tsx and the help-resolution half of its composed
/// <c>HelpIcon</c> (web/src/components/ui/HelpIcon.tsx). The label is upper-cased for display while its natural
/// casing is preserved for assistive technology; the help text resolves from the i18n key (with the plain
/// content as the English fallback) or from the plain content; the affordance is suppressed when that text is
/// empty (the web <c>if (!text) return null</c>); and the affordance's accessible name reproduces the web
/// <c>aria-label</c> — "Help for {id}" when a field id is supplied, otherwise the shared "More info". No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class SettingFieldProjection
{
    /// <summary>i18n key for the per-field affordance label (the shared <c>a11y.helpFor</c> string).</summary>
    public const string HelpForKey = "a11y.helpFor";

    /// <summary>English fallback for <see cref="HelpForKey"/> ("{0}" is replaced with the field id).</summary>
    public const string HelpForFallback = "Help for {0}";

    /// <summary>i18n key for the generic affordance label (the shared <c>help.tooltip.iconLabel</c> string).</summary>
    public const string IconLabelKey = "help.tooltip.iconLabel";

    /// <summary>English fallback for <see cref="IconLabelKey"/>.</summary>
    public const string IconLabelFallback = "More info";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the help text and accessible name resolve through.</param>
    public static SettingFieldDisplay Project(SettingFieldModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string label = model.Label ?? string.Empty;
        string displayLabel = label.ToUpper(CultureInfo.CurrentCulture);

        string helpText = ResolveHelpText(model.Help, localizer);

        // The web icon renders nothing when its text is empty ("" is falsy); a whitespace-only string is
        // truthy on the web, so length — not whitespace — is the gate here, matching the source exactly.
        bool hasHelp = helpText.Length > 0;

        string helpName = hasHelp ? ResolveHelpName(model.Help, localizer) : string.Empty;

        return new SettingFieldDisplay(label, displayLabel, hasHelp, helpText, helpName);
    }

    private static string ResolveHelpText(SettingFieldHelp? help, ILocalizer localizer)
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

    private static string ResolveHelpName(SettingFieldHelp? help, ILocalizer localizer)
    {
        // web: for ? t('a11y.helpFor', { field: for }) : t('help.tooltip.iconLabel')
        // (SettingField never passes an explicit ariaLabel override.)
        string? forId = help?.For;
        if (!string.IsNullOrEmpty(forId))
        {
            string template = localizer.GetString(HelpForKey, HelpForFallback);
            return string.Format(CultureInfo.CurrentCulture, template, forId);
        }

        return localizer.GetString(IconLabelKey, IconLabelFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SettingField</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the label or help text — so a diagnostics
/// line can never leak a user's settings copy. Thread-safe.
/// </summary>
public sealed class SettingFieldDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public SettingFieldDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SettingField</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SettingFieldRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SettingField</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/settings/components/SettingField.tsx</c>. Holds the diagnostics slug and the Segoe Fluent
/// glyph that stands in for the web Lucide <c>HelpCircle</c> the composed <c>HelpIcon</c> renders. UI-free so the
/// metadata is asserted in tests.
/// </summary>
public static class SettingFieldRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SettingField";

    /// <summary>Segoe Fluent "Help" glyph for the inline help affordance (web <c>HelpCircle</c>).</summary>
    public const string HelpGlyph = "\uE897";
}
