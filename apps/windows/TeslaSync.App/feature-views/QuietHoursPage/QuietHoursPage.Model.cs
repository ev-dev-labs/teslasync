using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// Canonical metadata for the <c>QuietHoursPage</c> surface — the native anchor for the web page at
/// web/src/features/notifications/pages/QuietHoursPage.tsx (route <c>/notifications/quiet-hours</c>, nav name
/// <c>NotificationsQuietHours</c>). Centralises the shell route name, the web route path, the diagnostics
/// <see cref="Slug"/> and the two page-tier i18n keys (web <c>notifications.quietHours.title</c> /
/// <c>notifications.quietHours.subtitle</c>) so the view-model, the view and the tests resolve one source of truth.
/// </summary>
public static class QuietHoursPageRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> Page("NotificationsQuietHours", …)).</summary>
    public const string RouteName = "NotificationsQuietHours";

    /// <summary>The web route path the page mirrors.</summary>
    public const string Route = "notifications/quiet-hours";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "QuietHoursPage";

    /// <summary>The localized page title (web <c>notifications.quietHours.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("notifications.quietHours.title", "Quiet hours");
    }

    /// <summary>The localized page subtitle (web <c>notifications.quietHours.subtitle</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized subtitle.</returns>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "notifications.quietHours.subtitle",
            "Suppress non-critical notifications during a configurable window.");
    }
}

/// <summary>
/// PII-safe diagnostics for the Quiet Hours page surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a window schedule, severity or user id —
/// so a diagnostics line can never leak notification data. Thread-safe.
/// </summary>
public sealed class QuietHoursPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public QuietHoursPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QuietHoursPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QuietHoursPageRegistration.Slug}");
    }
}

/// <summary>
/// The inert <see cref="IQuietHoursSource"/> the page mounts the hosted <see cref="QuietHoursPanel"/> over when no
/// host has wired the generated-client-backed <see cref="QuietHoursSource"/> — it resolves the read to an empty
/// window list (the panel's empty data state) and treats create / update / delete as no-ops. The shell uses this
/// until the composition root injects the repository-backed source; tests inject their own fake.
/// </summary>
public sealed class EmptyQuietHoursSource : IQuietHoursSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyQuietHoursSource Instance { get; } = new();

    private EmptyQuietHoursSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<QuietHoursWindow>>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task SaveAsync(QuietHoursDraft draft, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
