using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>PageHeaderSticky</c> shared surface — a parity port of
/// <c>web/src/components/layout/PageHeaderSticky.tsx</c>. It is the <c>IntersectionObserver</c>-driven sticky bar a
/// page docks above its content: while the page hero (typically the overview card) is on screen the bar is hidden,
/// and once that hero scrolls above the viewport top the bar appears with a caller-supplied compressed summary (the
/// web <c>children</c>, set via <see cref="BarContent"/>). When the bar is the scroll-to-top affordance (the web
/// <c>scrollToTop</c> default) the whole row is a focusable button with a trailing up-arrow whose activation
/// smooth-scrolls the page content back to the top (web <c>handleScrollTop</c>); when it is disabled the bar is a
/// static, non-interactive row with no arrow (the web <c>scrollToTop ? &lt;button&gt; : &lt;div&gt;</c> branch). The view
/// composes the shared <see cref="TsGlassPanel"/> surface (the web <c>bg-[var(--bg-1)]/95 backdrop-blur</c> glass
/// bar), a tap-to-top <see cref="Button"/> hosting the summary + arrow row, and a <see cref="ContentPresenter"/>
/// holding the host content; it binds the <see cref="PageHeaderStickyViewModel"/> and performs no i18n, scrolling or
/// visibility decision itself. The visibility gate is the web <c>IntersectionObserver</c>: the host feeds
/// <see cref="SetTargetVisibility"/> from its page <c>ScrollViewer</c> and the whole surface collapses
/// (<see cref="UIElement.Visibility"/>) until the hero scrolls above the viewport top — a binary show/hide with no
/// entrance animation, so it is reduce-motion-safe by construction. Because the web component is purely presentational
/// (its parent owns all content) there is no loading / empty / error / stale / offline chrome — the reproduced states
/// are the hidden bar, the shown bar as the interactive scroll-to-top affordance and the shown bar as a static row.
/// The region carries the localized accessible name (web <c>aria-label={ariaLabel}</c>), the scroll control carries
/// the composed "scroll to top" name (web <c>`${ariaLabel} — scroll to top`</c>) and its automation id, the arrow is
/// decorative, and the surface emits the <c>view.opened</c> diagnostic once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class PageHeaderSticky : ContentControl, IDisposable
{
    private const double RowSpacing = 12;        // web gap-3
    private const double ArrowFontSize = 14;     // web arrow h-3.5 w-3.5
    private const double BarPaddingX = 16;       // web px-4
    private const double BarPaddingY = 8;        // web py-2

    private readonly PageHeaderStickyViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly ContentPresenter _contentHost = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Center,
        Foreground = DisplayTokens.TextSecondary,
    };

    private readonly FontIcon _arrow = new()
    {
        FontSize = ArrowFontSize,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Right,
        Foreground = DisplayTokens.TextMuted,
    };

    private readonly Grid _innerGrid;
    private readonly Button _scrollButton;
    private readonly TsGlassPanel _panel = new();

    private bool? _scrollAffordanceApplied;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds a
    /// passthrough localizer and a no-op scroller, so it renders the resting (hidden) bar with the localized default
    /// region label. Supply an explicit <see cref="ILocalizer"/>, an <see cref="IPageScroller"/> and the per-page
    /// region label via the other constructors to drive i18n, scrolling and naming from the composition root.
    /// </summary>
    public PageHeaderSticky()
        : this(new PageHeaderStickyViewModel(PassthroughLocalizer.Instance))
    {
    }

    /// <summary>Creates the surface over the i18n facade and the action seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the accessible names resolve through (web <c>useTranslation</c>).</param>
    /// <param name="regionLabel">The host-supplied per-page region label (web required <c>ariaLabel</c> prop); null / blank uses the localized default.</param>
    /// <param name="scroller">The scroll-to-top seam (web <c>handleScrollTop</c>); null offers a safe no-op.</param>
    /// <param name="scrollToTop">Whether the bar is the scroll-to-top affordance (web <c>scrollToTop</c>; defaults true).</param>
    /// <param name="topOffset">The pixel offset from the top of the viewport (web <c>topOffset</c>; defaults 0).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public PageHeaderSticky(
        ILocalizer localizer,
        string? regionLabel = null,
        IPageScroller? scroller = null,
        bool scrollToTop = true,
        double topOffset = 0,
        PageHeaderStickyDiagnostics? diagnostics = null)
        : this(new PageHeaderStickyViewModel(localizer, scroller, diagnostics, regionLabel, scrollToTop, topOffset))
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts).</summary>
    /// <param name="viewModel">The backing state holder.</param>
    public PageHeaderSticky(PageHeaderStickyViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;

        // web inner row: the summary fills the row and truncates; the up-arrow sits at the trailing edge.
        _innerGrid = new Grid
        {
            ColumnSpacing = RowSpacing,
            Padding = new Thickness(BarPaddingX, BarPaddingY, BarPaddingX, BarPaddingY),
            VerticalAlignment = VerticalAlignment.Center,
        };
        _innerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _innerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_contentHost, 0);
        Grid.SetColumn(_arrow, 1);
        _innerGrid.Children.Add(_contentHost);
        _innerGrid.Children.Add(_arrow);

        // web: when scrollToTop is set the whole row is a focusable button; transparent so it blends into the bar.
        _scrollButton = new Button
        {
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _scrollButton.Click += OnScrollButtonClick;

        // The arrow is decorative — the region name + the button name carry the announcement (web aria-hidden).
        AutomationProperties.SetAccessibilityView(_arrow, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, PageHeaderStickyRegistration.RegionAutomationId);
        AutomationProperties.SetAutomationId(_scrollButton, PageHeaderStickyRegistration.ScrollToTopAutomationId);

        // web role="region" — a named custom landmark (not an aria-live region; the bar's content is host-owned).
        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Custom);

        Content = _panel;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>PageHeaderSticky</c>).</summary>
    public static string Slug => PageHeaderStickyRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PageHeaderStickyViewModel ViewModel => _viewModel;

    /// <summary>
    /// The caller-supplied compressed summary hosted inside the bar — the native analogue of the web <c>children</c>
    /// (PageHeaderSticky.tsx L13, L100-109). Typically a one-line summary row; the host owns its content and naming.
    /// </summary>
    public UIElement? BarContent
    {
        get => _contentHost.Content as UIElement;
        set => _contentHost.Content = value;
    }

    /// <summary>
    /// The <c>IntersectionObserver</c> callback (web PageHeaderSticky.tsx L64-72): tell the surface whether the
    /// watched hero is currently on screen and whether it has scrolled above the viewport top. The host wires this
    /// from its page <c>ScrollViewer</c>; the bar shows when the hero scrolls above the viewport and hides otherwise.
    /// </summary>
    /// <param name="targetIntersecting">Whether the watched hero is on screen (web <c>entry.isIntersecting</c>).</param>
    /// <param name="targetAboveViewport">Whether the hero has scrolled above the viewport top (web <c>entry.boundingClientRect.top &lt; 0</c>).</param>
    public void SetTargetVisibility(bool targetIntersecting, bool targetAboveViewport) =>
        _viewModel.SetTargetVisibility(targetIntersecting, targetAboveViewport);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _scrollButton.Click -= OnScrollButtonClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mount: emit the view.opened diagnostic exactly once.
        _viewModel.MarkOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnScrollButtonClick(object sender, RoutedEventArgs e) => _viewModel.RequestScrollToTop();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        PageHeaderStickyDisplay display = _viewModel.Display;

        // web: if (!visible) return null — collapse the whole bar until the hero scrolls above the viewport top.
        Visibility = display.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        // web style={{ top: topOffset }} — the host owns the sticky placement; this insets the bar from the top edge.
        Margin = new Thickness(0, display.TopOffset, 0, 0);

        _arrow.Glyph = display.ArrowGlyph;
        _arrow.Visibility = display.ShowArrow ? Visibility.Visible : Visibility.Collapsed;

        ApplyScrollAffordance(display.ScrollToTopEnabled);

        AutomationProperties.SetName(this, display.RegionName);
        AutomationProperties.SetLocalizedLandmarkType(this, display.RegionName);
        AutomationProperties.SetName(_scrollButton, display.ScrollToTopName);
    }

    // web scrollToTop ? <button> : <div> — host the inner row in the focusable scroll button or directly in the
    // glass bar, reparenting only when the affordance actually toggles so the host content is preserved.
    private void ApplyScrollAffordance(bool enabled)
    {
        if (_scrollAffordanceApplied == enabled)
        {
            return;
        }

        _scrollButton.Content = null;
        if (ReferenceEquals(_panel.Content, _innerGrid))
        {
            _panel.Content = null;
        }

        if (enabled)
        {
            _scrollButton.Content = _innerGrid;
            _panel.Content = _scrollButton;
        }
        else
        {
            _panel.Content = _innerGrid;
        }

        _scrollAffordanceApplied = enabled;
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }
}
