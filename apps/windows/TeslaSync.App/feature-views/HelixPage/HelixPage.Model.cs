using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// Static registration facts for the native <c>HelixPage</c> — the parity port of the web page
/// web/src/features/settings/pages/HelixPage.tsx (route <c>/integrations/helix</c>, nav name <c>Helix</c>). The web
/// page is a thin <c>PageContainer</c> wrapper (title + subtitle + per-route breadcrumb label overrides, with the
/// page-level loading spinner driven by <c>useSettings().isLoading</c>) around the already-ported
/// <see cref="AISettings"/> surface, so this type owns only the page-tier strings (the three i18n keys the parity
/// manifest requires), the route / slug constants and the breadcrumb-override map the container publishes on mount.
/// The shell page factory binds the surface under <see cref="RouteName"/>.
/// </summary>
public static class HelixPageRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> <c>Page("Helix", …)</c>).</summary>
    public const string RouteName = "Helix";

    /// <summary>The web route path the page mirrors (no leading slash).</summary>
    public const string Route = "integrations/helix";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "HelixPage";

    /// <summary>The i18n key for the page title (web <c>helix.page.title</c>).</summary>
    public const string TitleKey = "helix.page.title";

    /// <summary>The English default for <see cref="TitleKey"/> (web fallback, verbatim).</summary>
    public const string TitleFallback = "Helix";

    /// <summary>The i18n key for the page subtitle (web <c>helix.page.subtitle</c>).</summary>
    public const string SubtitleKey = "helix.page.subtitle";

    /// <summary>The English default for <see cref="SubtitleKey"/> (web fallback, verbatim).</summary>
    public const string SubtitleFallback =
        "Optional AI integration. Off by default — nothing runs until you opt in here.";

    /// <summary>The i18n key for the "Integrations" breadcrumb label (web <c>helix.breadcrumb.integrations</c>).</summary>
    public const string IntegrationsBreadcrumbKey = "helix.breadcrumb.integrations";

    /// <summary>The English default for <see cref="IntegrationsBreadcrumbKey"/> (web fallback, verbatim).</summary>
    public const string IntegrationsBreadcrumbFallback = "Integrations";

    /// <summary>The breadcrumb-override segment key for the <c>integrations</c> path part (web <c>breadcrumbLabels.integrations</c>).</summary>
    public const string IntegrationsSegment = "integrations";

    /// <summary>The breadcrumb-override segment key for the <c>helix</c> path part (web <c>breadcrumbLabels.helix</c>).</summary>
    public const string HelixSegment = "helix";

    /// <summary>Resolve the localized page title (web <c>t('helix.page.title', 'Helix')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Resolve the localized page subtitle (web <c>t('helix.page.subtitle', …)</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized subtitle.</returns>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, SubtitleFallback);
    }

    /// <summary>Resolve the localized "Integrations" breadcrumb label (web <c>t('helix.breadcrumb.integrations', …)</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized breadcrumb label.</returns>
    public static string IntegrationsBreadcrumb(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(IntegrationsBreadcrumbKey, IntegrationsBreadcrumbFallback);
    }

    /// <summary>
    /// The per-route breadcrumb label overrides the page publishes on mount (the native parity of the web page's
    /// <c>breadcrumbLabels={{ integrations, helix }}</c>): the <c>integrations</c> segment resolves through
    /// <see cref="IntegrationsBreadcrumbKey"/> and the <c>helix</c> segment reuses the page title key.
    /// </summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>An ordinal-keyed map of route-segment to localized label.</returns>
    public static IReadOnlyDictionary<string, string> BreadcrumbOverrides(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [IntegrationsSegment] = IntegrationsBreadcrumb(localizer),
            [HelixSegment] = Title(localizer),
        };
    }
}

/// <summary>
/// The default <see cref="IAiSettingsSource"/> for the shell-hosted <c>HelixPage</c> — resolves both the settings
/// read (web <c>useSettings</c> → <c>GET /settings</c>) and the Helix-spend read (web <c>useAiUsageToday</c>) to the
/// empty data state, so the embedded <see cref="AISettings"/> surface renders with the web off-by-default opt-in form
/// and the page's <see cref="HelixPageViewModel"/> resolves out of its loading state. A save is accepted as a no-op
/// that echoes the empty snapshot. The shell uses this until a host wires the generated-client-backed
/// <see cref="AiSettingsSource"/>; it mirrors the <c>EmptyXSource</c> convention the sibling pages use for their
/// default ports.
/// </summary>
public sealed class EmptyAiSettingsSource : IAiSettingsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAiSettingsSource Instance { get; } = new();

    private EmptyAiSettingsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AiSettingsSnapshot>> StreamSettingsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<AiSettingsSnapshot>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AiUsageTodaySnapshot>> StreamUsageTodayAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<AiUsageTodaySnapshot>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task<AiSettingsSaveOutcome> SaveAsync(JsonObject document, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        return Task.FromResult(AiSettingsSaveOutcome.Ok(AiSettingsSnapshot.Empty));
    }
}
