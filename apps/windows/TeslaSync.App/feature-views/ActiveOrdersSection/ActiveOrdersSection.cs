using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 active-orders surface — a parity port of
/// web/src/features/settings/components/ActiveOrdersSection.tsx. It composes the web's single
/// <c>GlassPanel</c>: a header (a ShoppingCart icon tile, the title, the subtitle, the "Synced {when}" caption
/// and a Refresh button) above a body that renders one card per Tesla order the backend reports under
/// <c>GET /tesla/user/orders</c> — each card carrying the model name, an order-status badge, the order id, the
/// optional VIN and delivery date, and an optional "Upgradable" chip. Every state renders — a loading
/// skeleton, populated cards, the friendly empty text (the "no active orders" vs. "no data yet" copy chosen
/// from the envelope's fetch time), an explicit retry surface on hard failure, plus stale and offline
/// freshness chips. The Refresh button runs the mutation and surfaces a localized success/failure toast
/// (forwarded to the host sink and announced for accessibility). All data flows through the shared
/// <see cref="ActiveOrdersSectionViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ActiveOrdersSection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent — Refresh
    private const string CartGlyph = "\uE7BF";      // Segoe Fluent — Shopping cart (web lucide ShoppingCart)
    private const string PackageGlyph = "\uE7B8";   // Segoe Fluent — Package (web lucide Package)
    private const string CalendarGlyph = "\uE787";  // Segoe Fluent — Calendar (web lucide Calendar)
    private const string EmptyGlyph = "\uE946";     // Segoe Fluent — Info (web lucide Info)

    private const double PanelPadding = 20;          // web GlassPanel p-6
    private const double SectionSpacing = 16;        // web space-y-4 between header and body
    private const double CardSpacing = 16;           // web gap-4 between cards
    private const int GridColumns = 2;               // web grid-cols-1 sm:grid-cols-2

    private readonly ActiveOrdersSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ActiveOrdersSectionDiagnostics _diagnostics;
    private readonly Action<ActiveOrdersToast>? _toastSink;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 8 };
    private readonly Grid _panelHost = new();
    private readonly TsFadeIn _fade = new() { DelayMs = 45 };   // web FadeIn delay={0.045}

    private readonly TextBlock _toastBanner = new()
    {
        FontSize = 12,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
        Margin = new Thickness(0, 4, 0, 0),
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, diagnostics and (optional) toast sink.</summary>
    public ActiveOrdersSection(
        IActiveOrdersSource source,
        ILocalizer localizer,
        ActiveOrdersSectionDiagnostics? diagnostics = null,
        Action<ActiveOrdersToast>? toastSink = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ActiveOrdersSectionDiagnostics();
        _toastSink = toastSink;
        _viewModel = new ActiveOrdersSectionViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, ActiveOrdersSectionRegistration.Title(localizer));

        LiveRegion.Configure(_toastBanner, assertive: true);
        _fade.Content = _panelHost;
        _root.Children.Add(_fade);
        _root.Children.Add(_toastBanner);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>active-orders-section</c>).</summary>
    public static string SurfaceId => ActiveOrdersSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public ActiveOrdersSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ActiveOrdersSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static ActiveOrdersSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ActiveOrdersSectionDiagnostics? diagnostics = null,
        Action<ActiveOrdersToast>? toastSink = null)
    {
        var source = new ActiveOrdersSource(api, engine, options);
        return new ActiveOrdersSection(source, localizer, diagnostics, toastSink);
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
        _viewModel.ToastRequested -= OnToastRequested;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnToastRequested(object? sender, ActiveOrdersToast toast)
    {
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(() => ApplyToast(toast));
        }
        else
        {
            ApplyToast(toast);
        }
    }

    private void ApplyToast(ActiveOrdersToast toast)
    {
        _toastSink?.Invoke(toast);

        string text = string.IsNullOrEmpty(toast.Description)
            ? toast.Title
            : string.Concat(toast.Title, " \u2014 ", toast.Description);
        _toastBanner.Text = text;
        _toastBanner.Foreground = DisplayTokens.Brush(
            toast.Kind == ActiveOrdersToastKind.Error ? "TsColorDangerBrush" : "TsColorSuccessBrush");
        _toastBanner.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_toastBanner, text);
        LiveRegion.Announce(_toastBanner);
    }

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
        _panelHost.Children.Clear();
        _panelHost.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader());
        column.Children.Add(BuildBody());

        return new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = column,
        };
    }

    // ── Header ───────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Top };
        heading.Children.Add(new PanelTitle { Value = _viewModel.Title });
        heading.Children.Add(new Text
        {
            Value = _viewModel.Subtitle,
            Foreground = DisplayTokens.TextMuted,
            MaxWidth = 520,
            HorizontalAlignment = HorizontalAlignment.Left,
        });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Top,
        };
        titleRow.Children.Add(BuildIconTile());
        titleRow.Children.Add(heading);

        var controls = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        if (_viewModel.LastSyncedLabel is { } synced)
        {
            controls.Children.Add(new Caption
            {
                Value = synced,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        controls.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        });
        controls.Children.Add(BuildRefreshButton());

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(controls, 1);
        grid.Children.Add(titleRow);
        grid.Children.Add(controls);
        return grid;
    }

    private static Border BuildIconTile()
    {
        var icon = new FontIcon
        {
            Glyph = CartGlyph,
            FontSize = 18,
            Foreground = DisplayTokens.Accent,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = icon,
            VerticalAlignment = VerticalAlignment.Top,
        };
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.RefreshLabel,
            IconGlyph = RefreshGlyph,
            IsLoading = _viewModel.IsRefreshing,
            IsEnabled = !_viewModel.IsFetching,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        button.Click += OnRefresh;
        return button;
    }

    private void OnRefresh(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshAsync();

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Body (state switch) ──────────────────────────────────────────────────────────────────────────

    private FrameworkElement BuildBody() => _viewModel.State switch
    {
        ActiveOrdersState.Loading => BuildLoading(),
        ActiveOrdersState.Error => BuildError(),
        ActiveOrdersState.Empty => BuildEmpty(),
        _ => _viewModel.Display.HasOrders ? BuildGrid() : BuildEmpty(),
    };

    private Grid BuildGrid()
    {
        var display = _viewModel.Display;
        var grid = new Grid { ColumnSpacing = CardSpacing, RowSpacing = CardSpacing };
        AutomationProperties.SetName(grid, _viewModel.Title);

        for (int c = 0; c < GridColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rowCount = (display.Cards.Count + GridColumns - 1) / GridColumns;
        for (int r = 0; r < rowCount; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Cards.Count; i++)
        {
            var card = BuildCard(display, display.Cards[i]);
            Grid.SetColumn(card, i % GridColumns);
            Grid.SetRow(card, i / GridColumns);
            grid.Children.Add(card);
        }

        return grid;
    }

    private static Border BuildCard(ActiveOrdersDisplay display, OrderCardDisplay card)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildCardHeader(card));
        content.Children.Add(BuildCardDetails(display, card));

        var border = new Border
        {
            CornerRadius = new CornerRadius(8),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(16),
            Child = content,
        };
        AutomationProperties.SetName(border, card.AutomationName);
        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Content);
        return border;
    }

    private static Grid BuildCardHeader(OrderCardDisplay card)
    {
        var modelRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var package = new FontIcon
        {
            Glyph = PackageGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(package, AccessibilityView.Raw);
        modelRow.Children.Add(package);
        modelRow.Children.Add(new TextBlock
        {
            Text = card.ModelText,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        var badge = new TsBadge
        {
            Status = card.StatusKind,
            Content = new TextBlock { Text = card.StatusLabel, FontSize = 12 },
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, card.StatusLabel);

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(modelRow, 0);
        Grid.SetColumn(badge, 1);
        grid.Children.Add(modelRow);
        grid.Children.Add(badge);
        return grid;
    }

    private static Grid BuildCardDetails(ActiveOrdersDisplay display, OrderCardDisplay card)
    {
        var details = new Grid { RowSpacing = 6 };
        details.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        details.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        int row = 0;
        AddKeyValueRow(details, ref row, display.OrderIdLabel, new Code { Value = card.OrderIdValue });

        if (card.ShowVin)
        {
            AddKeyValueRow(details, ref row, display.VinLabel, new Code { Value = card.VinValue });
        }

        if (card.ShowDeliveryDate)
        {
            AddKeyValueRow(details, ref row, display.DeliveryDateLabel, BuildDeliveryValue(card.DeliveryDateValue));
        }

        if (card.ShowUpgradable)
        {
            details.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var chip = new TsBadge
            {
                Status = StatusKind.Info,
                Content = new TextBlock { Text = display.UpgradableLabel, FontSize = 12 },
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            AutomationProperties.SetName(chip, display.UpgradableLabel);
            Grid.SetRow(chip, row);
            Grid.SetColumn(chip, 1);
            details.Children.Add(chip);
            row++;
        }

        return details;
    }

    private static StackPanel BuildDeliveryValue(string value)
    {
        var stack = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var calendar = new FontIcon
        {
            Glyph = CalendarGlyph,
            FontSize = 12,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(calendar, AccessibilityView.Raw);
        stack.Children.Add(calendar);
        stack.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 12,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return stack;
    }

    private static void AddKeyValueRow(Grid grid, ref int row, string label, FrameworkElement value)
    {
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var key = new Caption
        {
            Value = label,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetRow(key, row);
        Grid.SetColumn(key, 0);
        grid.Children.Add(key);

        value.HorizontalAlignment = HorizontalAlignment.Right;
        value.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetRow(value, row);
        Grid.SetColumn(value, 1);
        grid.Children.Add(value);

        row++;
    }

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = CardSpacing, Padding = new Thickness(0, 4, 0, 0) };

        var grid = new Grid { ColumnSpacing = CardSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (int i = 0; i < GridColumns; i++)
        {
            var skeleton = new TsSkeleton
            {
                BlockHeight = 120,
                Radius = 8,
                ReduceMotion = MotionPreference.ReduceMotion,
            };
            Grid.SetColumn(skeleton, i);
            grid.Children.Add(skeleton);
        }

        stack.Children.Add(grid);
        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorMessageDefault,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = EmptyGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };
}
