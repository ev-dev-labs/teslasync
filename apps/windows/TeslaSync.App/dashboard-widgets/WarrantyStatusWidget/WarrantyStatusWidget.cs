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
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Warranty Status dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a "Warranty Status" title + Shield + freshness
/// header — hidden in the single-column compact footprint exactly as the web passes <c>title</c>/<c>icon</c> =
/// undefined when <c>isCompact</c>) wrapping one of two bodies: the standard layout's Time-Remaining +
/// Mileage-Remaining progress bars (each rendered only when its inputs resolve) above the detail list
/// (Expiry Date + Active/Expired badge, Days Remaining, Mileage Limit, Current Mileage, then one row per
/// covered warranty type with a Covered/Expired badge), or — in the compact footprint — the centred shield +
/// days-remaining + "days left" caption + Active/Expired badge. Either body collapses to the single "No
/// warranty data" empty state when the warranty <c>data</c> is null. All data flows through the shared
/// <see cref="WarrantyStatusViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every row, bar and the refresh affordance carries a Narrator name.
/// </summary>
public sealed partial class WarrantyStatusWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly WarrantyStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly WarrantyStatusDiagnostics _diagnostics;
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

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network warranty source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="units">The user's unit preference (mileage conversion); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="clock">Clock for the countdown projection; defaults to the system clock.</param>
    public WarrantyStatusWidget(
        IWarrantyStatusSource source,
        ILocalizer localizer,
        WarrantyStatusSize size,
        UnitPref? units = null,
        WarrantyStatusDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WarrantyStatusDiagnostics();
        _viewModel = new WarrantyStatusViewModel(source, localizer, size, units, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _icon = new FontIcon
        {
            Glyph = WarrantyStatusProjection.ShieldGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(WarrantyStatusProjection.ShieldBrushKey),
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

    /// <summary>The canonical registry id this surface registers under (<c>warranty-status</c>).</summary>
    public static string RegistryId => WarrantyStatusRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public WarrantyStatusSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the surface in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="WarrantyStatusSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies). The warranty read is fleet-wide (web
    /// <c>useWarrantyDetails()</c> passes no vehicle id), so no vehicle source is required.
    /// </summary>
    public static WarrantyStatusWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        WarrantyStatusSize? size = null,
        UnitPref? units = null,
        WarrantyStatusDiagnostics? diagnostics = null)
    {
        var source = new WarrantyStatusSource(api, engine, options);
        return new WarrantyStatusWidget(
            source, localizer, size ?? WarrantyStatusRegistration.DefaultSize, units, diagnostics);
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.warranty.refresh", "Refresh warranty details"));
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
            case WarrantyStatusState.Loading:
                Content = BuildLoading();
                break;

            case WarrantyStatusState.Error:
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

        // The compact summary and the empty state centre vertically; the standard body flows from the top.
        _bodyHost.VerticalContentAlignment = compact || !display.HasData
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
        if (!display.HasData)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    // ── Compact summary (web isCompact branch: shield + days + "days left" + Active/Expired badge) ──
    private static StackPanel BuildCompact(WarrantyStatusDisplay display)
    {
        var summary = display.Compact;
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = WarrantyStatusProjection.ShieldGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(WarrantyStatusProjection.ShieldBrushKey),
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        column.Children.Add(glyph);

        column.Children.Add(new TextBlock
        {
            Text = summary.DaysText,
            FontSize = 24,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(new TextBlock
        {
            Text = summary.DaysLeftCaption.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var badge = new TsBadge
        {
            Status = summary.BadgeStatus,
            Content = summary.BadgeText,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
        column.Children.Add(badge);

        AutomationProperties.SetName(column, summary.AccessibilityName);
        return column;
    }

    // ── Standard layout (web isCompact === false: progress bars + detail rows) ──
    private static StackPanel BuildStandard(WarrantyStatusDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };

        if (display.TimeBar is { } timeBar)
        {
            column.Children.Add(BuildBar(timeBar));
        }

        if (display.MileageBar is { } mileageBar)
        {
            column.Children.Add(BuildBar(mileageBar));
        }

        if (display.Entries.Count > 0)
        {
            var rows = new StackPanel();
            for (int i = 0; i < display.Entries.Count; i++)
            {
                rows.Children.Add(BuildRow(display.Entries[i], last: i == display.Entries.Count - 1));
            }

            column.Children.Add(rows);
        }

        return column;
    }

    private static TsMetricBar BuildBar(WarrantyMetricBar bar)
    {
        var metric = new TsMetricBar
        {
            Label = bar.Label,
            Value = bar.Value,
            Max = bar.Max,
            ValueText = bar.Sublabel,
            AccentBrushKey = bar.BrushKey,
        };
        AutomationProperties.SetName(metric, bar.AccessibilityName);
        return metric;
    }

    private static Border BuildRow(WarrantyDetailRow entry, bool last)
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
        if (entry.Mono)
        {
            value.FontFamily = MonoFont;
        }

        var right = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        right.Children.Add(value);

        if (entry.HasBadge)
        {
            var badge = new TsBadge
            {
                Status = entry.BadgeStatus,
                Content = entry.BadgeText,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
            right.Children.Add(badge);
        }

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
        column.Children.Add(new TsSkeleton { BlockHeight = 36 });
        column.Children.Add(new TsSkeleton { BlockHeight = 36 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.warranty.loading", "Loading warranty details"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.warranty.error", "Couldn't load warranty details"),
            ActionText = _localizer.GetString("widget.warranty.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = WarrantyStatusProjection.ShieldGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static FontFamily MonoFont { get; } = new("Consolas");

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
