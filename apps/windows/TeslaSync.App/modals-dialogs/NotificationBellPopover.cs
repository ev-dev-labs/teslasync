using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 notification-bell popover surface — a parity port of
/// web/src/components/layout/NotificationBellPopover.tsx. It composes the header bell the web source owns: an
/// icon trigger button carrying the unread-count badge, and a light-dismiss <see cref="Flyout"/> in-place
/// triage panel with a header (title + count-aware subtitle + close), a body that renders exactly one of the
/// skeleton, the retriable error surface, the friendly empty state, or the unread-preview list (each row a
/// severity dot, title, message, relative time and vehicle name), and a footer with the mark-all-read and
/// "View all" actions. On a compact viewport the trigger deep-links to the full inbox instead of opening the
/// flyout (the web mobile fallback). All data flows through the shared
/// <see cref="NotificationBellPopoverViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name; the flyout supplies the WAI-ARIA
/// dialog dismiss/focus semantics (Escape, click-outside, focus return to the trigger).
/// </summary>
public sealed partial class NotificationBellPopover : ContentControl, IDisposable
{
    private const int PopoverWidth = 360;
    private const double TitleFontSize = 13;
    private const double SubtitleFontSize = 11;
    private const double RowTitleFontSize = 14;
    private const double RowMessageFontSize = 13;
    private const double MetaFontSize = 11;
    private const double CompactWidthThreshold = 640;

    private readonly NotificationBellPopoverViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly NotificationBellDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _trigger = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Medium };
    private readonly Border _badge = new();
    private readonly TextBlock _badgeText = new()
    {
        FontSize = 10,
        FontWeight = FontWeights.Bold,
        Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Flyout _flyout = new();
    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = FontWeights.SemiBold,
        Foreground = DisplayTokens.TextPrimary,
    };

    private readonly TextBlock _subtitle = new() { FontSize = SubtitleFontSize, Foreground = DisplayTokens.TextMuted };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _close = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small };
    private readonly TsButton _markAllRead = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _viewAll = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly ContentControl _bodyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its read source, command port, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network bell read source.</param>
    /// <param name="commands">The bell mutation command port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock so relative timestamps are deterministic in tests.</param>
    public NotificationBellPopover(
        INotificationBellSource source,
        INotificationBellCommands commands,
        ILocalizer localizer,
        NotificationBellDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(commands);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new NotificationBellDiagnostics();
        _viewModel = new NotificationBellPopoverViewModel(source, commands, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Top;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.NavigateRequested += OnViewModelNavigateRequested;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the bell wants the host to navigate (compact trigger, row click, "View all").</summary>
    public event EventHandler<NotificationBellNavigationEventArgs>? NavigateRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>NotificationBellPopover</c>).</summary>
    public static string Slug => NotificationBellRegistration.Slug;

    /// <summary>The backing state holder (exposed for host wiring and tests).</summary>
    public NotificationBellPopoverViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="NotificationBellSource"/> +
    /// <see cref="NotificationBellCommands"/> from the shared data layer.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    public static NotificationBellPopover Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        NotificationBellDiagnostics? diagnostics = null)
    {
        var source = new NotificationBellSource(api, engine, options);
        var commands = new NotificationBellCommands(api);
        return new NotificationBellPopover(source, commands, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _trigger.IconGlyph = NotificationBellRegistration.BellGlyph;
        _trigger.Click += OnTriggerClick;

        _badge.CornerRadius = new CornerRadius(8);
        _badge.Background = DisplayTokens.Brush("TsColorDangerBrush");
        _badge.MinWidth = 16;
        _badge.Height = 16;
        _badge.Padding = new Thickness(4, 0, 4, 0);
        _badge.HorizontalAlignment = HorizontalAlignment.Right;
        _badge.VerticalAlignment = VerticalAlignment.Top;
        _badge.Margin = new Thickness(0, -2, -2, 0);
        _badge.IsHitTestVisible = false;
        _badge.Child = _badgeText;
        AutomationProperties.SetAccessibilityView(_badge, AccessibilityView.Raw);

        var triggerHost = new Grid();
        triggerHost.Children.Add(_trigger);
        triggerHost.Children.Add(_badge);

        _flyout.Placement = FlyoutPlacementMode.BottomEdgeAlignedRight;
        _flyout.FlyoutPresenterStyle = BuildPresenterStyle();
        _flyout.Content = BuildPanel();
        _flyout.Opened += OnFlyoutOpened;
        _flyout.Closed += OnFlyoutClosed;

        Content = triggerHost;
    }

    private static Style BuildPresenterStyle()
    {
        var style = new Style(typeof(FlyoutPresenter));
        style.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(0)));
        style.Setters.Add(new Setter(Control.BackgroundProperty, new SolidColorBrush(Microsoft.UI.Colors.Transparent)));
        style.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(0)));
        style.Setters.Add(new Setter(FrameworkElement.MaxWidthProperty, (double)(PopoverWidth + 8)));
        style.Setters.Add(new Setter(FrameworkElement.MinWidthProperty, (double)PopoverWidth));
        style.Setters.Add(new Setter(ScrollViewer.HorizontalScrollModeProperty, ScrollMode.Disabled));
        style.Setters.Add(new Setter(ScrollViewer.VerticalScrollModeProperty, ScrollMode.Disabled));
        return style;
    }

    private TsFadeIn BuildPanel()
    {
        var stack = new StackPanel { Width = PopoverWidth, Spacing = 0 };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildBodyScroller());
        stack.Children.Add(BuildFooter());

        var panel = new TsGlassPanel { Padding = new Thickness(0), Content = stack };
        return new TsFadeIn { Content = panel };
    }

    private Grid BuildHeader()
    {
        var header = new Grid { Padding = new Thickness(16, 12, 12, 12), ColumnSpacing = 8 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.BorderBrush = DisplayTokens.Border;
        header.BorderThickness = new Thickness(0, 0, 0, 1);

        var titles = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        header.Children.Add(titles);

        Grid.SetColumn(_freshness, 1);
        header.Children.Add(_freshness);

        _close.IconGlyph = NotificationBellRegistration.CloseGlyph;
        _close.Click += (_, _) => _flyout.Hide();
        Grid.SetColumn(_close, 2);
        header.Children.Add(_close);

        return header;
    }

    private ScrollViewer BuildBodyScroller() => new()
    {
        Content = _bodyHost,
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollMode = ScrollMode.Disabled,
        MaxHeight = 420,
        Padding = new Thickness(8),
    };

    private Grid BuildFooter()
    {
        var footer = new Grid { Padding = new Thickness(8, 6, 8, 8), ColumnSpacing = 8 };
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.BorderBrush = DisplayTokens.Border;
        footer.BorderThickness = new Thickness(0, 1, 0, 0);

        _markAllRead.IconGlyph = NotificationBellRegistration.MarkAllReadGlyph;
        _markAllRead.HorizontalAlignment = HorizontalAlignment.Left;
        _markAllRead.Click += (_, _) => _ = _viewModel.MarkAllReadAsync();
        Grid.SetColumn(_markAllRead, 0);
        footer.Children.Add(_markAllRead);

        _viewAll.IconGlyph = NotificationBellRegistration.ViewAllGlyph;
        _viewAll.HorizontalAlignment = HorizontalAlignment.Right;
        _viewAll.Click += (_, _) => _viewModel.NavigateToInbox();
        Grid.SetColumn(_viewAll, 1);
        footer.Children.Add(_viewAll);

        return footer;
    }

    private void OnTriggerClick(object sender, RoutedEventArgs e)
    {
        _viewModel.IsMobile = IsCompactViewport();
        if (_viewModel.OnTriggerInvoked() == NotificationBellTriggerAction.OpenPopover)
        {
            _flyout.ShowAt(_trigger);
        }
    }

    private bool IsCompactViewport()
    {
        double width = XamlRoot?.Size.Width ?? double.MaxValue;
        return width <= CompactWidthThreshold;
    }

    private void OnFlyoutOpened(object? sender, object e)
    {
        _diagnostics.RecordViewOpened();
        _ = _viewModel.OpenAsync();
    }

    private void OnFlyoutClosed(object? sender, object e) => _viewModel.Close();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _ = _viewModel.StartCountAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelNavigateRequested(object? sender, NotificationBellNavigationEventArgs e) =>
        NavigateRequested?.Invoke(this, e);

    private void OnViewModelCloseRequested(object? sender, EventArgs e) => _flyout.Hide();

    /// <summary>Detach from the view-model and cancel any in-flight loads (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.NavigateRequested -= OnViewModelNavigateRequested;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        NotificationBellLabels labels = _viewModel.Labels;
        NotificationBellDisplay display = _viewModel.Display;

        AutomationProperties.SetName(_trigger, _viewModel.TriggerLabel);
        _badge.Visibility = _viewModel.HasUnread ? Visibility.Visible : Visibility.Collapsed;
        _badgeText.Text = _viewModel.BadgeText;

        _title.Text = labels.Title;
        _subtitle.Text = display.Subtitle;
        AutomationProperties.SetName(_close, labels.Close);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _freshness.Visibility = _viewModel.State is NotificationBellState.Stale or NotificationBellState.Offline
            ? Visibility.Visible
            : Visibility.Collapsed;

        _markAllRead.Text = labels.MarkAllRead;
        _markAllRead.IsEnabled = display.MarkAllReadEnabled;
        _markAllRead.IsLoading = _viewModel.MarkAllReadPending;
        AutomationProperties.SetName(_markAllRead, labels.MarkAllRead);

        _viewAll.Text = labels.ViewAll;
        AutomationProperties.SetName(_viewAll, labels.ViewAll);

        _bodyHost.Content = BuildBody(display);
        AutomationProperties.SetName(this, display.PanelAutomationName);
    }

    private UIElement BuildBody(NotificationBellDisplay display) => _viewModel.State switch
    {
        NotificationBellState.Loading => BuildSkeleton(),
        NotificationBellState.Error => BuildError(),
        NotificationBellState.Empty => BuildEmpty(_viewModel.Labels),
        _ => display.HasRows ? BuildList(display) : BuildEmpty(_viewModel.Labels),
    };

    private StackPanel BuildSkeleton()
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(4, 8, 4, 8) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 48, Radius = 10 });
        }

        AutomationProperties.SetName(column, _viewModel.Labels.Loading);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            IconGlyph = NotificationBellRegistration.WarningGlyph,
            Message = _viewModel.ErrorMessage ?? _viewModel.Labels.ErrorText,
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();
        return error;
    }

    private static TsEmptyState BuildEmpty(NotificationBellLabels labels) => new()
    {
        IconGlyph = NotificationBellRegistration.BellGlyph,
        Title = labels.EmptyTitle,
        Message = labels.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildList(NotificationBellDisplay display)
    {
        var column = new StackPanel { Spacing = 2 };
        foreach (BellRow row in display.Rows)
        {
            column.Children.Add(BuildRow(row));
        }

        return column;
    }

    private Button BuildRow(BellRow row)
    {
        var grid = new Grid { ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var dot = new Ellipse
        {
            Width = 8,
            Height = 8,
            Fill = DisplayTokens.Brush(NotificationBellRegistration.SeverityBrushKey(row.Severity)),
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 6, 0, 0),
        };
        AutomationProperties.SetName(dot, row.SeverityLabel);
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
        Grid.SetColumn(dot, 0);
        grid.Children.Add(dot);

        StackPanel content = BuildRowContent(row);
        Grid.SetColumn(content, 1);
        grid.Children.Add(content);

        var button = new Button
        {
            Content = grid,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(8, 8, 8, 8),
            CornerRadius = new CornerRadius(8),
        };
        AutomationProperties.SetName(button, row.AccessibleName);
        button.Click += (_, _) => _viewModel.NavigateToInbox();
        return button;
    }

    private static StackPanel BuildRowContent(BellRow row)
    {
        var column = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };

        column.Children.Add(new TextBlock
        {
            Text = row.Title,
            FontSize = RowTitleFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        if (!string.IsNullOrEmpty(row.Message))
        {
            column.Children.Add(new TextBlock
            {
                Text = row.Message,
                FontSize = RowMessageFontSize,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxLines = 1,
            });
        }

        column.Children.Add(BuildMeta(row));
        return column;
    }

    private static StackPanel BuildMeta(BellRow row)
    {
        var meta = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        meta.Children.Add(new TextBlock
        {
            Text = row.RelativeTime,
            FontSize = MetaFontSize,
            Foreground = DisplayTokens.TextMuted,
        });

        if (row.VehicleName is { } vehicle)
        {
            meta.Children.Add(new TextBlock { Text = "\u00b7", FontSize = MetaFontSize, Foreground = DisplayTokens.TextMuted });
            meta.Children.Add(new TextBlock
            {
                Text = vehicle,
                FontSize = MetaFontSize,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        return meta;
    }
}
