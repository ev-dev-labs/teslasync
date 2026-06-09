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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Guard Mode dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/GuardModeWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on a hard failure, otherwise a Shield + "Guard Mode" freshness
/// header) and the component's compact / standard branch: at <c>cols ≤ 1</c> the body is the compact status
/// row (armed shield + Armed/Disarmed badge + an event-count badge); otherwise it is the full panel — a
/// status card (armed shield, Armed/Disarmed, the Sensitivity · Auto-panic line and an ON/OFF badge) above
/// the newest-first event feed (severity-iconed rows with acknowledgement subtitles, or a "No guard events"
/// empty row). When the response carries no guard configuration a friendly "No guard data" empty state is
/// shown (the web <c>{config ? … : &lt;EmptyState&gt;}</c> gate). All data flows through the shared
/// <see cref="GuardModeViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class GuardModeWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly GuardModeViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly GuardModeDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network guard source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (drives the compact / full branch and feed cap).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="clock">Injected clock for deterministic relative-time projection (defaults to now).</param>
    public GuardModeWidget(
        IGuardModeSource source,
        ILocalizer localizer,
        GuardModeSize size,
        GuardModeDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new GuardModeDiagnostics();
        _viewModel = new GuardModeViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>guard-mode</c>).</summary>
    public static string RegistryId => GuardModeRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new feed cap / branch.</summary>
    public GuardModeSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="GuardModeSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies).
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint; defaults to the registry default (2×4).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public static GuardModeWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        GuardModeSize? size = null,
        GuardModeDiagnostics? diagnostics = null,
        long? vehicleId = null)
    {
        var source = new GuardModeSource(vehicles, api, engine, options, vehicleId);
        return new GuardModeWidget(source, localizer, size ?? GuardModeRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var shield = new FontIcon
        {
            Glyph = GuardModeProjection.ShieldGlyph,
            FontSize = 14,
            Foreground = ArmedBrush(enabled: true),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(shield, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(shield);
        titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.guardMode.refresh", "Refresh guard"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(titleRow);
        header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 8);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(header);
        _root.Children.Add(_bodyHost);
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
            case GuardModeState.Loading:
                Content = BuildLoading();
                break;

            case GuardModeState.Error:
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
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { } display)
        {
            // Web parity: no guard configuration (config == null) renders the "No guard data" surface.
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 140 });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.guardMode.loading", "Loading guard"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.guardMode.error", "Couldn't load guard mode"),
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
        IconGlyph = GuardModeProjection.ShieldGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(GuardModeDisplay display)
    {
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(StatusIcon(display.Enabled, 16));
        left.Children.Add(BuildBadge(display.StatusLabel, display.Enabled ? "TsColorSuccessBrush" : null));

        var countBadge = BuildBadge(display.EventCountLabel, display.HasEvents ? "TsColorWarningBrush" : null);

        var grid = new Grid { MinHeight = 44, ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(countBadge, 1);
        grid.Children.Add(left);
        grid.Children.Add(countBadge);

        var column = new StackPanel { Spacing = 0 };
        column.Children.Add(grid);
        return column;
    }

    private StackPanel BuildStandard(GuardModeDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStatusCard(display));
        column.Children.Add(BuildFeed(display));
        return column;
    }

    private static Grid BuildStatusCard(GuardModeDisplay display)
    {
        var statusText = new TextBlock
        {
            Text = display.StatusLabel,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var subtitle = new TextBlock
        {
            Text = display.SubtitleLine,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(statusText);
        body.Children.Add(subtitle);

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(StatusIcon(display.Enabled, 20));
        left.Children.Add(body);

        var badge = BuildBadge(display.StatusBadgeLabel, display.Enabled ? "TsColorSuccessBrush" : null);

        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(badge, 1);
        grid.Children.Add(left);
        grid.Children.Add(badge);

        AutomationProperties.SetName(grid, display.StatusAutomationName);
        return grid;
    }

    private StackPanel BuildFeed(GuardModeDisplay display)
    {
        if (display.FeedItems.Count == 0)
        {
            return BuildFeedEmpty(_viewModel.NoEventsMessage);
        }

        var column = new StackPanel { Spacing = 2 };
        foreach (var item in display.FeedItems)
        {
            column.Children.Add(BuildFeedRow(item));
        }

        return column;
    }

    private static StackPanel BuildFeedEmpty(string message)
    {
        var column = new StackPanel
        {
            Spacing = 6,
            Padding = new Thickness(0, 16, 0, 16),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = GuardModeProjection.ShieldGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var text = new TextBlock
        {
            Text = message,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        column.Children.Add(icon);
        column.Children.Add(text);
        AutomationProperties.SetName(column, message);
        return column;
    }

    private static Grid BuildFeedRow(GuardModeFeedItem item)
    {
        var icon = new FontIcon
        {
            Glyph = item.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(item.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = item.Title,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        body.Children.Add(new TextBlock
        {
            Text = item.Subtitle,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var time = new TextBlock
        {
            Text = item.RelativeTime,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var grid = new Grid { ColumnSpacing = 10, Padding = new Thickness(2, 6, 2, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        Grid.SetColumn(time, 2);
        grid.Children.Add(icon);
        grid.Children.Add(body);
        grid.Children.Add(time);

        AutomationProperties.SetName(grid, item.AutomationName);
        return grid;
    }

    private static FontIcon StatusIcon(bool enabled, double size) => new()
    {
        Glyph = GuardModeProjection.ShieldGlyph,
        FontSize = size,
        Foreground = ArmedBrush(enabled),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Brush ArmedBrush(bool enabled) =>
        enabled ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.TextMuted;

    private static Border BuildBadge(string text, string? accentBrushKey)
    {
        Brush accent = accentBrushKey is null ? DisplayTokens.TextSecondary : DisplayTokens.Brush(accentBrushKey);
        Brush border = accentBrushKey is null ? DisplayTokens.Border : accent;

        var label = new TextBlock
        {
            Text = text,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var badge = new Border
        {
            Child = label,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            BorderBrush = border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(8, 2, 8, 2),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
