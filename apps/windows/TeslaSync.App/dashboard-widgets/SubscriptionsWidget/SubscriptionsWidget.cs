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
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Subscriptions dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/SubscriptionsWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a "Subscriptions" title + freshness header —
/// both hidden in the single-column compact footprint, exactly as the web passes <c>title</c>/<c>icon</c> =
/// undefined when <c>isCompact</c>) wrapping one of two bodies: the standard <c>WidgetDetailCard</c> list of
/// one label / value / Active|Expired badge row per subscription, or — in the compact footprint — the centred
/// active-count + "active" caption + next-expiry chip. Either body collapses to the single "No subscriptions"
/// empty state when nothing parsed. All data flows through the shared <see cref="SubscriptionsViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade and every row + the refresh
/// affordance carries a Narrator name.
/// </summary>
public sealed partial class SubscriptionsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly SubscriptionsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SubscriptionsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly FontIcon _icon;
    private readonly TextBlock _titleText = new();
    private readonly StackPanel _titleRow;
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network subscriptions source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public SubscriptionsWidget(
        ISubscriptionsSource source,
        ILocalizer localizer,
        SubscriptionsSize size,
        SubscriptionsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SubscriptionsDiagnostics();
        _viewModel = new SubscriptionsViewModel(source, localizer, size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _icon = new FontIcon
        {
            Glyph = SubscriptionsProjection.CardGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>subscriptions</c>).</summary>
    public static string RegistryId => SubscriptionsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public SubscriptionsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SubscriptionsSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SubscriptionsWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SubscriptionsSize? size = null,
        long? vehicleId = null,
        SubscriptionsDiagnostics? diagnostics = null)
    {
        var source = new SubscriptionsSource(vehicles, api, engine, options, vehicleId);
        return new SubscriptionsWidget(source, localizer, size ?? SubscriptionsRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(_icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.subscriptions.refresh", "Refresh subscriptions"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(_titleRow);
        header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

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
            case SubscriptionsState.Loading:
                Content = BuildLoading();
                break;

            case SubscriptionsState.Error:
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
        var display = _viewModel.Display;
        bool compact = display.IsCompact;

        // Web parity: the title + icon are hidden in the single-column compact footprint (the web passes
        // title/icon = undefined to WidgetShell), leaving only the freshness chip in the top-right corner.
        _icon.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = compact ? string.Empty : _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);

        // The compact summary and the empty state centre vertically; the standard list flows from the top.
        _bodyHost.VerticalContentAlignment = compact || !display.HasSubscriptions
            ? VerticalAlignment.Center
            : VerticalAlignment.Top;

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasSubscriptions)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    // ── Compact summary (web isCompact branch: active count + next expiry) ──
    private StackPanel BuildCompact(SubscriptionsDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = SubscriptionsProjection.CardGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        column.Children.Add(glyph);

        column.Children.Add(new TextBlock
        {
            Text = display.ActiveCount.ToString(CultureInfo.CurrentCulture),
            FontSize = 24,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(new TextBlock
        {
            Text = _viewModel.ActiveCountLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        if (display.NextExpiryText is { Length: > 0 } expiry)
        {
            var badge = new TsBadge
            {
                Status = StatusKind.Neutral,
                Content = expiry,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
            column.Children.Add(badge);
        }

        AutomationProperties.SetName(column, display.CompactAccessibilityName);
        return column;
    }

    // ── Standard list (web WidgetDetailCard: one row per subscription) ──
    private static StackPanel BuildStandard(SubscriptionsDisplay display)
    {
        var column = new StackPanel();
        for (int i = 0; i < display.Entries.Count; i++)
        {
            column.Children.Add(BuildRow(display.Entries[i], last: i == display.Entries.Count - 1));
        }

        return column;
    }

    private static Border BuildRow(SubscriptionEntry entry, bool last)
    {
        var label = new TextBlock
        {
            Text = entry.Label.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 40,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var value = new TextBlock
        {
            Text = entry.Value,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var badge = new TsBadge
        {
            Status = entry.Active ? StatusKind.Success : StatusKind.Danger,
            Content = entry.BadgeText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);

        var right = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        right.Children.Add(value);
        right.Children.Add(badge);

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(label);
        grid.Children.Add(right);

        var container = new Border
        {
            Child = grid,
            Padding = new Thickness(4, 8, 4, 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = last ? new Thickness(0) : new Thickness(0, 0, 0, 1),
            MinHeight = 40,
        };
        AutomationProperties.SetName(container, entry.AccessibilityName);
        return container;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 120 });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.subscriptions.loading", "Loading subscriptions"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.subscriptions.error", "Couldn't load subscriptions"),
            ActionText = _localizer.GetString("widget.subscriptions.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = SubscriptionsProjection.CardGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
