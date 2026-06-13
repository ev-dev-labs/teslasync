using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PageHeaderSticky"/> view — the native port of the web
/// component body (web/src/components/layout/PageHeaderSticky.tsx). The web component keeps a single piece of local
/// state (<c>visible</c>, toggled by the <c>IntersectionObserver</c> callback) and reads its <c>scrollToTop</c> /
/// <c>topOffset</c> / <c>ariaLabel</c> props, rendering a compact bar that — when <c>scrollToTop</c> is set — becomes
/// a scroll-to-top affordance wired to <c>handleScrollTop</c>. This holder reproduces that exactly: it owns the
/// mutable presentation state (<see cref="SetTargetVisibility"/> is the observer callback, <see cref="SetScrollToTop"/>
/// / <see cref="SetTopOffset"/> / <see cref="SetRegionLabel"/> are the prop updates), recomputes the pure
/// <see cref="PageHeaderStickyDisplay"/> on every change and raises <see cref="PropertyChanged"/> so the view
/// re-renders, and routes the scroll-to-top action through its seam while recording the PII-safe diagnostics
/// (<see cref="RequestScrollToTop"/>). Because the surface has no data fetch there is no loading / error / stale /
/// offline branch to model (the web source has none); the states are the hidden bar (hero on screen or below the
/// viewport), the shown bar as the interactive scroll-to-top affordance and the shown bar as a static row. The view
/// performs no i18n, scrolling or visibility decision of its own — it binds to this holder. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PageHeaderStickyViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IPageScroller _scroller;
    private readonly PageHeaderStickyDiagnostics _diagnostics;

    private bool _targetIntersecting;
    private bool _targetAboveViewport;
    private bool _scrollToTop;
    private double _topOffset;
    private string? _regionLabel;
    private PageHeaderStickyDisplay _display;
    private bool _opened;

    /// <summary>
    /// Creates the holder over the i18n facade, the scroll-to-top seam and diagnostics.
    /// </summary>
    /// <param name="localizer">The i18n facade the accessible names resolve through (web <c>useTranslation</c>).</param>
    /// <param name="scroller">The scroll-to-top seam (web <c>handleScrollTop</c>); defaults to <see cref="NullPageScroller"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="regionLabel">The host-supplied per-page region label (web required <c>ariaLabel</c> prop); null / blank uses the localized default.</param>
    /// <param name="scrollToTop">Whether the bar is the scroll-to-top affordance (web <c>scrollToTop</c>; defaults true).</param>
    /// <param name="topOffset">The pixel offset from the top of the viewport (web <c>topOffset</c>; defaults 0).</param>
    public PageHeaderStickyViewModel(
        ILocalizer localizer,
        IPageScroller? scroller = null,
        PageHeaderStickyDiagnostics? diagnostics = null,
        string? regionLabel = null,
        bool scrollToTop = true,
        double topOffset = 0)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _scroller = scroller ?? NullPageScroller.Instance;
        _diagnostics = diagnostics ?? new PageHeaderStickyDiagnostics();

        _regionLabel = regionLabel;
        _scrollToTop = scrollToTop;
        _topOffset = topOffset;

        // web initial state: visible === false (the bar is hidden until the hero scrolls above the viewport top).
        _targetIntersecting = true;
        _targetAboveViewport = false;

        _display = Compute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>PageHeaderSticky</c>).</summary>
    public static string Slug => PageHeaderStickyRegistration.Slug;

    /// <summary>The current render projection (visibility, scroll affordance, arrow, offset, accessible names).</summary>
    public PageHeaderStickyDisplay Display => _display;

    /// <summary>Whether the sticky bar is currently shown (web <c>visible</c>).</summary>
    public bool IsVisible => _display.IsVisible;

    /// <summary>Whether the bar is the interactive scroll-to-top affordance (web <c>scrollToTop</c>).</summary>
    public bool ScrollToTopEnabled => _display.ScrollToTopEnabled;

    /// <summary>The current docked top offset in pixels (web <c>topOffset</c>).</summary>
    public double TopOffset => _topOffset;

    /// <summary>
    /// The <c>IntersectionObserver</c> callback (web PageHeaderSticky.tsx L64-72): set whether the watched hero is on
    /// screen and whether it has scrolled above the viewport top. The bar is shown only when the hero is not
    /// intersecting AND has scrolled above (the web <c>!entry.isIntersecting &amp;&amp; entry.boundingClientRect.top &lt; 0</c>),
    /// so it never flashes while the hero is still below the viewport on first paint. Re-projects and notifies only
    /// when the projection actually changes.
    /// </summary>
    /// <param name="targetIntersecting">Whether the watched hero is on screen (web <c>entry.isIntersecting</c>).</param>
    /// <param name="targetAboveViewport">Whether the hero has scrolled above the viewport top (web <c>entry.boundingClientRect.top &lt; 0</c>).</param>
    public void SetTargetVisibility(bool targetIntersecting, bool targetAboveViewport)
    {
        if (_targetIntersecting == targetIntersecting && _targetAboveViewport == targetAboveViewport)
        {
            return;
        }

        _targetIntersecting = targetIntersecting;
        _targetAboveViewport = targetAboveViewport;
        Reproject();
    }

    /// <summary>Update whether the bar is the scroll-to-top affordance (web <c>scrollToTop</c> prop change).</summary>
    /// <param name="scrollToTop">Whether the whole bar scrolls to top and shows the trailing arrow.</param>
    public void SetScrollToTop(bool scrollToTop)
    {
        if (_scrollToTop == scrollToTop)
        {
            return;
        }

        _scrollToTop = scrollToTop;
        Reproject();
    }

    /// <summary>Update the docked top offset (web <c>topOffset</c> prop change).</summary>
    /// <param name="topOffset">The new pixel offset from the top of the viewport.</param>
    public void SetTopOffset(double topOffset)
    {
        if (_topOffset.Equals(topOffset))
        {
            return;
        }

        _topOffset = topOffset;
        Reproject();
    }

    /// <summary>Update the host-supplied region label (web <c>ariaLabel</c> prop change).</summary>
    /// <param name="regionLabel">The new per-page region label; null / blank uses the localized default.</param>
    public void SetRegionLabel(string? regionLabel)
    {
        if (string.Equals(_regionLabel, regionLabel, StringComparison.Ordinal))
        {
            return;
        }

        _regionLabel = regionLabel;
        Reproject();
    }

    /// <summary>
    /// Activate the bar's scroll-to-top action (web <c>handleScrollTop</c>): when the bar is the scroll-to-top
    /// affordance, smooth-scroll the host content to the top through the scroller seam and record the activation;
    /// otherwise do nothing (the web renders a non-interactive <c>&lt;div&gt;</c> when <c>scrollToTop</c> is false).
    /// </summary>
    /// <returns>True when the scroll seam was invoked; false when the bar is not the scroll-to-top affordance.</returns>
    public bool RequestScrollToTop()
    {
        if (!_scrollToTop)
        {
            return false;
        }

        _scroller.ScrollToTop();
        _diagnostics.RecordScrollToTop();
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

    private PageHeaderStickyDisplay Compute()
    {
        var model = PageHeaderStickyModel.Create(
            _targetIntersecting,
            _targetAboveViewport,
            _scrollToTop,
            _topOffset,
            _regionLabel);

        return PageHeaderStickyProjection.Project(model, _localizer);
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
