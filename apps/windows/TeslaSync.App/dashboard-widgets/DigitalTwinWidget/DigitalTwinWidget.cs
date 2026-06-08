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
using TeslaSync.App.Components.Vehicles;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Digital Twin dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/DigitalTwinWidget.tsx. It mirrors the web <c>WidgetShell</c> used with a
/// title (a skeleton while loading; otherwise the "🖥 Digital Twin" freshness header above the body): when a
/// vehicle resolves, the <see cref="TsVehicleTwin"/> visual over the conditional badge cluster (lock + windows
/// always, then driving / charging / sentry / lights / hazards / doors-open / frunk / trunk when reported) plus
/// the display-name / VIN caption; when no vehicle resolves, the friendly "No vehicle data" empty state (the web
/// <c>{vehicle ? … : &lt;EmptyState&gt;}</c> gate); and a retry surface only when every read fails hard. All data
/// flows through the shared <see cref="DigitalTwinViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DigitalTwinWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string OpenGlyph = "\uE8A7";    // Segoe Fluent — OpenInNewWindow

    private readonly DigitalTwinViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DigitalTwinDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly HyperlinkButton _open = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network twin source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public DigitalTwinWidget(
        IDigitalTwinSource source,
        ILocalizer localizer,
        DigitalTwinSize size,
        DigitalTwinDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DigitalTwinDiagnostics();
        _viewModel = new DigitalTwinViewModel(source, localizer, size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the user activates the "Open" affordance; the dashboard host deep-links to the page.</summary>
    public event EventHandler? OpenRequested;

    /// <summary>The canonical registry id this surface registers under (<c>vehicle-twin</c>).</summary>
    public static string RegistryId => DigitalTwinRegistration.Id;

    /// <summary>The widget footprint (registry metadata; only the twin glyph size depends on it).</summary>
    public DigitalTwinSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DigitalTwinSource"/> from the shared data
    /// layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static DigitalTwinWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DigitalTwinSize? size = null,
        long? vehicleId = null,
        DigitalTwinDiagnostics? diagnostics = null)
    {
        var source = new DigitalTwinSource(vehicles, api, engine, options, vehicleId);
        return new DigitalTwinWidget(source, localizer, size ?? DigitalTwinRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = DigitalTwinProjection.MonitorGlyph,
            FontSize = 14,
            Foreground = AccentBrush(),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.Text = _viewModel.Title;
        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.digitalTwin.refresh", "Refresh vehicle state"));
        _refresh.Click += OnRefreshClick;

        BuildOpenAffordance();

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);
        actions.Children.Add(_open);

        _header.Padding = new Thickness(16, 12, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(16, 4, 16, 12);
        _bodyHost.VerticalContentAlignment = VerticalAlignment.Center;

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
    }

    private void BuildOpenAffordance()
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(new TextBlock { Text = _viewModel.OpenLabel, FontSize = 11, VerticalAlignment = VerticalAlignment.Center });
        var glyph = new FontIcon { Glyph = OpenGlyph, FontSize = 11, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        content.Children.Add(glyph);

        _open.Content = content;
        _open.Padding = new Thickness(4, 0, 4, 0);
        _open.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_open, $"{_viewModel.OpenLabel} {_viewModel.Title}");
        _open.Click += OnOpenClick;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnOpenClick(object sender, RoutedEventArgs e) => OpenRequested?.Invoke(this, EventArgs.Empty);

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        switch (_viewModel.State)
        {
            case DigitalTwinState.Loading:
                Content = BuildLoading();
                break;

            case DigitalTwinState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _titleText.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { } display)
        {
            // Web parity: no resolved vehicle renders the "No vehicle data" surface.
            return BuildEmpty();
        }

        return BuildTwin(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 96 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 160 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.digitalTwin.loading", "Loading vehicle state"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.digitalTwin.error", "Couldn't load vehicle state"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DigitalTwinProjection.MonitorGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Twin body (web vehicle branch: VehicleTwin + badge cluster + caption) ──
    private static StackPanel BuildTwin(DigitalTwinDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var twin = new TsVehicleTwin { HorizontalAlignment = HorizontalAlignment.Center };
        twin.SetModel(display.Model);
        column.Children.Add(twin);

        if (display.Badges.Count > 0)
        {
            column.Children.Add(BuildBadgeCluster(display.Badges));
        }

        if (!string.IsNullOrWhiteSpace(display.Caption))
        {
            column.Children.Add(new TextBlock
            {
                Text = display.Caption,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // Web parity: <div className="flex flex-wrap gap-1.5 justify-center"> of conditional badges.
    private static BadgeWrapPanel BuildBadgeCluster(IReadOnlyList<DigitalTwinBadge> badges)
    {
        var wrap = new BadgeWrapPanel
        {
            HorizontalSpacing = 6,
            VerticalSpacing = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var badge in badges)
        {
            wrap.Children.Add(BuildBadge(badge));
        }

        return wrap;
    }

    private static TsBadge BuildBadge(DigitalTwinBadge badge)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (badge.Glyph is { } glyph)
        {
            var icon = new FontIcon { Glyph = glyph, FontSize = 10, VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            content.Children.Add(icon);
        }

        content.Children.Add(new TextBlock
        {
            Text = badge.Text,
            FontSize = 11,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var chip = new TsBadge
        {
            Status = badge.Variant,
            Dot = badge.Dot,
            Content = content,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(chip, badge.Text);
        return chip;
    }

    private static Brush AccentBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);

    /// <summary>
    /// A minimal flow panel that lays its chips out left-to-right and wraps to a new row when the available width
    /// is exceeded — the native analogue of the web badge cluster's <c>flex-wrap</c>.
    /// </summary>
    private sealed partial class BadgeWrapPanel : Panel
    {
        /// <summary>Horizontal gap between chips on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Windows.Foundation.Size MeasureOverride(Windows.Foundation.Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Windows.Foundation.Size(measuredWidth, totalHeight);
        }

        protected override Windows.Foundation.Size ArrangeOverride(Windows.Foundation.Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Windows.Foundation.Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
