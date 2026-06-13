using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Sharing;

/// <summary>
/// The native WinUI 3 <c>SharedDrivePage</c> — a parity port of the chrome-less public web page
/// <c>web/src/features/sharing/pages/SharedDrivePage.tsx</c> (route <c>/s/:token</c>, nav name <c>SharedDrive</c>,
/// unauthenticated). It binds to a <see cref="SharedDrivePageViewModel"/> and renders the web report's three data
/// states: the centered loading spinner, the "Share Link Unavailable" expired view (web <c>error || !data</c>),
/// and — in the success state — the branded report (the logo header, the hero route map with its speed-coloured
/// polyline and green/red start-end circle markers, the title block, the seven conditional stat cards, the
/// vehicle badge, the elevation-profile area chart, the speed-profile line chart, the no-route-data fallback and
/// the footer). The view is a thin renderer: every branch, format, unit conversion and i18n decision happens in
/// the WinUI-free <see cref="SharedDrivePageProjection"/>; state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SharedDrivePage : ContentControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double ContentPadding = 32;
    private const double ContentMaxWidth = 896;  // web max-w-4xl
    private const double HeroMapHeight = 360;     // web h-[50vh]
    private const double ChartHeight = 200;       // web ChartContainer height={200}
    private const double PanelPadding = 16;
    private const double StatColumns = 4;         // web Grid cols md:4

    private const string StartColorHex = "#22c55e";  // web emerald start marker
    private const string EndColorHex = "#ef4444";     // web red end marker

    private readonly SharedDrivePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly Grid _root = new();
    private readonly TsSpinner _loadingHost = new()
    {
        Size = ControlSize.Large,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly StackPanel _expiredHost = new()
    {
        Spacing = 16,
        MaxWidth = 420,
        Padding = new Thickness(16),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly FontIcon _expiredIcon = new()
    {
        Glyph = SharedDrivePageRegistration.DistanceGlyph,
        FontSize = 32,
        Foreground = DisplayTokens.TextMuted,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private readonly Heading _expiredTitle = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Text _expiredDescription = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly HyperlinkButton _expiredHome = new() { HorizontalAlignment = HorizontalAlignment.Center };

    private readonly ScrollViewer _contentScroll = new()
    {
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        Visibility = Visibility.Collapsed,
    };

    private readonly StackPanel _contentStack = new() { Spacing = 0 };

    private TsMapControl? _map;
    private IReadOnlyList<GeoPoint>? _fitTrail;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer (no token bound).</summary>
    public SharedDrivePage()
        : this(string.Empty)
    {
    }

    /// <summary>Creates the page over the default empty feed + shell localizer for a route-supplied share token.</summary>
    /// <param name="token">The share token from the <c>/s/:token</c> route param.</param>
    public SharedDrivePage(string token)
        : this(EmptySharedDrivePageFeed.Instance, ShellLocalizer.Instance, token)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and token (used by tests / dependency injection).</summary>
    /// <param name="feed">The single-source shared-drive data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="token">The share token from the route.</param>
    public SharedDrivePage(ISharedDrivePageFeed feed, ILocalizer localizer, string token)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new SharedDrivePageViewModel(feed, localizer, token);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Background = DisplayTokens.Brush("TsColorBackgroundBrush");

        Content = BuildLayout();

        _expiredHome.Click += OnHomeClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the expired view's "Go to TeslaSync" home link is invoked (web <c>href="/"</c>).</summary>
    public event EventHandler? HomeRequested;

    /// <summary>The diagnostics surface slug (<c>SharedDrivePage</c>).</summary>
    public static string Slug => SharedDrivePageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public SharedDrivePageViewModel ViewModel => _viewModel;

    private Grid BuildLayout()
    {
        _expiredHost.Children.Add(BuildIconBadge());
        _expiredHost.Children.Add(_expiredTitle);
        _expiredHost.Children.Add(_expiredDescription);
        _expiredHost.Children.Add(_expiredHome);

        _contentScroll.Content = _contentStack;

        _root.Children.Add(_contentScroll);
        _root.Children.Add(_loadingHost);
        _root.Children.Add(_expiredHost);
        return _root;
    }

    private Border BuildIconBadge() => new()
    {
        Width = 64,
        Height = 64,
        CornerRadius = new CornerRadius(32),
        Background = DisplayTokens.Surface,
        HorizontalAlignment = HorizontalAlignment.Center,
        Child = _expiredIcon,
    };

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _expiredHome.Click -= OnHomeClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
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

    private void OnHomeClick(object sender, RoutedEventArgs e) => HomeRequested?.Invoke(this, EventArgs.Empty);

    private void Render(SharedDrivePageDisplay display)
    {
        AutomationProperties.SetName(this, display.AutomationName);

        _loadingHost.Visibility = Show(display.ShowLoading);

        _expiredHost.Visibility = Show(display.ShowExpired);
        _expiredTitle.Value = display.ExpiredTitle;
        _expiredDescription.Value = display.ExpiredDescription;
        _expiredHome.Content = new TextBlock { Text = display.ExpiredHomeLabel };
        AutomationProperties.SetName(_expiredHome, display.ExpiredHomeLabel);

        _contentScroll.Visibility = Show(display.ShowContent);
        if (display.ShowContent)
        {
            BuildContent(display);
        }
        else
        {
            _contentStack.Children.Clear();
            _map = null;
            _fitTrail = null;
        }
    }

    private void BuildContent(SharedDrivePageDisplay display)
    {
        _contentStack.Children.Clear();
        _map = null;
        _fitTrail = null;

        // web header: <header className="border-b"><Logo/> <span>Shared Drive Report</span></header>.
        _contentStack.Children.Add(BuildHeader(display));

        // web hero map: {mapPoints.length > 1 && <FadeIn><div className="h-[50vh]"><MapContainer/></div></FadeIn>}.
        if (display.ShowMap)
        {
            _contentStack.Children.Add(new TsFadeIn { Content = BuildHeroMap(display) });
        }

        _contentStack.Children.Add(BuildBody(display));
    }

    // ── Header (logo brand mark + "Shared Drive Report") ───────────────────────────────────────────────────
    private static Border BuildHeader(SharedDrivePageDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(BuildLogo());
        row.Children.Add(new Caption
        {
            Value = display.HeaderLabel,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return new Border
        {
            Padding = new Thickness(16),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Child = row,
        };
    }

    private static StackPanel BuildLogo()
    {
        var logo = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var mark = new FontIcon
        {
            Glyph = SharedDrivePageRegistration.EfficiencyGlyph,
            FontSize = 18,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(mark, AccessibilityView.Raw);
        logo.Children.Add(mark);

        logo.Children.Add(new PanelTitle
        {
            Value = "TeslaSync",
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(logo, "TeslaSync");
        return logo;
    }

    // ── Hero map (web MapContainer + Polyline + start/end CircleMarkers) ────────────────────────────────────
    private Border BuildHeroMap(SharedDrivePageDisplay display)
    {
        var map = new TsMapControl
        {
            MapStyle = MapStyleKind.Dark,     // web <MapTileLayer style="dark" />
            CenterLat = display.Center.Lat,
            CenterLng = display.Center.Lng,
            Zoom = display.Zoom,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        _map = map;

        // web <Polyline positions={mapPoints} color="var(--theme-primary)" weight={3} opacity={0.8} />.
        var line = new TsMapPolyline();
        line.SetPoints(display.Trail);
        line.SetStroke(DisplayTokens.Accent);
        map.AddOverlay(line);

        // web start (green) + end (red) <CircleMarker radius={6} />.
        if (display.StartMarker is { } start)
        {
            map.AddOverlay(new SharedDriveCircleMarker(DisplayPrimitives.HexBrush(StartColorHex), display.StartLabel)
            {
                Location = start,
            });
        }

        if (display.EndMarker is { } end)
        {
            map.AddOverlay(new SharedDriveCircleMarker(DisplayPrimitives.HexBrush(EndColorHex), display.EndLabel)
            {
                Location = end,
            });
        }

        map.SetHasGeometry(true);
        AutomationProperties.SetName(map, display.MapLabel);

        // web FitBounds: fit to the trail once the map has a measured size.
        _fitTrail = display.Trail;
        map.SizeChanged += (_, _) => TryFitBounds();
        map.Loaded += (_, _) => TryFitBounds();

        return new Border { Height = HeroMapHeight, Child = map };
    }

    private void TryFitBounds()
    {
        if (_map is not { } map || _fitTrail is not { Count: > 1 } trail)
        {
            return;
        }

        if (map.ActualWidth <= 0 || map.ActualHeight <= 0)
        {
            return;
        }

        map.FitBounds(trail);
        _fitTrail = null; // one-shot, so the viewer can pan/zoom freely afterwards (web parity)
    }

    // ── Body (web max-w-4xl centered column) ───────────────────────────────────────────────────────────────
    private static StackPanel BuildBody(SharedDrivePageDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = SectionSpacing,
            Padding = new Thickness(ContentPadding),
            MaxWidth = ContentMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        int delay = 0;

        column.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildTitleBlock(display) });
        delay += 50;

        column.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildStatGrid(display) });
        delay += 50;

        if (display.ShowVehicle)
        {
            column.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildVehicleBadge(display) });
            delay += 50;
        }

        if (display.ShowElevation)
        {
            column.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildElevationChart(display) });
            delay += 50;
        }

        if (display.ShowSpeed)
        {
            column.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildSpeedChart(display) });
            delay += 50;
        }

        if (display.ShowNoData)
        {
            column.Children.Add(BuildNoData(display));
        }

        column.Children.Add(new TsFadeIn { DelayMs = delay, Content = BuildFooter(display) });
        return column;
    }

    // ── Title block (title + description + date / route) ───────────────────────────────────────────────────
    private static StackPanel BuildTitleBlock(SharedDrivePageDisplay display)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new PageTitle { Value = display.Title });

        if (!string.IsNullOrEmpty(display.Description))
        {
            stack.Children.Add(new Text
            {
                Value = display.Description,
                Foreground = DisplayTokens.TextSecondary,
            });
        }

        var meta = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            Margin = new Thickness(0, 4, 0, 0),
        };
        if (!string.IsNullOrEmpty(display.DateText))
        {
            meta.Children.Add(new Caption { Value = display.DateText });
        }

        if (!string.IsNullOrEmpty(display.RouteText))
        {
            meta.Children.Add(new Caption { Value = display.RouteText });
        }

        if (meta.Children.Count > 0)
        {
            stack.Children.Add(meta);
        }

        return stack;
    }

    // ── Stat grid (web Grid of StatCard) ───────────────────────────────────────────────────────────────────
    private static Grid BuildStatGrid(SharedDrivePageDisplay display)
    {
        var cards = new List<FrameworkElement>();
        AddStat(cards, display.Distance);
        AddStat(cards, display.Duration);
        AddStat(cards, display.Efficiency);
        AddStat(cards, display.Battery);
        AddStat(cards, display.MaxSpeed);
        AddStat(cards, display.AvgSpeed);
        AddStat(cards, display.ElevationGain);
        return UniformGrid((int)StatColumns, 16, cards);
    }

    private static void AddStat(List<FrameworkElement> cards, SharedStatDisplay stat)
    {
        if (!stat.Visible)
        {
            return;
        }

        var card = new TsStatCard
        {
            Label = stat.Label,
            Value = stat.Value,
            Glyph = stat.Glyph,
        };
        AutomationProperties.SetName(card, $"{stat.Label}: {stat.Value}");
        cards.Add(card);
    }

    // ── Vehicle badge (web GlassPanel with Tesla {model} / {color}) ────────────────────────────────────────
    private static TsGlassPanel BuildVehicleBadge(SharedDrivePageDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var badge = new Border
        {
            Width = 32,
            Height = 32,
            CornerRadius = new CornerRadius(16),
            Background = DisplayTokens.Surface,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = SharedDrivePageRegistration.EfficiencyGlyph,
                FontSize = 16,
                Foreground = DisplayTokens.Accent,
            },
        };
        AutomationProperties.SetAccessibilityView(badge.Child, AccessibilityView.Raw);
        row.Children.Add(badge);

        var labels = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        labels.Children.Add(new Text { Value = display.VehicleTitle, Foreground = DisplayTokens.TextPrimary });
        if (!string.IsNullOrEmpty(display.VehicleColor))
        {
            labels.Children.Add(new Caption { Value = display.VehicleColor });
        }

        row.Children.Add(labels);

        var panel = new TsGlassPanel { Glow = GlassGlow.None, Padding = new Thickness(PanelPadding), Content = row };
        AutomationProperties.SetName(panel, $"{display.VehicleTitle}. {display.VehicleColor}");
        return panel;
    }

    // ── Elevation profile (web ChartContainer + AreaChart) ─────────────────────────────────────────────────
    private static TsChartContainer BuildElevationChart(SharedDrivePageDisplay display)
    {
        var chart = new TsAreaChart
        {
            Series = new List<ChartSeries>
            {
                new(display.ElevationTooltipLabel, display.ElevationData)
                {
                    Kind = ChartSeriesKind.Area,
                    ColorIndex = 0,
                    Unit = display.ElevationUnit,
                    Decimals = 0,
                },
            },
            ShowLegend = false,
            IncludeZero = false,
            MinHeight = ChartHeight,
        };

        return new TsChartContainer
        {
            Title = display.ElevationTitle,
            AccessibleSummary = display.ElevationAria,
            State = ChartState.Ready,
            Body = chart,
        };
    }

    // ── Speed profile (web ChartContainer + LineChart) ─────────────────────────────────────────────────────
    private static TsChartContainer BuildSpeedChart(SharedDrivePageDisplay display)
    {
        var chart = new TsLineChart
        {
            Series = new List<ChartSeries>
            {
                new(display.SpeedTooltipLabel, display.SpeedData)
                {
                    Kind = ChartSeriesKind.Line,
                    Role = ChartRole.Speed,
                    Unit = display.SpeedUnit,
                    Decimals = 0,
                },
            },
            ShowLegend = false,
            IncludeZero = false,
            MinHeight = ChartHeight,
        };

        return new TsChartContainer
        {
            Title = display.SpeedTitle,
            AccessibleSummary = display.SpeedAria,
            State = ChartState.Ready,
            Body = chart,
        };
    }

    // ── No-route fallback (web EmptyState inside GlassPanel) ────────────────────────────────────────────────
    private static TsGlassPanel BuildNoData(SharedDrivePageDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = SharedDrivePageRegistration.DistanceGlyph,
            Message = display.NoMapDataMessage,
            MinHeight = 160,
        };
        AutomationProperties.SetName(empty, display.NoMapDataMessage);
        return new TsGlassPanel { Glow = GlassGlow.None, Padding = new Thickness(ContentPadding), Content = empty };
    }

    // ── Footer (web footer text + learn-more link) ─────────────────────────────────────────────────────────
    private static StackPanel BuildFooter(SharedDrivePageDisplay display)
    {
        var footer = new StackPanel
        {
            Spacing = 4,
            Margin = new Thickness(0, 16, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        footer.Children.Add(new Caption
        {
            Value = display.FooterText,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var learnMore = new HyperlinkButton
        {
            Content = new TextBlock { Text = display.LearnMoreText },
            NavigateUri = new Uri("https://github.com/ev-dev-labs/teslasync"),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(learnMore, display.LearnMoreText);
        footer.Children.Add(learnMore);

        return footer;
    }

    private static Grid UniformGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = children.Count == 0 ? 0 : ((children.Count + columns - 1) / columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var element = children[i];
            Grid.SetColumn(element, i % columns);
            Grid.SetRow(element, i / columns);
            grid.Children.Add(element);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SharedDrivePageAutomationPeer(this);

    private sealed class SharedDrivePageAutomationPeer(SharedDrivePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override string GetClassNameCore() => nameof(SharedDrivePage);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}

/// <summary>
/// A fixed-pixel-radius circle marker pinned to a geographic coordinate — the native analogue of the web Leaflet
/// <c>CircleMarker</c> the shared-drive hero map uses for its green start and red end dots (a 12-px-radius coloured
/// circle, not a metre-radius geofence). It repositions itself on the map's overlay canvas on every projection
/// change and carries its endpoint label as its Narrator name + tooltip so the location is available to assistive
/// technology.
/// </summary>
internal sealed partial class SharedDriveCircleMarker : ContentControl, IMapOverlay
{
    private const double DiameterPx = 12; // web CircleMarker radius={6}

    private GeoPoint _location;

    /// <summary>Creates the marker over its fill brush and accessible endpoint name.</summary>
    /// <param name="fill">The dot fill brush (the web <c>fillColor</c>).</param>
    /// <param name="accessibleName">The Narrator name (the web endpoint label).</param>
    public SharedDriveCircleMarker(Brush fill, string accessibleName)
    {
        ArgumentNullException.ThrowIfNull(fill);

        IsTabStop = false;
        Width = DiameterPx;
        Height = DiameterPx;

        Content = new Ellipse
        {
            Width = DiameterPx,
            Height = DiameterPx,
            Fill = fill,
            Stroke = DisplayTokens.Surface,
            StrokeThickness = 2,
        };

        if (!string.IsNullOrEmpty(accessibleName))
        {
            AutomationProperties.SetName(this, accessibleName);
            ToolTipService.SetToolTip(this, accessibleName);
        }
    }

    /// <summary>The marker's geographic location.</summary>
    public GeoPoint Location
    {
        get => _location;
        set => _location = value;
    }

    /// <summary>Reposition against the current projection so the dot stays centred on its coordinate.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        var screen = projection.ToScreen(_location);
        Canvas.SetLeft(this, screen.X - (DiameterPx / 2));
        Canvas.SetTop(this, screen.Y - (DiameterPx / 2));
    }
}
