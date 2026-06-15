using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.UI;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>RoadmapPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/RoadmapPage.tsx</c> (the public product roadmap, routed at <c>/roadmap</c>).
/// It binds to a <see cref="RoadmapPageViewModel"/> and renders every web region with Fluent components and
/// design tokens: the page header (web <c>PageContainer title/subtitle</c> + <c>usePageTitle</c> →
/// <c>roadmap.title</c> / <c>roadmap.subtitle</c>), the always-visible phase progress bar (GlassPanel1 — the four
/// phase chips with a coloured dot, the localized phase label and a count badge) and the per-phase card sections
/// whose cards (GlassPanel2) each carry an accent icon tile, the title + one-line description, a phase chip and
/// the capability bullet list with phase-keyed leading glyphs. The view is a thin renderer: all branch selection,
/// grouping, formatting and i18n happen in the view-model's <see cref="RoadmapDisplay"/> projection. State
/// changes are marshalled onto the UI thread; the progress bar is always visible and the card region falls back
/// to a friendly empty surface (never a blank box).
/// </summary>
public sealed partial class RoadmapPage : UserControl, IDisposable
{
    private const double TwoColumnBreakpoint = 1024; // web lg: → 2 columns
    private const double Gutter = 16;                 // web gap-4
    private const byte TileAlpha = 0x21;              // web colour at ~13% fill (style backgroundColor `${color}15`)

    private readonly RoadmapPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _opened;

    private readonly TsPageHeader _header = new();

    private readonly TsGlassPanel _progressPanel = new() { Padding = new Thickness(16) };
    private readonly StackPanel _progressRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 12,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _sectionsHost = new() { Spacing = 24 };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE8A7" };

    private readonly List<PhaseGridLayout> _grids = [];

    /// <summary>Creates the page over the shell resource localizer and the default curated catalog.</summary>
    public RoadmapPage()
        : this(ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit localizer (used by tests / dependency injection).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="catalog">The curated roadmap catalog (defaults to <see cref="RoadmapCatalog.Default"/>).</param>
    public RoadmapPage(ILocalizer localizer, IReadOnlyList<RoadmapEntry>? catalog = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new RoadmapPageViewModel(localizer, catalog);

        Content = BuildLayout();

        _sectionsHost.SizeChanged += OnSectionsHostSizeChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>RoadmapPage</c>).</summary>
    public static string Slug => RoadmapRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(_header);

        var progressScroll = new ScrollViewer
        {
            Content = _progressRow,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
        };
        _progressPanel.Content = progressScroll;
        AutomationProperties.SetName(_progressPanel, Slug);
        stack.Children.Add(_progressPanel);

        AutomationProperties.SetName(_sectionsHost, RoadmapRegistration.RouteName);
        stack.Children.Add(_sectionsHost);

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
        _sectionsHost.SizeChanged -= OnSectionsHostSizeChanged;
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

    private void OnSectionsHostSizeChanged(object sender, SizeChangedEventArgs e) => LayoutGrids(e.NewSize.Width);

    private void Render(RoadmapDisplay display)
    {
        _header.Title = display.Title;
        _header.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.DocumentTitle);

        BuildProgressRow(display.PhaseSummaries);

        _sectionsHost.Children.Clear();
        _grids.Clear();

        if (display.State == RoadmapState.Empty || display.Groups.Count == 0)
        {
            _emptyState.Message = _viewModel.EmptyMessage;
            _sectionsHost.Children.Add(_emptyState);
            return;
        }

        foreach (var group in display.Groups)
        {
            _sectionsHost.Children.Add(BuildSection(group));
        }

        LayoutGrids(ActualWidth > 0 ? ActualWidth : _sectionsHost.ActualWidth);
    }

    private void BuildProgressRow(IReadOnlyList<RoadmapPhaseSummary> summaries)
    {
        _progressRow.Children.Clear();

        for (int i = 0; i < summaries.Count; i++)
        {
            _progressRow.Children.Add(BuildPhaseChip(summaries[i]));

            if (i < summaries.Count - 1)
            {
                _progressRow.Children.Add(new Border
                {
                    Width = 32,
                    Height = 1,
                    Background = DisplayTokens.Border,
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }
        }
    }

    private static StackPanel BuildPhaseChip(RoadmapPhaseSummary summary)
    {
        var accent = ResolveAccent(summary.AccentBrushKey);

        var dot = new Border
        {
            Width = 10,
            Height = 10,
            CornerRadius = new CornerRadius(5),
            Background = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = summary.Label,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var count = new TsBadge
        {
            Status = summary.BadgeStatus,
            Content = summary.Count.ToString(CultureInfo.CurrentCulture),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var chip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        chip.Children.Add(dot);
        chip.Children.Add(label);
        chip.Children.Add(count);

        AutomationProperties.SetName(chip, $"{summary.Label}: {summary.Count}");
        return chip;
    }

    private TsFadeIn BuildSection(RoadmapPhaseGroup group)
    {
        var accent = ResolveAccent(group.AccentBrushKey);

        var headerIcon = new FontIcon { Glyph = group.HeaderGlyph, FontSize = 18, Foreground = accent };
        AutomationProperties.SetAccessibilityView(headerIcon, AccessibilityView.Raw);

        var headerText = new TextBlock
        {
            Text = group.Label,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetHeadingLevel(headerText, AutomationHeadingLevel.Level2);

        var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        headerRow.Children.Add(headerIcon);
        headerRow.Children.Add(headerText);

        var grid = new Grid { ColumnSpacing = Gutter, RowSpacing = Gutter };
        var cards = new List<FrameworkElement>(group.Items.Count);
        foreach (var item in group.Items)
        {
            cards.Add(BuildCard(item));
        }

        _grids.Add(new PhaseGridLayout(grid, cards));

        var section = new StackPanel { Spacing = 16 };
        section.Children.Add(headerRow);
        section.Children.Add(grid);

        return new TsFadeIn { Content = section };
    }

    private static TsGlassPanel BuildCard(RoadmapItem item)
    {
        var accent = ResolveAccent(item.AccentBrushKey);
        var (tileBackground, tileIcon) = AccentTile(item.AccentBrushKey);

        var iconTile = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = tileBackground,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Child = new FontIcon { Glyph = item.Glyph, FontSize = 18, Foreground = tileIcon },
        };
        AutomationProperties.SetAccessibilityView(iconTile, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = item.Title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };

        var description = new TextBlock
        {
            Text = item.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(description, AccessibilityView.Raw);

        var textColumn = new StackPanel { VerticalAlignment = VerticalAlignment.Top };
        textColumn.Children.Add(title);
        textColumn.Children.Add(description);

        var identity = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Top,
        };
        identity.Children.Add(iconTile);
        identity.Children.Add(textColumn);

        var badge = new TsBadge
        {
            Status = item.BadgeStatus,
            Content = item.PhaseLabel,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(identity, 0);
        Grid.SetColumn(badge, 1);
        headerRow.Children.Add(identity);
        headerRow.Children.Add(badge);

        var bulletBrush = BulletBrush(item.Phase, accent);
        var features = new StackPanel { Spacing = 6, Margin = new Thickness(0, 16, 0, 0) };
        foreach (var feature in item.Features)
        {
            features.Children.Add(BuildFeatureRow(feature, bulletBrush));
        }

        var inner = new StackPanel { Spacing = 0 };
        inner.Children.Add(headerRow);
        inner.Children.Add(features);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = inner,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(panel, item.AutomationName);
        return panel;
    }

    private static StackPanel BuildFeatureRow(RoadmapFeature feature, Brush bulletBrush)
    {
        var bullet = new FontIcon
        {
            Glyph = feature.BulletGlyph,
            FontSize = 13,
            Foreground = bulletBrush,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(bullet, AccessibilityView.Raw);

        var text = new TextBlock
        {
            Text = feature.Text,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(bullet);
        row.Children.Add(text);
        return row;
    }

    private void LayoutGrids(double width)
    {
        foreach (var layout in _grids)
        {
            LayoutPhaseGrid(layout, width);
        }
    }

    private static void LayoutPhaseGrid(PhaseGridLayout layout, double width)
    {
        if (layout.Cards.Count == 0)
        {
            return;
        }

        // web: grid-cols-1 for a single card, otherwise grid-cols-1 lg:grid-cols-2.
        int columns = layout.Cards.Count <= 1 ? 1 : (width >= TwoColumnBreakpoint ? 2 : 1);

        if (columns == layout.CurrentColumns && layout.Grid.Children.Count == layout.Cards.Count)
        {
            return;
        }

        layout.CurrentColumns = columns;
        var grid = layout.Grid;
        grid.Children.Clear();
        grid.ColumnDefinitions.Clear();
        grid.RowDefinitions.Clear();

        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(layout.Cards.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < layout.Cards.Count; i++)
        {
            var card = layout.Cards[i];
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            grid.Children.Add(card);
        }
    }

    private static Brush BulletBrush(RoadmapPhase phase, Brush accent) =>
        phase is RoadmapPhase.Done or RoadmapPhase.Current ? accent : DisplayTokens.TextMuted;

    private static (Brush Background, Brush Icon) AccentTile(string key)
    {
        // web icon tile: a translucent fill of the phase colour with the full-strength icon (style
        // backgroundColor `${color}15`; icon color `color`) — derived from the single themed accent token so
        // light/dark/high-contrast flow from W1, never an ad-hoc hex.
        Brush accent = ResolveAccent(key);
        if (accent is SolidColorBrush solid && solid.Color.A != 0)
        {
            Color c = solid.Color;
            return (new SolidColorBrush(Color.FromArgb(TileAlpha, c.R, c.G, c.B)), new SolidColorBrush(c));
        }

        return (accent, accent);
    }

    private static Brush ResolveAccent(string key) => DisplayTokens.Brush(key);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RoadmapPageAutomationPeer(this);

    private sealed class PhaseGridLayout(Grid grid, IReadOnlyList<FrameworkElement> cards)
    {
        public Grid Grid { get; } = grid;

        public IReadOnlyList<FrameworkElement> Cards { get; } = cards;

        public int CurrentColumns { get; set; }
    }

    private sealed class RoadmapPageAutomationPeer(RoadmapPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
