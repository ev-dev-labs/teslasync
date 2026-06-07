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

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Automation Status dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/AutomationStatusWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a title + Workflow glyph + freshness
/// header with a stale/offline chip) wrapping either the compact active/total hero (single column or row —
/// the big <c>enabled/total</c> count, the "Active" label and a "Failing" chip), or — when wider — the
/// active/failing/auto-disabled summary above an automation feed (status-badged rows with last-run and
/// next-scheduled times, and a per-row enable toggle at three-plus columns), or a friendly empty state.
/// All data flows through the shared <see cref="AutomationStatusViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator
/// name. The toggle drives the optimistic enable/disable mutation through the view-model.
/// </summary>
public sealed partial class AutomationStatusWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string WorkflowGlyph = "\uE9F5"; // Segoe Fluent — Flow (web Workflow)
    private const string ClockGlyph = "\uE823"; // Segoe Fluent — Recent (web Clock)
    private const string ScheduleGlyph = "\uE787"; // Segoe Fluent — Calendar (web next-fire ⏰)
    private const string CheckGlyph = "\uE930"; // Segoe Fluent — Completed (web CheckCircle2)
    private const string WarningGlyph = "\uE7BA"; // Segoe Fluent — Warning (web AlertTriangle)
    private const string ErrorGlyph = "\uEA39"; // Segoe Fluent — ErrorBadge (web XCircle)

    private readonly AutomationStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AutomationStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly FontIcon _titleIcon = new();
    private readonly TextBlock _titleText = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _statusChip = new() { Dot = true, VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed };
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, toggle, localizer, footprint and diagnostics.</summary>
    public AutomationStatusWidget(
        IAutomationStatusSource source,
        IAutomationToggle toggle,
        ILocalizer localizer,
        AutomationStatusSize size,
        AutomationStatusDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(toggle);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AutomationStatusDiagnostics();
        _viewModel = new AutomationStatusViewModel(source, localizer, size, toggle, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>automation-status</c>).</summary>
    public static string RegistryId => AutomationStatusRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the rows for the new layout.</summary>
    public AutomationStatusSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="AutomationStatusSource"/> and
    /// <see cref="AutomationToggleCommand"/> from the shared data layer (the dashboard host's P2-core
    /// dependencies).
    /// </summary>
    public static AutomationStatusWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        AutomationStatusSize? size = null,
        AutomationStatusDiagnostics? diagnostics = null)
    {
        var source = new AutomationStatusSource(api, engine, options);
        var toggle = new AutomationToggleCommand(api);
        return new AutomationStatusWidget(source, toggle, localizer, size ?? AutomationStatusRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        _titleIcon.Glyph = WorkflowGlyph;
        _titleIcon.FontSize = 14;
        _titleIcon.Foreground = DisplayTokens.Accent;
        _titleIcon.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetAccessibilityView(_titleIcon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(_titleIcon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.automationStatus.refresh", "Refresh automation status"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_statusChip);
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
            case AutomationStatusState.Loading:
                Content = BuildLoading();
                break;

            case AutomationStatusState.Error:
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
        var showHeader = _viewModel.Display.ShowHeader;
        _titleRow.Visibility = showHeader ? Visibility.Visible : Visibility.Collapsed;
        if (showHeader)
        {
            _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
        UpdateStatusChip();
    }

    private void UpdateStatusChip()
    {
        switch (_viewModel.State)
        {
            case AutomationStatusState.Stale:
                _statusChip.Status = StatusKind.Warning;
                _statusChip.Content = _localizer.GetString("widget.automationStatus.stale", "Stale");
                _statusChip.Visibility = Visibility.Visible;
                break;

            case AutomationStatusState.Offline:
                _statusChip.Status = StatusKind.Neutral;
                _statusChip.Content = _localizer.GetString("widget.automationStatus.offline", "Offline");
                _statusChip.Visibility = Visibility.Visible;
                break;

            default:
                _statusChip.Visibility = Visibility.Collapsed;
                break;
        }

        if (_statusChip.Visibility == Visibility.Visible && _statusChip.Content is string chip)
        {
            AutomationProperties.SetName(_statusChip, chip);
        }
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasItems)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompactHero(display) : BuildFull(display);
    }

    private static StackPanel BuildCompactHero(AutomationStatusDisplay display)
    {
        var icon = new FontIcon
        {
            Glyph = WorkflowGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Accent,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var value = new TextBlock
        {
            Text = display.CompactValueText,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.ActiveLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 2,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(icon);
        column.Children.Add(value);
        column.Children.Add(label);

        if (display.HasFailing)
        {
            var failing = new TsBadge
            {
                Status = StatusKind.Warning,
                Dot = true,
                Content = display.FailingSummaryText,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            AutomationProperties.SetName(failing, display.FailingSummaryText);
            column.Children.Add(failing);
        }

        var name = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            display.CompactValueText,
            display.ActiveLabel);
        AutomationProperties.SetName(column, name);
        return column;
    }

    private StackPanel BuildFull(AutomationStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };

        if (!string.IsNullOrEmpty(_viewModel.ToggleErrorMessage))
        {
            column.Children.Add(BuildToggleError(_viewModel.ToggleErrorMessage!));
        }

        column.Children.Add(BuildSummary(display));
        column.Children.Add(BuildRows(display));
        return column;
    }

    private static Border BuildToggleError(string message)
    {
        var text = new TextBlock
        {
            Text = message,
            FontSize = 12,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            TextWrapping = TextWrapping.Wrap,
        };

        var border = new Border
        {
            Child = text,
            BorderBrush = DisplayTokens.Brush("TsColorDangerBrush"),
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 0, 0, 6),
        };
        AutomationProperties.SetName(border, message);
        LiveRegion.Configure(border, assertive: true);
        LiveRegion.Announce(border);
        return border;
    }

    private static Border BuildSummary(AutomationStatusDisplay display)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(SummaryItem(CheckGlyph, DisplayTokens.Brush("TsColorSuccessBrush"), display.ActiveSummaryText, DisplayTokens.TextSecondary));

        if (display.HasFailing)
        {
            var warning = DisplayTokens.Brush("TsColorWarningBrush");
            row.Children.Add(SummaryItem(WarningGlyph, warning, display.FailingSummaryText, warning));
        }

        if (display.HasAutoDisabled)
        {
            var danger = DisplayTokens.Brush("TsColorDangerBrush");
            row.Children.Add(SummaryItem(ErrorGlyph, danger, display.AutoDisabledSummaryText, danger));
        }

        return new Border
        {
            Child = row,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 0, 0, 6),
        };
    }

    private static StackPanel SummaryItem(string glyph, Brush glyphBrush, string text, Brush textBrush)
    {
        var icon = new FontIcon { Glyph = glyph, FontSize = 12, Foreground = glyphBrush, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var label = new TextBlock { Text = text, FontSize = 12, Foreground = textBrush, VerticalAlignment = VerticalAlignment.Center };

        var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        item.Children.Add(icon);
        item.Children.Add(label);
        AutomationProperties.SetName(item, text);
        return item;
    }

    private StackPanel BuildRows(AutomationStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 2 };
        foreach (var row in display.Items)
        {
            column.Children.Add(BuildRow(row, display.IsWide));
        }

        return column;
    }

    private Grid BuildRow(AutomationStatusRow row, bool showToggle)
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new TextBlock
        {
            Text = row.Name,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var badge = new TsBadge { Status = row.StatusVariant, Content = row.StatusLabel, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(badge, row.StatusLabel);
        titleRow.Children.Add(badge);

        var body = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(titleRow);

        var meta = BuildRowMeta(row);
        if (meta is not null)
        {
            body.Children.Add(meta);
        }

        var grid = new Grid { ColumnSpacing = 10, Padding = new Thickness(0, 6, 0, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.BorderBrush = DisplayTokens.Border;
        grid.BorderThickness = new Thickness(0, 0, 0, 1);
        Grid.SetColumn(body, 0);
        grid.Children.Add(body);

        if (showToggle)
        {
            var toggle = new TsToggle { VerticalAlignment = VerticalAlignment.Center };
            toggle.IsOn = row.Enabled;
            AutomationProperties.SetName(toggle, row.ToggleLabel);
            var id = row.Id;
            toggle.Toggled += (_, _) => _ = _viewModel.ToggleAsync(id, toggle.IsOn);
            Grid.SetColumn(toggle, 1);
            grid.Children.Add(toggle);
        }

        AutomationProperties.SetName(grid, row.RowName);
        return grid;
    }

    private static StackPanel? BuildRowMeta(AutomationStatusRow row)
    {
        if (!row.HasLastRun && !row.HasNextFire)
        {
            return null;
        }

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };
        if (row.HasLastRun)
        {
            meta.Children.Add(MetaItem(ClockGlyph, row.LastRunRelative));
        }

        if (row.HasNextFire)
        {
            meta.Children.Add(MetaItem(ScheduleGlyph, row.NextFireRelative));
        }

        return meta;
    }

    private static StackPanel MetaItem(string glyph, string text)
    {
        var icon = new FontIcon { Glyph = glyph, FontSize = 10, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var label = new TextBlock { Text = text, FontSize = 10, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center };

        var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        item.Children.Add(icon);
        item.Children.Add(label);
        return item;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (var i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.automationStatus.loading", "Loading automation status"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.automationStatus.error", "Couldn't load automations"),
            ActionText = _localizer.GetString("widget.automationStatus.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = WorkflowGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
