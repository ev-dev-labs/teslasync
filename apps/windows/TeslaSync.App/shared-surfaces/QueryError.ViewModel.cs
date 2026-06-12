using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="QueryError"/> view — the native port of the web
/// <c>QueryError</c> body (web/src/components/feedback/QueryError.tsx L47-199). It binds the i18n facade (P1/S10),
/// the <see cref="IQueryErrorConnectivitySource"/> (the P1/S8 connectivity seam, the web <c>useOnlineStatus()</c>
/// hook) and the <see cref="IQueryErrorNavigator"/> (the P1/S8 navigation seam, the web <c>useNavigate()</c> hook
/// + login redirect). The host describes the current error with <see cref="SetError"/> (the web <c>error</c> /
/// <c>onRetry</c> / <c>resourceName</c> / <c>listHref</c> props, plus the <c>isTransientWaiting</c> verdict) or
/// hides the surface with <see cref="Clear"/> (the web <c>if (!error) return null</c> gate); the holder recomputes
/// the pure <see cref="QueryErrorProjection"/> whenever the error or the connectivity moves and raises
/// <see cref="PropertyChanged"/> so the view re-renders. When the connection returns while the offline reconnect
/// auto-retry is armed (<see cref="QueryErrorProjection.AutoRetryEligible"/>), it invokes the retry once — the web
/// reconnect effect (L53-66). <see cref="InvokeAction"/> dispatches the resolved CTA to the retry callback or the
/// navigator (the web button <c>onClick</c> handlers). <see cref="Dispose"/> unsubscribes from the connectivity
/// seam (the web effect cleanup). The view performs no I/O, reads no connectivity and navigates nothing itself.
/// </summary>
public sealed class QueryErrorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IQueryErrorConnectivitySource _connectivity;
    private readonly IQueryErrorNavigator _navigator;
    private QueryErrorRequest _request = QueryErrorRequest.None;
    private Action? _onRetry;
    private QueryErrorProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, connectivity seam and navigation seam (P1/S8 / P1/S10).</summary>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="connectivity">The connectivity state-holder seam (web <c>useOnlineStatus()</c>).</param>
    /// <param name="navigator">The navigation seam the CTAs invoke (web <c>useNavigate()</c> + login redirect).</param>
    public QueryErrorViewModel(
        ILocalizer localizer,
        IQueryErrorConnectivitySource connectivity,
        IQueryErrorNavigator navigator)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(connectivity);
        ArgumentNullException.ThrowIfNull(navigator);

        _localizer = localizer;
        _connectivity = connectivity;
        _navigator = navigator;

        _projection = Compute();
        _connectivity.Changed += OnConnectivityChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>QueryError</c>).</summary>
    public static string Slug => QueryErrorRegistration.Slug;

    /// <summary>The current render projection (visibility + icon + copy + CTA + role/live + auto-retry + name).</summary>
    public QueryErrorProjection Projection => _projection;

    /// <summary>Whether the surface is shown (web <c>error</c> is truthy).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>
    /// Present an error, reproducing the web component's props + local classification
    /// (web/src/components/feedback/QueryError.tsx L47-51): <paramref name="transientWaiting"/> is the web
    /// <c>isTransientWaiting(error)</c> verdict (it wins outright when set); <paramref name="status"/> is the
    /// resolved API status (null for a non-API error → the network branch); supplying <paramref name="onRetry"/>
    /// shows the retry CTA exactly as the web renders it only when <c>onRetry</c> is passed, and arms the offline
    /// reconnect auto-retry for a non-API error.
    /// </summary>
    /// <param name="transientWaiting">Whether the error is a rate-limit / breaker-open wait (web <c>isTransientWaiting(error)</c>).</param>
    /// <param name="status">The resolved API status code, or null for a non-API / unknown error.</param>
    /// <param name="resourceName">Singular resource name used in 404 titles (web <c>resourceName</c>).</param>
    /// <param name="listHref">Route to the list view, enabling the 404 CTA (web <c>listHref</c>).</param>
    /// <param name="onRetry">The retry handler; its presence shows the retry CTA (web <c>onRetry</c>).</param>
    public void SetError(
        bool transientWaiting,
        int? status,
        string? resourceName = null,
        string? listHref = null,
        Action? onRetry = null)
    {
        _onRetry = onRetry;
        _request = QueryErrorRequest.ForError(
            transientWaiting,
            status,
            canRetry: onRetry is not null,
            resourceName: resourceName,
            listHref: listHref);
        Reproject();
    }

    /// <summary>Hide the surface — the web <c>if (!error) return null</c> gate (a resolved / cleared error).</summary>
    public void Clear()
    {
        _onRetry = null;
        _request = QueryErrorRequest.None;
        Reproject();
    }

    /// <summary>
    /// Dispatch the resolved CTA, reproducing the web button <c>onClick</c> handlers
    /// (web/src/components/feedback/QueryError.tsx L102, L125, L148, L183): "Back to list" navigates to the list
    /// route, "Sign in" sends the user to login, and an enabled retry invokes the supplied handler. The disabled
    /// offline "Retry when online" button does nothing (the web <c>disabled</c> button), and there is nothing to
    /// do when no CTA is present (the waiting card).
    /// </summary>
    public void InvokeAction()
    {
        if (_disposed)
        {
            return;
        }

        switch (_projection.ActionKind)
        {
            case QueryErrorActionKind.BackToList:
                if (!string.IsNullOrEmpty(_projection.NavigationTarget))
                {
                    _navigator.NavigateToList(_projection.NavigationTarget);
                }

                break;

            case QueryErrorActionKind.SignIn:
                _navigator.NavigateToSignIn();
                break;

            case QueryErrorActionKind.Retry:
            case QueryErrorActionKind.RetryWhenOnline:
                if (_projection.ActionEnabled)
                {
                    _onRetry?.Invoke();
                }

                break;

            case QueryErrorActionKind.None:
            default:
                break;
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _connectivity.Changed -= OnConnectivityChanged;
        GC.SuppressFinalize(this);
    }

    private QueryErrorProjection Compute() =>
        QueryErrorProjection.Project(_request, _connectivity.IsOnline, _localizer);

    private void OnConnectivityChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        // web reconnect effect (L53-66): if the offline auto-retry was armed and the connection has returned,
        // fire the retry exactly once so the user doesn't have to click. Capture the armed state from the
        // pre-change (offline) projection, reproject for the new connectivity, then dispatch.
        var wasArmed = _projection.AutoRetryEligible;
        Reproject();

        if (wasArmed && _connectivity.IsOnline)
        {
            _onRetry?.Invoke();
        }
    }

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
