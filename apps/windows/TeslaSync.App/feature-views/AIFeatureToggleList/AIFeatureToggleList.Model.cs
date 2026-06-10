using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// Canonical metadata + i18n keys for the <see cref="AIFeatureToggleList"/> feature surface — the native
/// mirror of the web component at <c>web/src/features/settings/components/AIFeatureToggleList.tsx</c>. The web
/// component composes its copy from three i18n keys: the section legend
/// (<c>ai.settings.feature.legend</c>, used as both the heading and the section's aria-label) and, per
/// feature, a label (<c>ai.settings.feature.&lt;id&gt;.label</c>, falling back to the registry
/// <c>meta.name</c>) and a description (<c>ai.settings.feature.&lt;id&gt;.description</c>, falling back to the
/// registry <c>meta.description</c>). The native keys carry the <c>translation.</c> catalog prefix the WinUI
/// resource bridge expects (the same convention the shipped AlertCard surface uses) so they resolve against
/// <c>Strings/{lang}/Resources.resw</c> in the app and against the English fallback headlessly. UI-free so it
/// is asserted in tests without a XAML host.
/// </summary>
public static class AIFeatureToggleListRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIFeatureToggleList";

    /// <summary>The section legend i18n key (web <c>ai.settings.feature.legend</c>).</summary>
    public const string LegendKey = "translation.ai.settings.feature.legend";

    /// <summary>The English fallback for the legend (web <c>t(..., 'Per-feature opt-in (all default off)')</c>).</summary>
    public const string LegendFallback = "Per-feature opt-in (all default off)";

    /// <summary>The empty-state i18n key — a native defensive branch (the web list has no empty surface).</summary>
    public const string EmptyKey = "translation.ai.settings.feature.empty";

    /// <summary>The English fallback for the empty state (never a blank box).</summary>
    public const string EmptyFallback = "No AI features are available.";

    /// <summary>Segoe Fluent Icons "Settings" glyph for the empty surface.</summary>
    public const string EmptyGlyph = "\uE713";

    /// <summary>The per-feature label i18n key (web <c>ai.settings.feature.&lt;id&gt;.label</c>).</summary>
    public static string LabelKey(string id) => $"translation.ai.settings.feature.{id}.label";

    /// <summary>The per-feature description i18n key (web <c>ai.settings.feature.&lt;id&gt;.description</c>).</summary>
    public static string DescriptionKey(string id) => $"translation.ai.settings.feature.{id}.description";

    /// <summary>Resolve the localized section legend (heading + aria-label).</summary>
    public static string Legend(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LegendKey, LegendFallback);
    }

    /// <summary>Resolve the localized empty-state message.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, EmptyFallback);
    }
}

/// <summary>
/// One render-ready feature row — the native analogue of a single <c>AI_FEATURE_IDS.map(...)</c> iteration in
/// the web component. Carries the resolved <see cref="Label"/> and <see cref="Description"/> (i18n key with the
/// registry fallback), the controlled <see cref="IsOn"/> state (web <c>Boolean(values[id])</c>) and the
/// <see cref="AutomationName"/> the toggle exposes to Narrator (web <c>aria-label={label}</c>). Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The stable feature id (web <c>AiFeatureId</c>); the row + toggle automation-id segment.</param>
/// <param name="Label">The resolved label (i18n key → registry name fallback).</param>
/// <param name="Description">The resolved description (i18n key → registry description fallback).</param>
/// <param name="IsOn">The controlled toggle state (web <c>Boolean(values[id])</c>).</param>
/// <param name="AutomationName">The toggle's Narrator name (web toggle <c>aria-label</c>).</param>
public sealed record AiFeatureToggleRow(
    string Id,
    string Label,
    string Description,
    bool IsOn,
    string AutomationName)
{
    /// <summary>True when a non-empty description should be shown beneath the label.</summary>
    public bool HasDescription => Description.Length > 0;
}

/// <summary>
/// The fully projected, render-ready view of the toggle list — the native analogue of what the web
/// <c>AIFeatureToggleList</c> renders: the section <see cref="Legend"/> and the ordered <see cref="Rows"/>.
/// <see cref="HasRows"/> selects the populated-vs-empty branch the view renders (the web list is always
/// populated from the non-empty registry; the empty branch is the native "never a blank box" defense).
/// </summary>
/// <param name="Legend">The localized section legend (heading + aria-label).</param>
/// <param name="Rows">The ordered feature rows (web <c>AI_FEATURE_IDS</c> order).</param>
public sealed record AIFeatureTogglePanelDisplay(
    string Legend,
    IReadOnlyList<AiFeatureToggleRow> Rows)
{
    /// <summary>True when at least one feature row should render (web list is always populated).</summary>
    public bool HasRows => Rows.Count > 0;
}

/// <summary>
/// Projects the AI feature registry + the controlled values + the i18n facade into a render-ready
/// <see cref="AIFeatureTogglePanelDisplay"/> — the UI-thread-free core of the <see cref="AIFeatureToggleList"/>
/// surface (the native analogue of the web component's <c>AI_FEATURE_IDS.map(...)</c> body). The view binds to
/// this; it never resolves strings or reads the registry itself, so every branch is unit-tested headlessly.
/// </summary>
public static class AIFeatureToggleListProjection
{
    /// <summary>Project the canonical registry (the production path) for the given values.</summary>
    public static AIFeatureTogglePanelDisplay Project(
        ILocalizer localizer,
        IReadOnlyDictionary<string, bool>? values) =>
        Project(AiFeatureRegistry.Features, localizer, values);

    /// <summary>
    /// Project an explicit feature set (the production path passes <see cref="AiFeatureRegistry.Features"/>;
    /// tests pass a narrowed or empty set to exercise the per-row and empty branches).
    /// </summary>
    public static AIFeatureTogglePanelDisplay Project(
        IReadOnlyList<AiFeatureMeta> features,
        ILocalizer localizer,
        IReadOnlyDictionary<string, bool>? values)
    {
        ArgumentNullException.ThrowIfNull(features);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<AiFeatureToggleRow>(features.Count);
        foreach (var meta in features)
        {
            // Fallback to the registry name/description keeps each row self-describing even when a
            // translation has not landed yet — exactly the web `t(key, meta.name|meta.description)` contract.
            var label = localizer.GetString(AIFeatureToggleListRegistration.LabelKey(meta.Id), meta.Name);
            var description = localizer.GetString(
                AIFeatureToggleListRegistration.DescriptionKey(meta.Id),
                meta.Description);
            var isOn = values is not null && values.TryGetValue(meta.Id, out var on) && on;

            rows.Add(new AiFeatureToggleRow(meta.Id, label, description, isOn, label));
        }

        return new AIFeatureTogglePanelDisplay(AIFeatureToggleListRegistration.Legend(localizer), rows);
    }
}

/// <summary>
/// PII-safe diagnostics for the <see cref="AIFeatureToggleList"/> surface (P1/S11 diagnostics contract).
/// Records only the operational <c>view.opened</c> event with the surface slug — never a feature id, label or
/// the user's opt-in choices — so a diagnostics line can never leak which AI features a user has enabled.
/// Thread-safe.
/// </summary>
public sealed class AIFeatureToggleListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AIFeatureToggleListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIFeatureToggleList</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AIFeatureToggleListRegistration.Slug}");
    }
}
