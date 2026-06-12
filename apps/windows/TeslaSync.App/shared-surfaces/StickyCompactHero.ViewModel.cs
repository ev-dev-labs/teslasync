using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="StickyCompactHero"/> view — the native port of the web
/// component body (web/src/components/status/StickyCompactHero.tsx). The web component keeps a single piece of local
/// state (<c>visible</c>, toggled by the <c>IntersectionObserver</c>) and reads its <c>status</c> /
/// <c>lastCheckedLabel</c> / <c>refreshing</c> props, painting a per-status icon + headline and wiring the
/// scroll-to-top and optional refresh actions. This holder reproduces that exactly: it owns the mutable presentation
/// state (<see cref="SetTargetIntersecting"/> is the observer callback, <see cref="SetStatus"/> /
/// <see cref="SetLastCheckedLabel"/> / <see cref="SetRefreshing"/> are the prop updates), recomputes the pure
/// <see cref="StickyCompactHeroProjection"/> on every change and raises <see cref="PropertyChanged"/> so the view
/// re-renders, resolves whether the refresh affordance is offered from whether an <see cref="IStickyHeroRefresher"/>
/// was supplied (the web <c>onRefresh?</c>), and routes the two actions through their seams while recording the
/// PII-safe diagnostics (<see cref="RequestScrollToTop"/> / <see cref="RequestRefresh"/>). Because the surface has no
/// data fetch there is no loading / error / stale / offline branch to model (the web source has none); the states are
/// the hidden bar (hero on screen), the shown bar across the five status variants, the optional last-checked label
/// and the optional / busy refresh affordance. The view performs no i18n, scrolling or refresh decision of its own —
/// it binds to this holder. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class StickyCompactHeroViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IStickyHeroScroller _scroller;
    private readonly IStickyHeroRefresher? _refresher;
    private readonly StickyCompactHeroDiagnostics _diagnostics;

    private HealthStatus _status;
    private string? _lastCheckedLabel;
    private bool _refreshing;
    private bool _targetIntersecting;
    private StickyCompactHeroDisplay _display;
    private bool _opened;

    /// <summary>
    /// Creates the holder over the i18n facade, the scroll-to-top seam, the optional refresh seam and diagnostics.
    /// </summary>
    /// <param name="localizer">The i18n facade the headline + accessible names resolve through (web <c>useTranslation</c>).</param>
    /// <param name="scroller">The scroll-to-top seam (web <c>window.scrollTo</c>); defaults to <see cref="NullStickyHeroScroller"/>.</param>
    /// <param name="refresher">The refresh seam (web <c>onRefresh?</c>); null offers no refresh affordance.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="initialStatus">The initial health status (web initial <c>status</c> prop); defaults to <see cref="HealthStatus.Unknown"/>.</param>
    /// <param name="initialLastCheckedLabel">The initial last-checked label (web initial <c>lastCheckedLabel</c>).</param>
    /// <param name="initialRefreshing">The initial refreshing flag (web initial <c>refreshing</c>; defaults false).</param>
    public StickyCompactHeroViewModel(
        ILocalizer localizer,
        IStickyHeroScroller? scroller = null,
        IStickyHeroRefresher? refresher = null,
        StickyCompactHeroDiagnostics? diagnostics = null,
        HealthStatus initialStatus = HealthStatus.Unknown,
        string? initialLastCheckedLabel = null,
        bool initialRefreshing = false)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _scroller = scroller ?? NullStickyHeroScroller.Instance;
        _refresher = refresher;
        _diagnostics = diagnostics ?? new StickyCompactHeroDiagnostics();

        _status = initialStatus;
        _lastCheckedLabel = initialLastCheckedLabel;
        _refreshing = initialRefreshing;

        // web initial state: visible === false (the bar is hidden until the hero scrolls out of view).
        _targetIntersecting = true;

        _display = Compute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>StickyCompactHero</c>).</summary>
    public static string Slug => StickyCompactHeroRegistration.Slug;

    /// <summary>The current render projection (visibility, glyph, accent, headline, suffix, refresh flags, aria).</summary>
    public StickyCompactHeroDisplay Display => _display;

    /// <summary>Whether the compact bar is currently shown (web <c>visible</c>).</summary>
    public bool IsVisible => _display.IsVisible;

    /// <summary>The current health status (web <c>status</c>).</summary>
    public HealthStatus Status => _status;

    /// <summary>Whether the refresh affordance is offered (web <c>onRefresh != null</c>).</summary>
    public bool HasRefresh => _refresher is not null;

    /// <summary>Whether a refresh is currently in flight (web <c>refreshing</c>).</summary>
    public bool Refreshing => _refreshing;

    /// <summary>
    /// The <c>IntersectionObserver</c> callback (web StickyCompactHero.tsx L64-70): set whether the watched hero is on
    /// screen. When it scrolls out of view (<paramref name="targetIntersecting"/> false) the bar is shown; when it is
    /// back on screen the bar is hidden. Re-projects and notifies only when the visibility actually moves.
    /// </summary>
    /// <param name="targetIntersecting">Whether the watched hero is on screen (web <c>entry.isIntersecting</c>).</param>
    public void SetTargetIntersecting(bool targetIntersecting)
    {
        if (_targetIntersecting == targetIntersecting)
        {
            return;
        }

        _targetIntersecting = targetIntersecting;
        Reproject();
    }

    /// <summary>Update the health status (web <c>status</c> prop change).</summary>
    /// <param name="status">The new health status.</param>
    public void SetStatus(HealthStatus status)
    {
        if (_status == status)
        {
            return;
        }

        _status = status;
        Reproject();
    }

    /// <summary>Update the relative last-checked label (web <c>lastCheckedLabel</c> prop change).</summary>
    /// <param name="lastCheckedLabel">The new last-checked label, e.g. "12s ago"; null / empty hides it.</param>
    public void SetLastCheckedLabel(string? lastCheckedLabel)
    {
        if (string.Equals(_lastCheckedLabel, lastCheckedLabel, StringComparison.Ordinal))
        {
            return;
        }

        _lastCheckedLabel = lastCheckedLabel;
        Reproject();
    }

    /// <summary>Update the refreshing flag (web <c>refreshing</c> prop change).</summary>
    /// <param name="refreshing">Whether a refresh is in flight.</param>
    public void SetRefreshing(bool refreshing)
    {
        if (_refreshing == refreshing)
        {
            return;
        }

        _refreshing = refreshing;
        Reproject();
    }

    /// <summary>
    /// Activate the bar's scroll-to-top action (web <c>handleScrollTop</c>): smooth-scroll the host content to the
    /// top through the scroller seam and record the activation. Safe when no host scroller is wired (no-op seam).
    /// </summary>
    public void RequestScrollToTop()
    {
        _scroller.ScrollToTop();
        _diagnostics.RecordScrollToTop();
    }

    /// <summary>
    /// Activate the refresh action (web <c>onRefresh</c>): when the affordance is offered and not already refreshing,
    /// invoke the refresh seam and record the activation; otherwise do nothing (the web button is absent when there is
    /// no <c>onRefresh</c> and disabled while <c>refreshing</c>).
    /// </summary>
    /// <returns>True when the refresh seam was invoked; false when there is none or a refresh is already in flight.</returns>
    public bool RequestRefresh()
    {
        if (_refresher is null || _refreshing)
        {
            return false;
        }

        _refresher.Refresh();
        _diagnostics.RecordRefresh();
        return true;
    }

    /// <summary>
    /// Record the surface opening exactly once (web component mount), emitting the <c>view.opened</c> diagnostic.
    /// Idempotent — a second call is a no-op — so repeated <c>Loaded</c> events never double-count.
    /// </summary>
    public void MarkOpened()
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private StickyCompactHeroDisplay Compute()
    {
        var model = StickyCompactHeroModel.Create(
            _status,
            _lastCheckedLabel,
            hasRefresh: _refresher is not null,
            refreshing: _refreshing,
            targetIntersecting: _targetIntersecting);

        return StickyCompactHeroProjection.Project(model, _localizer);
    }

    private void Reproject()
    {
        var next = Compute();
        if (next == _display)
        {
            return;
        }

        _display = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Display)));
    }
}
