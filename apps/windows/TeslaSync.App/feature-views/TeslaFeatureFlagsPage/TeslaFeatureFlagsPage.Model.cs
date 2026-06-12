using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Canonical metadata for the <c>TeslaFeatureFlagsPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/TeslaFeatureFlagsPage.tsx</c> (route <c>/tesla-features</c>, nav name
/// <c>TeslaFeatureFlags</c>). The web page is a thin <c>PageContainer</c> wrapper around the shared
/// <c>FeatureToggles</c> surface, so the page reuses the very same two i18n keys the component already owns
/// (<c>featureConfig.title</c> / <c>featureConfig.subtitle</c>) — referenced through
/// <see cref="FeatureTogglesRegistration"/> so the page header and the hosted panel can never drift apart.
/// </summary>
public static class TeslaFeatureFlagsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TeslaFeatureFlagsPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>TeslaFeatureFlags</c>).</summary>
    public const string RouteName = "TeslaFeatureFlags";

    /// <summary>The web route this page deep-links from (<c>/tesla-features</c>).</summary>
    public const string RoutePath = "tesla-features";

    /// <summary>i18n key for the page title (web <c>featureConfig.title</c>).</summary>
    public const string TitleKey = FeatureTogglesRegistration.TitleKey;

    /// <summary>i18n key for the page subtitle (web <c>featureConfig.subtitle</c>).</summary>
    public const string SubtitleKey = FeatureTogglesRegistration.SubtitleKey;

    /// <summary>Localized page title (web <c>featureConfig.title</c>).</summary>
    public static string Title(ILocalizer localizer) => FeatureTogglesRegistration.Title(localizer);

    /// <summary>Localized page subtitle (web <c>featureConfig.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) => FeatureTogglesRegistration.Subtitle(localizer);
}

/// <summary>
/// PII-safe diagnostics for the <c>TeslaFeatureFlagsPage</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a feature key, value or detail — so a
/// diagnostics line can never leak which Tesla feature flags an operator inspected. Thread-safe.
/// </summary>
public sealed class TeslaFeatureFlagsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TeslaFeatureFlagsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TeslaFeatureFlagsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TeslaFeatureFlagsRegistration.Slug}");
    }
}

/// <summary>
/// The page's default <see cref="IFeatureTogglesSource"/> when the W4 shell factory constructs the page without
/// the P2-core data dependencies wired (the same host-injection precedent the sibling W7 <c>ApiLogsPage</c> /
/// <c>FeedbackQueuePage</c> follow via their <c>Empty*Feed</c> defaults). It resolves a single loaded snapshot
/// with no entries, so the hosted <c>FeatureToggles</c> panel lands on its friendly empty state rather than a
/// perpetual spinner; the refresh mutation is a no-op success. A host that owns the repository simply passes the
/// repository-backed <see cref="FeatureTogglesSource"/> instead — no view change required.
/// </summary>
public sealed class EmptyFeatureTogglesSource : IFeatureTogglesSource
{
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the source over an optional injectable clock (deterministic in tests).</summary>
    public EmptyFeatureTogglesSource(Func<DateTimeOffset>? clock = null) =>
        _clock = clock ?? (() => DateTimeOffset.Now);

    /// <summary>The shared singleton instance (system clock).</summary>
    public static EmptyFeatureTogglesSource Instance { get; } = new();

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<FeatureConfigSnapshot>> StreamConfigAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.Yield();
        yield return RepositoryResult<FeatureConfigSnapshot>.Loaded(FeatureConfigSnapshot.Empty, _clock());
    }

    /// <inheritdoc />
    public Task<FeatureConfigRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FeatureConfigRefreshOutcome.Success());
    }
}
