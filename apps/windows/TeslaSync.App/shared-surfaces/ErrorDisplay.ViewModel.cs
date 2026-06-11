using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ErrorDisplay"/> view — the native port of the web
/// <c>ErrorDisplay</c> body (web/src/components/feedback/ErrorDisplay.tsx L32-164). It binds the i18n facade
/// (P1/S10), the <see cref="IErrorDisplayConnectivitySource"/> (the P1/S8 connectivity seam, the web
/// <c>useOnlineStatus()</c> hook) and the <see cref="IErrorDisplayNavigator"/> (the P1/S8 navigation seam, the web
/// <c>useNavigate()</c> hook + login redirect). The host describes the current error with <see cref="SetError"/>
/// (the web <c>error</c> / <c>onRetry</c> / <c>resourceName</c> / <c>listHref</c> props) or hides the surface with
/// <see cref="Clear"/> (the web <c>if (!error) return null</c> gate); the holder recomputes the pure
/// <see cref="ErrorDisplayProjection"/> whenever the error or the connectivity moves and raises
/// <see cref="PropertyChanged"/> so the view re-renders. <see cref="InvokeAction"/> dispatches the resolved CTA to
/// the retry callback or the navigator (the web button <c>onClick</c> handlers). <see cref="Dispose"/>
/// unsubscribes from the connectivity seam (the web effect cleanup). The view performs no I/O, reads no
/// connectivity and navigates nothing itself.
/// </summary>
public sealed class ErrorDisplayViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IErrorDisplayConnectivitySource _connectivity;
    private readonly IErrorDisplayNavigator _navigator;
    private ErrorDisplayRequest _request = ErrorDisplayRequest.None;
    private Action? _onRetry;
    private ErrorDisplayProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, connectivity seam and navigation seam (P1/S8 / P1/S10).</summary>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="connectivity">The connectivity state-holder seam (web <c>useOnlineStatus()</c>).</param>
    /// <param name="navigator">The navigation seam the CTAs invoke (web <c>useNavigate()</c> + login redirect).</param>
    public ErrorDisplayViewModel(
        ILocalizer localizer,
        IErrorDisplayConnectivitySource connectivity,
        IErrorDisplayNavigator navigator)
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

    /// <summary>The canonical surface slug (<c>ErrorDisplay</c>).</summary>
    public static string Slug => ErrorDisplayRegistration.Slug;

    /// <summary>The current render projection (visibility + icon + copy + CTA + role/live + accessible name).</summary>
    public ErrorDisplayProjection Projection => _projection;

    /// <summary>Whether the surface is shown (web <c>error</c> is truthy).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>
    /// Present an error, reproducing the web component's props (web/src/components/feedback/ErrorDisplay.tsx
    /// L32-46): <paramref name="status"/> is the resolved API status (null for a non-API error → the network
    /// branch); supplying <paramref name="onRetry"/> shows the retry CTA exactly as the web renders it only when
    /// <c>onRetry</c> is passed.
    /// </summary>
    /// <param name="status">The resolved API status code, or null for a non-API / unknown error.</param>
    /// <param name="compact">Tighter padding for inline mutation errors (web <c>compact</c>).</param>
    /// <param name="resourceName">Singular resource name used in 404 titles (web <c>resourceName</c>).</param>
    /// <param name="listHref">Route to the list view, enabling the 404 CTA (web <c>listHref</c>).</param>
    /// <param name="onRetry">The retry handler; its presence shows the retry CTA (web <c>onRetry</c>).</param>
    public void SetError(
        int? status,
        bool compact = false,
        string? resourceName = null,
        string? listHref = null,
        Action? onRetry = null)
    {
        _onRetry = onRetry;
        _request = ErrorDisplayRequest.ForStatus(
            status,
            canRetry: onRetry is not null,
            compact: compact,
            resourceName: resourceName,
            listHref: listHref);
        Reproject();
    }

    /// <summary>Hide the surface — the web <c>if (!error) return null</c> gate (a resolved / cleared error).</summary>
    public void Clear()
    {
        _onRetry = null;
        _request = ErrorDisplayRequest.None;
        Reproject();
    }

    /// <summary>
    /// Dispatch the resolved CTA, reproducing the web button <c>onClick</c> handlers
    /// (web/src/components/feedback/ErrorDisplay.tsx L62, L88, L113, L149): "Back to list" navigates to the list
    /// route, "Sign in" sends the user to login, and an enabled retry invokes the supplied handler. The disabled
    /// offline "Retry when online" button does nothing (the web <c>disabled</c> button), and there is nothing to
    /// do when no CTA is present.
    /// </summary>
    public void InvokeAction()
    {
        if (_disposed)
        {
            return;
        }

        switch (_projection.ActionKind)
        {
            case ErrorDisplayActionKind.BackToList:
                if (!string.IsNullOrEmpty(_projection.NavigationTarget))
                {
                    _navigator.NavigateToList(_projection.NavigationTarget);
                }

                break;

            case ErrorDisplayActionKind.SignIn:
                _navigator.NavigateToSignIn();
                break;

            case ErrorDisplayActionKind.Retry:
            case ErrorDisplayActionKind.RetryWhenOnline:
                if (_projection.ActionEnabled)
                {
                    _onRetry?.Invoke();
                }

                break;

            case ErrorDisplayActionKind.None:
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

    private ErrorDisplayProjection Compute() =>
        ErrorDisplayProjection.Project(_request, _connectivity.IsOnline, _localizer);

    private void OnConnectivityChanged(object? sender, EventArgs e) => Reproject();

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
