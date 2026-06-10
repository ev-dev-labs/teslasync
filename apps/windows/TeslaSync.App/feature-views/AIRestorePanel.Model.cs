using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The mutually-exclusive render branch of the <c>AIRestorePanel</c> surface — the native union of the content
/// states the web component renders
/// (web/src/features/settings/components/AIRestorePanel.tsx). The web component is a pure, controlled
/// presentational child: it takes an already-resolved <c>archived</c> prop plus <c>onConfirm</c> /
/// <c>onDecline</c> callbacks and performs no fetching, so the parent AI-settings page owns the data lifecycle
/// and decides whether to mount this surface at all. There is therefore no fetch-driven loading / error / stale
/// / offline branch to reproduce; the only conditional in the source is the archived-feature preview list, whose
/// presence selects between the two states below. Both keep the prompt fully rendered (title, description and the
/// two affordances) — neither is ever a blank box.
/// </summary>
public enum AIRestorePanelState
{
    /// <summary>At least one archived feature resolved — the prompt plus the bulleted preview list.</summary>
    Populated,

    /// <summary>
    /// No archived feature resolved (an empty / all-false snapshot) — the prompt still renders its title,
    /// description and affordances, just without the preview list (the web <c>labels.length &gt; 0</c> guard).
    /// </summary>
    Empty,
}

/// <summary>
/// The render-time data model the <c>AIRestorePanel</c> view binds to — the native analogue of the web
/// component's single <c>archived: Record&lt;string, boolean&gt;</c> prop
/// (web/src/features/settings/components/AIRestorePanel.tsx). It carries the archived AI-feature opt-in snapshot
/// the server returned from a prior mode→off transition; the host AI-settings page (the native P1/S8 seam) fills
/// it in and owns persistence. The view never performs HTTP. Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="Archived">
/// The archived opt-in snapshot keyed by feature id (web <c>archived</c>); entries whose value is
/// <see langword="false"/> are skipped, mirroring the web <c>if (!value) continue</c>. Enumeration order is
/// preserved into the preview list, mirroring the web <c>Object.entries(archived)</c> order.
/// </param>
public sealed record AIRestorePanelModel(IReadOnlyDictionary<string, bool> Archived)
{
    private static readonly IReadOnlyDictionary<string, bool> EmptyArchive =
        new Dictionary<string, bool>(StringComparer.Ordinal);

    /// <summary>The empty model: no archived snapshot (the preview list collapses, the prompt still renders).</summary>
    public static AIRestorePanelModel Empty { get; } = new(EmptyArchive);

    /// <summary>
    /// Builds a model for an optional archived snapshot, collapsing a <see langword="null"/> or empty map to
    /// <see cref="Empty"/> so callers never have to null-guard.
    /// </summary>
    /// <param name="archived">The archived opt-in snapshot, or null.</param>
    /// <returns>A model wrapping <paramref name="archived"/>, or <see cref="Empty"/> when it is null / empty.</returns>
    public static AIRestorePanelModel For(IReadOnlyDictionary<string, bool>? archived) =>
        archived is null || archived.Count == 0 ? Empty : new AIRestorePanelModel(archived);
}

/// <summary>
/// The fully projected, render-ready view of one <c>AIRestorePanel</c> input — the native analogue of everything
/// the web component computes before returning JSX (web/src/features/settings/components/AIRestorePanel.tsx).
/// Holds the active <see cref="State"/>, the localized <see cref="Title"/> / <see cref="Description"/>, the
/// archived-feature preview <see cref="Labels"/>, the two affordance labels, and the composed
/// <see cref="AutomationName"/> the alert region exposes to Narrator. Pure data so every branch is asserted
/// headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Title">The localized prompt title (web <c>ai.settings.archive.title</c>).</param>
/// <param name="Description">The localized prompt description (web <c>ai.settings.archive.description</c>).</param>
/// <param name="Labels">The archived-feature preview labels (web <c>previewLabels(archived)</c>).</param>
/// <param name="DeclineLabel">The localized decline affordance (web <c>ai.settings.archive.decline</c>).</param>
/// <param name="RestoreLabel">The localized restore affordance (web <c>ai.settings.archive.restore</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the alert region.</param>
public sealed record AIRestorePanelDisplay(
    AIRestorePanelState State,
    string Title,
    string Description,
    IReadOnlyList<string> Labels,
    string DeclineLabel,
    string RestoreLabel,
    string AutomationName)
{
    /// <summary>True when at least one archived-feature preview label should render (web <c>labels.length &gt; 0</c>).</summary>
    public bool HasLabels => Labels.Count > 0;
}

/// <summary>
/// Pure projection from an <see cref="AIRestorePanelModel"/> to its <see cref="AIRestorePanelDisplay"/> — the
/// native port of web/src/features/settings/components/AIRestorePanel.tsx. The preview-label adapter reproduces
/// the web <c>previewLabels</c> helper verbatim: it iterates the archived snapshot in order, skips disabled
/// entries, resolves a known feature's label through the i18n facade (falling back to the canonical
/// <see cref="AiFeatureRegistry"/> name — the web <c>t(key, AI_FEATURES[id].name)</c> contract) and renders an
/// unknown id raw so the listing is never blank. The presence of any label selects the
/// <see cref="AIRestorePanelState.Populated"/> vs <see cref="AIRestorePanelState.Empty"/> branch. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class AIRestorePanelProjection
{
    /// <summary>
    /// Reproduce the web <c>previewLabels(archived, translate)</c> helper: project the archived snapshot into the
    /// ordered list of enabled-feature display labels. A known feature resolves to its localized label (registry
    /// name fallback); an unknown id renders raw so the listing is never blank.
    /// </summary>
    /// <param name="archived">The archived opt-in snapshot keyed by feature id.</param>
    /// <param name="localizer">The i18n facade each known-feature label resolves through.</param>
    /// <returns>The ordered preview labels for every enabled entry.</returns>
    public static IReadOnlyList<string> PreviewLabels(
        IReadOnlyDictionary<string, bool> archived,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(archived);
        ArgumentNullException.ThrowIfNull(localizer);

        var labels = new List<string>(archived.Count);
        foreach (var entry in archived)
        {
            // web: for (const [id, value] of Object.entries(archived)) { if (!value) continue; ... }
            if (!entry.Value)
            {
                continue;
            }

            var meta = AiFeatureRegistry.Find(entry.Key);
            labels.Add(meta is not null
                ? localizer.GetString(AIRestorePanelRegistration.LabelKey(entry.Key), meta.Name)
                : entry.Key);
        }

        return labels;
    }

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>archived</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static AIRestorePanelDisplay Project(AIRestorePanelModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<string> labels = PreviewLabels(model.Archived, localizer);
        AIRestorePanelState state = labels.Count > 0 ? AIRestorePanelState.Populated : AIRestorePanelState.Empty;

        string title = AIRestorePanelRegistration.Title(localizer);
        string description = AIRestorePanelRegistration.Description(localizer);
        string declineLabel = AIRestorePanelRegistration.DeclineLabel(localizer);
        string restoreLabel = AIRestorePanelRegistration.RestoreLabel(localizer);
        string automationName = BuildAutomationName(title, description, labels);

        return new AIRestorePanelDisplay(
            State: state,
            Title: title,
            Description: description,
            Labels: labels,
            DeclineLabel: declineLabel,
            RestoreLabel: restoreLabel,
            AutomationName: automationName);
    }

    // The web section is role="alert" aria-live="polite": when it appears Narrator reads the whole prompt. The
    // reading order matches the layout — title, description, then the comma-joined preview list when present.
    private static string BuildAutomationName(string title, string description, IReadOnlyList<string> labels)
    {
        var parts = new List<string>(3) { title, description };
        if (labels.Count > 0)
        {
            parts.Add(string.Join(", ", labels));
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// Canonical metadata + i18n keys for the <c>AIRestorePanel</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/settings/components/AIRestorePanel.tsx</c>. The web component composes its
/// copy from the <c>ai.settings.archive.*</c> keys (title / description / restore / decline) plus, per archived
/// feature, the shared <c>ai.settings.feature.&lt;id&gt;.label</c> key (the same key the sibling
/// <see cref="AIFeatureToggleList"/> surface uses, falling back to the registry <c>meta.name</c>). The native
/// keys carry the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the convention the
/// shipped AI-settings surfaces use) so they resolve against <c>Strings/{lang}/Resources.resw</c> in the app and
/// against the English fallback headlessly. UI-free so it is asserted in tests without a XAML host.
/// </summary>
public static class AIRestorePanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIRestorePanel";

    /// <summary>The prompt title i18n key (web <c>ai.settings.archive.title</c>).</summary>
    public const string TitleKey = "translation.ai.settings.archive.title";

    /// <summary>The English fallback for the title (the web default literal).</summary>
    public const string TitleFallback = "Restore previous Helix selection?";

    /// <summary>The prompt description i18n key (web <c>ai.settings.archive.description</c>).</summary>
    public const string DescriptionKey = "translation.ai.settings.archive.description";

    /// <summary>The English fallback for the description (the web default literal).</summary>
    public const string DescriptionFallback = "You previously had these features enabled. Re-enable them now?";

    /// <summary>The restore affordance i18n key (web <c>ai.settings.archive.restore</c>).</summary>
    public const string RestoreKey = "translation.ai.settings.archive.restore";

    /// <summary>The English fallback for the restore affordance (the web default literal).</summary>
    public const string RestoreFallback = "Restore selection";

    /// <summary>The decline affordance i18n key (web <c>ai.settings.archive.decline</c>).</summary>
    public const string DeclineKey = "translation.ai.settings.archive.decline";

    /// <summary>The English fallback for the decline affordance (the web default literal).</summary>
    public const string DeclineFallback = "No thanks";

    /// <summary>Segoe Fluent "Sparkle" glyph — the native stand-in for the web Lucide <c>Sparkles</c> mark.</summary>
    public const string SparkleGlyph = "\uE734";

    /// <summary>
    /// The per-feature label i18n key (web <c>ai.settings.feature.&lt;id&gt;.label</c>) — identical to the key the
    /// sibling <see cref="AIFeatureToggleList"/> surface feeds, so a single catalog entry serves both.
    /// </summary>
    /// <param name="id">The archived feature id.</param>
    /// <returns>The catalog key for the feature's label.</returns>
    public static string LabelKey(string id) => $"translation.ai.settings.feature.{id}.label";

    /// <summary>Resolve the localized prompt title.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title, or the English fallback.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Resolve the localized prompt description.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized description, or the English fallback.</returns>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DescriptionKey, DescriptionFallback);
    }

    /// <summary>Resolve the localized restore affordance label.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized restore label, or the English fallback.</returns>
    public static string RestoreLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(RestoreKey, RestoreFallback);
    }

    /// <summary>Resolve the localized decline affordance label.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized decline label, or the English fallback.</returns>
    public static string DeclineLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DeclineKey, DeclineFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AIRestorePanel</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a feature id, label or the user's archived
/// opt-in choices — so a diagnostics line can never leak which AI features a user previously enabled. Thread-safe.
/// </summary>
public sealed class AIRestorePanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AIRestorePanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIRestorePanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AIRestorePanelRegistration.Slug}");
    }
}
