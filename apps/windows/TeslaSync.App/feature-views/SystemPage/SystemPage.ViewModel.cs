using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SystemPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/SystemPage.tsx). The web page renders from navigation/local state
/// only: it owns no query, just a title/subtitle header above two self-contained panels. This holder therefore
/// exposes exactly that — the two localized header strings the manifest requires (<c>system.page.title</c> /
/// <c>system.page.subtitle</c>) — and re-resolves them through the injected <see cref="ILocalizer"/> on
/// <see cref="Refresh"/> (a runtime language change), raising <see cref="PropertyChanged"/> so the view
/// re-renders. The two child panels keep their own loading / empty / error state holders. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SystemPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly SystemPageDiagnostics _diagnostics;

    private string _title;
    private string _subtitle;

    /// <summary>Creates the holder over its localizer and (optional) diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SystemPageViewModel(ILocalizer localizer, SystemPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SystemPageDiagnostics();
        _title = SystemPageRegistration.Title(localizer);
        _subtitle = SystemPageRegistration.Subtitle(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The localized page title (web <c>system.page.title</c>).</summary>
    public string Title
    {
        get => _title;
        private set => Set(ref _title, value);
    }

    /// <summary>The localized page subtitle (web <c>system.page.subtitle</c>).</summary>
    public string Subtitle
    {
        get => _subtitle;
        private set => Set(ref _subtitle, value);
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Re-resolve the localized header copy after a runtime language change (web i18n re-render).</summary>
    public void Refresh()
    {
        Title = SystemPageRegistration.Title(_localizer);
        Subtitle = SystemPageRegistration.Subtitle(_localizer);
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

/// <summary>
/// The default <see cref="IRateLimitStatusSource"/> the <c>SystemPage</c> binds the rate-limit panel to when
/// the shell constructs it without the live data layer (the W7 host-injection precedent shared by ApiLogsPage
/// / FeedbackQueuePage). It yields a single successful-but-empty emission so the panel resolves to its empty
/// state — never an indefinite spinner — until a host wires the repository-backed
/// <see cref="RateLimitStatusSource"/> through the panel's <c>Create</c> factory.
/// </summary>
public sealed class EmptyRateLimitStatusSource : IRateLimitStatusSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyRateLimitStatusSource Instance { get; } = new();

    private EmptyRateLimitStatusSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<RateLimitStatusSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.Yield();
        yield return RepositoryResult<RateLimitStatusSnapshot>.Empty();
    }
}

/// <summary>
/// The default <see cref="IQueueStatusSource"/> the <c>SystemPage</c> binds the worker-queue panel to when the
/// shell constructs it without the live data layer (mirrors <see cref="EmptyRateLimitStatusSource"/>). It
/// yields a single successful-but-empty emission so the panel resolves to its empty state until a host wires
/// the repository-backed <see cref="QueueStatusSource"/> through the panel's <c>Create</c> factory.
/// </summary>
public sealed class EmptyQueueStatusSource : IQueueStatusSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyQueueStatusSource Instance { get; } = new();

    private EmptyQueueStatusSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<QueueStatusSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.Yield();
        yield return RepositoryResult<QueueStatusSnapshot>.Empty();
    }
}
