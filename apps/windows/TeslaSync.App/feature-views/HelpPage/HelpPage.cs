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
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.UI;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>HelpPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/HelpPage.tsx</c> (the deterministic RAG-help baseline; unrouted in App.tsx,
/// reachable on Windows as the hidden <c>Help</c> deep-link). It binds to a <see cref="HelpPageViewModel"/> and
/// renders every web region with Fluent components and design tokens: the page header (web
/// <c>PageContainer title</c> / <c>usePageTitle</c> → <c>help.title</c>), the framing intro panel (GlassPanel1,
/// web <c>help.intro</c>) and the responsive curated-link grid whose cards (GlassPanel2) each wrap a chromeless
/// hyperlink that navigates to an existing canonical route — the documentation, onboarding, system-status,
/// search and chatbot destinations — with a cyan accent icon tile, the localized title, the one-line description
/// and a trailing chevron. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="HelpDisplay"/> projection. State changes are marshalled onto the UI thread; the intro
/// panel is always visible and the link region falls back to a friendly empty surface (never a blank box).
/// </summary>
public sealed partial class HelpPage : UserControl, IDisposable
{
    private const double SmallBreakpoint = 640;   // web sm: → 2 columns
    private const double LargeBreakpoint = 1024;   // web lg: → 3 columns
    private const double Gutter = 16;              // web gap-4

    private readonly HelpPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _opened;

    private readonly PageTitle _title = new();

    private readonly TsGlassPanel _introPanel = new() { Glow = GlassGlow.None, Padding = new Thickness(20) };
    private readonly TextBlock _intro = new()
    {
        TextWrapping = TextWrapping.Wrap,
        FontSize = 14,
    };

    private readonly Grid _linksHost = new();
    private readonly List<FrameworkElement> _cards = new();
    private Grid? _cardsGrid;
    private int _currentColumns;

    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE897" };

    /// <summary>Creates the page over the shell resource localizer and the default curated catalog.</summary>
    public HelpPage()
        : this(ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit localizer (used by tests / dependency injection).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="catalog">The curated link catalog (defaults to <see cref="HelpLinkCatalog.Default"/>).</param>
    public HelpPage(ILocalizer localizer, IReadOnlyList<HelpLink>? catalog = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new HelpPageViewModel(localizer, catalog);

        Content = BuildLayout();

        _linksHost.SizeChanged += OnLinksHostSizeChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when a curated card requests navigation to an internal app route (web <c>Link to</c>).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>HelpPage</c>).</summary>
    public static string Slug => HelpRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(_title);

        _introPanel.Content = _intro;
        _intro.Foreground = DisplayTokens.TextSecondary;
        AutomationProperties.SetName(_introPanel, Slug);
        stack.Children.Add(_introPanel);

        AutomationProperties.SetName(_linksHost, HelpRegistration.RouteName);
        AutomationProperties.SetLandmarkType(_linksHost, AutomationLandmarkType.Navigation);
        stack.Children.Add(_linksHost);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from the view-model and layout events (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _linksHost.SizeChanged -= OnLinksHostSizeChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void OnLinksHostSizeChanged(object sender, SizeChangedEventArgs e) => LayoutCards(e.NewSize.Width);

    private void Render(HelpDisplay display)
    {
        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.DocumentTitle);
        _intro.Text = display.Intro;

        _linksHost.Children.Clear();

        if (display.State == HelpState.Empty || display.Links.Count == 0)
        {
            _cardsGrid = null;
            _cards.Clear();
            _emptyState.Message = _viewModel.EmptyMessage;
            _linksHost.Children.Add(_emptyState);
            return;
        }

        BuildCards(display.Links);
        if (_cardsGrid is not null)
        {
            _linksHost.Children.Add(_cardsGrid);
            LayoutCards(ActualWidth > 0 ? ActualWidth : _linksHost.ActualWidth);
        }
    }

    private void BuildCards(IReadOnlyList<HelpLinkItem> links)
    {
        _cards.Clear();
        _cardsGrid = new Grid { ColumnSpacing = Gutter, RowSpacing = Gutter };
        foreach (var link in links)
        {
            _cards.Add(BuildLinkCard(link));
        }

        _currentColumns = 0;
    }

    private void LayoutCards(double width)
    {
        if (_cardsGrid is null || _cards.Count == 0)
        {
            return;
        }

        int columns = width >= LargeBreakpoint ? 3 : width >= SmallBreakpoint ? 2 : 1;
        columns = Math.Min(columns, _cards.Count);

        if (columns == _currentColumns && _cardsGrid.Children.Count == _cards.Count)
        {
            return;
        }

        _currentColumns = columns;
        _cardsGrid.Children.Clear();
        _cardsGrid.ColumnDefinitions.Clear();
        _cardsGrid.RowDefinitions.Clear();

        for (int c = 0; c < columns; c++)
        {
            _cardsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(_cards.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            _cardsGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < _cards.Count; i++)
        {
            var card = _cards[i];
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            _cardsGrid.Children.Add(card);
        }
    }

    private TsGlassPanel BuildLinkCard(HelpLinkItem item)
    {
        var (background, ring, iconBrush) = AccentBrushes();

        var iconTile = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = background,
            BorderBrush = ring,
            BorderThickness = new Thickness(1),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Child = new FontIcon { Glyph = item.Glyph, FontSize = 18, Foreground = iconBrush },
        };
        AutomationProperties.SetAccessibilityView(iconTile, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = item.Title,
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };

        var arrow = new FontIcon
        {
            Glyph = "\uE72A", // ChevronRight (web ArrowRight)
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(arrow, AccessibilityView.Raw);

        var titleRow = new Grid { ColumnSpacing = 8 };
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(title, 0);
        Grid.SetColumn(arrow, 1);
        titleRow.Children.Add(title);
        titleRow.Children.Add(arrow);

        var description = new TextBlock
        {
            Text = item.Description,
            FontSize = 14,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 4, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(description, AccessibilityView.Raw);

        var textColumn = new StackPanel { VerticalAlignment = VerticalAlignment.Top };
        textColumn.Children.Add(titleRow);
        textColumn.Children.Add(description);

        var inner = new Grid { ColumnSpacing = 12 };
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(iconTile, 0);
        Grid.SetColumn(textColumn, 1);
        inner.Children.Add(iconTile);
        inner.Children.Add(textColumn);

        var route = item.Route;
        var link = new HyperlinkButton
        {
            Padding = new Thickness(16),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Top,
            Content = inner,
        };
        link.Click += (_, _) => RaiseNavigation(route);
        AutomationProperties.SetName(link, item.AutomationName);

        return new TsGlassPanel
        {
            Padding = new Thickness(0),
            Content = link,
        };
    }

    private void RaiseNavigation(string route) => NavigationRequested?.Invoke(this, route);

    private static (Brush Background, Brush Ring, Brush Icon) AccentBrushes()
    {
        // The cyan accent token (web bg-cyan-300/10 + ring-cyan-300/20 + text-cyan-300): a ~11% fill, a ~25% ring,
        // and the full-strength icon — all derived from the single themed accent token (no ad-hoc hex).
        Brush accent = ResolveAccent();
        if (accent is SolidColorBrush solid && solid.Color.A != 0)
        {
            Color c = solid.Color;
            return (
                new SolidColorBrush(Color.FromArgb(28, c.R, c.G, c.B)),
                new SolidColorBrush(Color.FromArgb(64, c.R, c.G, c.B)),
                new SolidColorBrush(c));
        }

        return (accent, accent, accent);
    }

    private static Brush ResolveAccent()
    {
        if (Application.Current?.Resources is { } res &&
            res.TryGetValue("TsChartSpeedBrush", out var value) &&
            value is Brush brush)
        {
            return brush;
        }

        return DisplayTokens.Accent;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new HelpPageAutomationPeer(this);

    private sealed class HelpPageAutomationPeer(HelpPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
