using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PageContainer"/> view — the native port of the web
/// component body (web/src/components/layout/PageContainer.tsx L73-127). It binds the i18n facade (P1/S10) and the
/// breadcrumb-override seam (P1/S8), holds the page chrome (title / subtitle / actions-present / copy-link /
/// freshness-present) and the body gates (loading / error / empty + the empty-message override), recomputes the
/// pure <see cref="PageContainerProjection"/> whenever any input moves and raises <see cref="PropertyChanged"/> so
/// the view re-renders. On construction it pushes the caller's breadcrumb label overrides up to the navigation
/// chrome via the seam (the web <c>useSetBreadcrumbOverrides</c> mount effect) and <see cref="Dispose"/> withdraws
/// them (the effect cleanup); <see cref="SetBreadcrumbOverrides"/> re-registers when the labels change. The holder
/// performs no I/O and reads no query itself.
/// </summary>
public sealed class PageContainerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IBreadcrumbOverrideSink _breadcrumbSink;
    private string _title;
    private string? _subtitle;
    private bool _loading;
    private string? _errorMessage;
    private bool _empty;
    private string? _emptyMessage;
    private bool _hasActions;
    private bool _copyLink;
    private IDisposable? _breadcrumbRegistration;
    private PageContainerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, breadcrumb seam and the initial page chrome / body gates.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="title">The page title (web <c>title</c>).</param>
    /// <param name="breadcrumbSink">The breadcrumb-override seam (P1/S8); null uses the inert <see cref="NullBreadcrumbOverrideSink"/>.</param>
    /// <param name="subtitle">The optional sub-heading (web <c>subtitle</c>).</param>
    /// <param name="loading">Whether the loading spinner replaces the body (web <c>loading</c>).</param>
    /// <param name="errorMessage">The user-facing error message (web <c>error.message</c>); null means no error.</param>
    /// <param name="empty">Whether the empty state replaces the body (web <c>empty</c>).</param>
    /// <param name="emptyMessage">The caller's empty-state override (web <c>emptyMessage</c>).</param>
    /// <param name="hasActions">Whether a caller actions node is present (web <c>actions</c>).</param>
    /// <param name="copyLink">Whether the copy-link affordance is shown (web <c>copyLink</c>).</param>
    /// <param name="hasFreshness">Whether the data-freshness chip is shown (web <c>resolvedQuery != null</c>).</param>
    /// <param name="breadcrumbOverrides">The per-route label overrides to publish on construction (web <c>breadcrumbLabels</c>).</param>
    public PageContainerViewModel(
        ILocalizer localizer,
        string title,
        IBreadcrumbOverrideSink? breadcrumbSink = null,
        string? subtitle = null,
        bool loading = false,
        string? errorMessage = null,
        bool empty = false,
        string? emptyMessage = null,
        bool hasActions = false,
        bool copyLink = false,
        bool hasFreshness = false,
        IReadOnlyDictionary<string, string>? breadcrumbOverrides = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(title);

        _localizer = localizer;
        _breadcrumbSink = breadcrumbSink ?? NullBreadcrumbOverrideSink.Instance;
        _title = title;
        _subtitle = subtitle;
        _loading = loading;
        _errorMessage = errorMessage;
        _empty = empty;
        _emptyMessage = emptyMessage;
        _hasActions = hasActions;
        _copyLink = copyLink;
        HasFreshness = hasFreshness;

        _projection = Compute();
        RegisterBreadcrumbs(breadcrumbOverrides);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>PageContainer</c>).</summary>
    public static string Slug => PageContainerRegistration.Slug;

    /// <summary>The current render projection (header, body state, copy + accessibility contract).</summary>
    public PageContainerProjection Projection => _projection;

    /// <summary>Whether the data-freshness chip is shown (web <c>resolvedQuery != null</c>); fixed at construction.</summary>
    public bool HasFreshness { get; }

    /// <summary>Set the page title (web <c>title</c>); also re-derives the empty-state default sentence.</summary>
    /// <param name="title">The new title.</param>
    public void SetTitle(string title)
    {
        ArgumentNullException.ThrowIfNull(title);
        _title = title;
        Reproject();
    }

    /// <summary>Set the optional sub-heading (web <c>subtitle</c>); null/blank hides it.</summary>
    /// <param name="subtitle">The new subtitle, or null/blank for none.</param>
    public void SetSubtitle(string? subtitle)
    {
        _subtitle = subtitle;
        Reproject();
    }

    /// <summary>Set whether the loading spinner replaces the body (web <c>loading</c>).</summary>
    /// <param name="loading">The new loading gate.</param>
    public void SetLoading(bool loading)
    {
        _loading = loading;
        Reproject();
    }

    /// <summary>
    /// Set the user-facing error message (web <c>error.message</c>); null clears the error and restores the normal
    /// body precedence. A non-null value (including empty) switches to the error card.
    /// </summary>
    /// <param name="errorMessage">The new error message, or null for no error.</param>
    public void SetError(string? errorMessage)
    {
        _errorMessage = errorMessage;
        Reproject();
    }

    /// <summary>Set whether the empty state replaces the body (web <c>empty</c>).</summary>
    /// <param name="empty">The new empty gate.</param>
    public void SetEmpty(bool empty)
    {
        _empty = empty;
        Reproject();
    }

    /// <summary>Set the empty-state message override (web <c>emptyMessage</c>); null falls back to the default sentence.</summary>
    /// <param name="emptyMessage">The new override, or null for the default.</param>
    public void SetEmptyMessage(string? emptyMessage)
    {
        _emptyMessage = emptyMessage;
        Reproject();
    }

    /// <summary>Set whether a caller actions node is present (web <c>actions</c>).</summary>
    /// <param name="hasActions">Whether the actions node is present.</param>
    public void SetHasActions(bool hasActions)
    {
        _hasActions = hasActions;
        Reproject();
    }

    /// <summary>Set whether the copy-link affordance is shown (web <c>copyLink</c>).</summary>
    /// <param name="copyLink">Whether the copy-link affordance is shown.</param>
    public void SetCopyLink(bool copyLink)
    {
        _copyLink = copyLink;
        Reproject();
    }

    /// <summary>
    /// Replace the published breadcrumb label overrides — the web <c>useSetBreadcrumbOverrides</c> re-registering
    /// when its serialised map changes. Withdraws the previous registration and, when the new map is non-empty,
    /// publishes it; an empty/null map withdraws without re-publishing.
    /// </summary>
    /// <param name="overrides">The new per-route label overrides, or null/empty to withdraw.</param>
    public void SetBreadcrumbOverrides(IReadOnlyDictionary<string, string>? overrides)
    {
        if (_disposed)
        {
            return;
        }

        _breadcrumbRegistration?.Dispose();
        _breadcrumbRegistration = null;
        RegisterBreadcrumbs(overrides);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _breadcrumbRegistration?.Dispose();
        _breadcrumbRegistration = null;
        GC.SuppressFinalize(this);
    }

    private void RegisterBreadcrumbs(IReadOnlyDictionary<string, string>? overrides)
    {
        // web: only register when the map has content (`if (!serialised) { unregister…; return; }`).
        if (overrides is null || overrides.Count == 0)
        {
            return;
        }

        _breadcrumbRegistration = _breadcrumbSink.Register(overrides);
    }

    private PageContainerProjection Compute() =>
        PageContainerProjection.Project(
            new PageContainerRequest(
                _title,
                _subtitle,
                _loading,
                _errorMessage,
                _empty,
                _emptyMessage,
                _hasActions,
                _copyLink,
                HasFreshness),
            _localizer);

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
