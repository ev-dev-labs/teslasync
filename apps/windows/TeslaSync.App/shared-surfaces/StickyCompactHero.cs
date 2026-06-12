using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>StickyCompactHero</c> shared surface — a parity port of
/// <c>web/src/components/status/StickyCompactHero.tsx</c>. It is the collapsed-on-scroll status bar that the
/// SystemStatusPage docks above its content: while the full <see cref="TeslaSync.App.Components.Status.TsStatusHero"/>
/// is on screen the bar is hidden, and once that hero scrolls out of view the bar appears with a compact status
/// summary — a per-status icon + accent + short headline (from the shared
/// <see cref="TeslaSync.App.Core.Status.StatusPresentation"/>), an optional last-checked label, a trailing up-arrow
/// affordance whose whole row smooth-scrolls back to the top (web <c>window.scrollTo</c>), and an optional refresh
/// button that shows a busy ring while a refresh is in flight (the web <c>{onRefresh &amp;&amp; ...}</c> +
/// <c>disabled={refreshing}</c>). The view composes the shared <see cref="TsGlassPanel"/> surface, a tap-to-top
/// <see cref="Button"/> hosting the icon / headline / last-checked / arrow row, and the shared <see cref="TsButton"/>
/// icon button for refresh; it binds the <see cref="StickyCompactHeroViewModel"/> and performs no i18n, scrolling or
/// refresh decision itself. The visibility gate is the web <c>IntersectionObserver</c>: the host feeds
/// <see cref="SetTargetIntersecting"/> from its page <c>ScrollViewer</c> and the whole surface collapses
/// (<see cref="UIElement.Visibility"/>) when the hero is on screen — a binary show/hide with no entrance animation, so
/// it is reduce-motion-safe by construction; the only motion is the platform busy ring on refresh. Because the web
/// component is purely presentational (its parent owns all data fetching) there is no loading / empty / error / stale
/// / offline chrome — the reproduced states are the hidden bar, the shown bar across the five status variants, the
/// optional last-checked label and the optional / busy refresh affordance. The region carries a composed Narrator
/// name (the localized "Status summary" plus the live status), each interactive control carries its localized
/// accessible name + automation id, the icons are decorative, and the surface emits the <c>view.opened</c> diagnostic
/// once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class StickyCompactHero : ContentControl, IDisposable
{
    private const double RowSpacing = 12;          // web gap-3
    private const double LeftGroupSpacing = 8;     // web gap-2
    private const double IconFontSize = 16;        // web icon h-4 w-4
    private const double ArrowFontSize = 14;       // web arrow h-3.5 w-3.5
    private const double HeadlineFontSize = 14;    // web text-sm
    private const double BarPaddingX = 16;         // web px-4
    private const double BarPaddingY = 8;          // web py-2

    private readonly StickyCompactHeroViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly FontIcon _statusIcon = new()
    {
        FontSize = IconFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _headline = new()
    {
        FontSize = HeadlineFontSize,
        FontWeight = FontWeights.SemiBold,
        VerticalAlignment = VerticalAlignment.Center,
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    private readonly Caption _lastChecked = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly FontIcon _arrow = new()
    {
        FontSize = ArrowFontSize,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Right,
        Foreground = DisplayTokens.TextMuted,
    };

    private readonly Button _scrollButton;
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Icon,
        IconGlyph = StickyCompactHeroRegistration.RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsGlassPanel _panel = new();
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds a
    /// passthrough localizer, a no-op scroller and no refresher, so it renders the resting (hidden) bar. Supply an
    /// explicit <see cref="ILocalizer"/>, an <see cref="IStickyHeroScroller"/> and (optionally) an
    /// <see cref="IStickyHeroRefresher"/> via the other constructors to drive i18n, scrolling and refresh from the
    /// composition root.
    /// </summary>
    public StickyCompactHero()
        : this(new StickyCompactHeroViewModel(PassthroughLocalizer.Instance))
    {
    }

    /// <summary>Creates the surface over the i18n facade and the action seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the headline + accessible names resolve through (web <c>useTranslation</c>).</param>
    /// <param name="scroller">The scroll-to-top seam (web <c>window.scrollTo</c>).</param>
    /// <param name="refresher">The refresh seam (web <c>onRefresh?</c>); null offers no refresh affordance.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public StickyCompactHero(
        ILocalizer localizer,
        IStickyHeroScroller? scroller = null,
        IStickyHeroRefresher? refresher = null,
        StickyCompactHeroDiagnostics? diagnostics = null)
        : this(new StickyCompactHeroViewModel(localizer, scroller, refresher, diagnostics))
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts).</summary>
    /// <param name="viewModel">The backing state holder.</param>
    public StickyCompactHero(StickyCompactHeroViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;

        // web: a focusable button whose whole row scrolls to top; transparent so it blends into the glass bar.
        var leftGroup = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LeftGroupSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        leftGroup.Children.Add(_statusIcon);
        leftGroup.Children.Add(_headline);
        leftGroup.Children.Add(_lastChecked);

        var scrollContent = new Grid { VerticalAlignment = VerticalAlignment.Center };
        scrollContent.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        scrollContent.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(leftGroup, 0);
        Grid.SetColumn(_arrow, 1);
        scrollContent.Children.Add(leftGroup);
        scrollContent.Children.Add(_arrow);

        _scrollButton = new Button
        {
            Content = scrollContent,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _scrollButton.Click += OnScrollButtonClick;

        var row = new Grid
        {
            ColumnSpacing = RowSpacing,
            Padding = new Thickness(BarPaddingX, BarPaddingY, BarPaddingX, BarPaddingY),
        };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_scrollButton, 0);
        Grid.SetColumn(_refresh, 1);
        row.Children.Add(_scrollButton);
        row.Children.Add(_refresh);

        _refresh.Click += OnRefreshClick;

        // Icons are decorative — the composed region name + the buttons' names carry the announcement (web aria-hidden).
        AutomationProperties.SetAccessibilityView(_statusIcon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_arrow, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, StickyCompactHeroRegistration.RegionAutomationId);
        AutomationProperties.SetAutomationId(_scrollButton, StickyCompactHeroRegistration.ScrollToTopAutomationId);
        AutomationProperties.SetAutomationId(_refresh, StickyCompactHeroRegistration.RefreshAutomationId);

        // web role="region" with a polite live region so the status change is announced without moving focus.
        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Custom);
        LiveRegion.Configure(this);

        _panel.Content = row;
        Content = _panel;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>StickyCompactHero</c>).</summary>
    public static string Slug => StickyCompactHeroRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public StickyCompactHeroViewModel ViewModel => _viewModel;

    /// <summary>
    /// The pixel offset from the top of the viewport when the bar is docked (web <c>topOffset</c> / sticky <c>top</c>).
    /// The host owns the sticky placement; this only insets the bar from the top edge.
    /// </summary>
    public double TopOffset
    {
        get => Margin.Top;
        set => Margin = new Thickness(0, value, 0, 0);
    }

    /// <summary>
    /// The <c>IntersectionObserver</c> callback (web StickyCompactHero.tsx L64-70): tell the surface whether the
    /// watched full hero is currently on screen. The host wires this from its page <c>ScrollViewer</c>; the bar shows
    /// when the hero scrolls out of view and hides when it returns.
    /// </summary>
    /// <param name="targetIntersecting">Whether the watched hero is on screen (web <c>entry.isIntersecting</c>).</param>
    public void SetTargetIntersecting(bool targetIntersecting) => _viewModel.SetTargetIntersecting(targetIntersecting);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _scrollButton.Click -= OnScrollButtonClick;
        _refresh.Click -= OnRefreshClick;
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _viewModel.RequestRefresh();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        StickyCompactHeroDisplay display = _viewModel.Display;

        // web: if (!visible) return null — collapse the whole bar when the hero is on screen.
        Visibility = display.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        Brush accent = DisplayPrimitives.HexBrush(display.AccentHex);
        _statusIcon.Glyph = display.Glyph;
        _statusIcon.Foreground = accent;

        _headline.Text = display.Headline;
        _headline.Foreground = accent;

        _lastChecked.Value = display.LastCheckedText;
        _lastChecked.Visibility = display.HasLastChecked ? Visibility.Visible : Visibility.Collapsed;

        _arrow.Glyph = display.ArrowUpGlyph;

        _refresh.Visibility = display.ShowRefresh ? Visibility.Visible : Visibility.Collapsed;
        _refresh.IsLoading = display.Refreshing;
        _refresh.IsEnabled = display.CanRefresh;

        AutomationProperties.SetName(_scrollButton, display.ScrollToTopName);
        AutomationProperties.SetName(_refresh, display.RefreshName);

        // web region aria-label is "Status summary"; enrich the Narrator name with the live status + last-checked.
        AutomationProperties.SetName(this, display.AutomationName);
        AutomationProperties.SetLocalizedLandmarkType(this, display.RegionName);
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
