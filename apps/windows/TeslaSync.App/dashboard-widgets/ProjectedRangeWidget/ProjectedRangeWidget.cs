using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Projected Range dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ProjectedRangeWidget.tsx. It mirrors the web <c>WidgetShell</c> (a skeleton
/// while loading, a retry surface on error, otherwise a freshness header above the body) and reproduces the web's
/// three size-driven layouts: a compact (1×2) big number with a confidence badge, a standard (2×2) range +
/// projected-vs-EPA comparison bar, and a wide (≥3 col) range + comparison + a "Range Factors" list (battery
/// degradation, average daily usage, current capacity, battery cycles). When the response carries no projection
/// object a friendly "No projected range data" empty state is shown (the web <c>{data ? … :
/// &lt;EmptyState&gt;}</c> gate). All data flows through the shared <see cref="ProjectedRangeViewModel"/>; the view
/// never performs HTTP. Every string resolves through the i18n facade and every interactive element carries a
/// Narrator name; the loading shimmer honours the system reduced-motion setting.
/// </summary>
public sealed partial class ProjectedRangeWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";    // Segoe Fluent — Refresh
    private const string NavigationGlyph = "\uE707"; // Segoe Fluent — Location (web Navigation icon)

    // Web parity: the comparison bar fill colours (bg #10b981 / #f59e0b / #ef4444 dynamic ternary).
    private static readonly Windows.UI.Color BarGood = Windows.UI.Color.FromArgb(255, 0x10, 0xB9, 0x81);
    private static readonly Windows.UI.Color BarWarning = Windows.UI.Color.FromArgb(255, 0xF5, 0x9E, 0x0B);
    private static readonly Windows.UI.Color BarPoor = Windows.UI.Color.FromArgb(255, 0xEF, 0x44, 0x44);

    private readonly ProjectedRangeViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ProjectedRangeDiagnostics _diagnostics;
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

    private readonly FontIcon _titleIcon = new()
    {
        Glyph = NavigationGlyph,
        FontSize = 14,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network projected-range source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (drives the compact / standard / wide layout).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public ProjectedRangeWidget(
        IProjectedRangeSource source,
        ILocalizer localizer,
        ProjectedRangeSize size,
        UnitPref? units = null,
        ProjectedRangeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ProjectedRangeDiagnostics();
        _viewModel = new ProjectedRangeViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>projected-range</c>).</summary>
    public static string RegistryId => ProjectedRangeRegistration.Id;

    /// <summary>The widget footprint; reassigning switches between the compact / standard / wide layouts.</summary>
    public ProjectedRangeSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the range, EPA and average-daily values.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ProjectedRangeSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ProjectedRangeWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ProjectedRangeSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        ProjectedRangeDiagnostics? diagnostics = null)
    {
        var source = new ProjectedRangeSource(vehicles, api, engine, options, vehicleId);
        return new ProjectedRangeWidget(source, localizer, size ?? ProjectedRangeRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        _titleIcon.Foreground = InfoBrush();
        AutomationProperties.SetAccessibilityView(_titleIcon, AccessibilityView.Raw);

        _titleText.Text = _viewModel.Title;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.projectedRange.refresh", "Refresh projected range"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

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

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
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
            case ProjectedRangeState.Loading:
                Content = BuildLoading();
                break;

            case ProjectedRangeState.Error:
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
        // Web parity: the compact (1×2) branch renders WidgetShell with no title/icon — only the freshness chrome.
        _titleRow.Visibility = _viewModel.IsCompact ? Visibility.Collapsed : Visibility.Visible;
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
            // Web parity: no projection object (data falsy) renders the "No projected range data" surface.
            return BuildEmpty();
        }

        if (display.IsCompact)
        {
            return BuildCompactBody(display);
        }

        return display.IsWide ? BuildWideBody(display) : BuildStandardBody(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 120, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 34, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 16, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.projectedRange.loading", "Loading projected range"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.projectedRange.error", "Couldn't load the projected range"),
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
        IconGlyph = NavigationGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact (1×2) body (web isCompact branch → WidgetBigNumber) ──
    private static StackPanel BuildCompactBody(ProjectedRangeDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = 44, // Windows 11 minimum touch / focus target.
        };

        // Web parity: WidgetBigNumber value is white (valueColor defaults to text-white).
        column.Children.Add(BuildValueRow(display, DisplayTokens.TextPrimary));
        column.Children.Add(Caption(display.ProjectedLabel));

        if (display.Badge is { } badge)
        {
            // Web parity: the compact badge shows only the confidence text (no score).
            column.Children.Add(BuildBadge(badge.Status, badge.Text));
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // ── Standard (2×2) body (web non-compact, non-wide branch) ──
    private static StackPanel BuildStandardBody(ProjectedRangeDisplay display)
    {
        var column = new StackPanel { Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        column.Children.Add(BuildPrimaryRange(display));
        column.Children.Add(BuildComparisonBar(display));
        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // ── Wide (≥3 col) body (web isWide branch → range + comparison + factors list) ──
    private static StackPanel BuildWideBody(ProjectedRangeDisplay display)
    {
        var column = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(BuildPrimaryRange(display));
        column.Children.Add(BuildComparisonBar(display));
        column.Children.Add(BuildFactorsSection(display));
        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // Web parity: centred range big number (neon-cyan) + unit, with the confidence badge ("{text} · {score}%").
    private static StackPanel BuildPrimaryRange(ProjectedRangeDisplay display)
    {
        var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(BuildValueRow(display, InfoBrush()));

        if (display.Badge is { } badge)
        {
            column.Children.Add(BuildBadge(badge.Status, display.BadgeDetailText));
        }

        return column;
    }

    // Web parity: <div className="flex items-baseline justify-center gap-1"> — big value + the unit caption.
    private static StackPanel BuildValueRow(ProjectedRangeDisplay display, Brush valueBrush)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        if (display.ProjectedRangeValue is { } value)
        {
            row.Children.Add(new TextBlock
            {
                Text = ScalarFormatters.FormatNumber(value, 0),
                FontSize = 30,
                FontWeight = FontWeights.Bold,
                Foreground = valueBrush,
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }
        else
        {
            // Web parity: a null projected range renders the muted em dash.
            row.Children.Add(new TextBlock
            {
                Text = ProjectedRangeProjection.EmDash,
                FontSize = 30,
                FontWeight = FontWeights.Bold,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        row.Children.Add(new TextBlock
        {
            Text = display.DistanceUnitLabel,
            FontSize = 18,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Bottom,
        });

        return row;
    }

    // Web parity: the "Projected | EPA: …" caption row, the projected/EPA bar, and the "{pct}% of EPA rated" note.
    private static StackPanel BuildComparisonBar(ProjectedRangeDisplay display)
    {
        var section = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Stretch };

        var captionRow = new Grid();
        captionRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        captionRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var projected = Caption(display.ProjectedLabel);
        projected.HorizontalAlignment = HorizontalAlignment.Left;
        Grid.SetColumn(projected, 0);

        var epa = Caption($"{display.EpaLabel}: {display.EpaText}");
        epa.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(epa, 1);

        captionRow.Children.Add(projected);
        captionRow.Children.Add(epa);
        section.Children.Add(captionRow);

        section.Children.Add(BuildProgressBar(display.RangePct, display.BarTier));

        if (display.RangePct is not null)
        {
            var note = Caption(display.RangePctText);
            note.HorizontalAlignment = HorizontalAlignment.Center;
            note.TextAlignment = TextAlignment.Center;
            section.Children.Add(note);
        }

        AutomationProperties.SetName(section, $"{display.ProjectedLabel}, {display.EpaLabel} {display.EpaText}");
        return section;
    }

    private static Border BuildProgressBar(int? rangePct, ProjectedRangeBarTier tier)
    {
        double fill = Math.Clamp(rangePct ?? 0, 0, 100);

        var columns = new Grid();
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(fill, GridUnitType.Star) });
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100 - fill, GridUnitType.Star) });

        var fillBar = new Border
        {
            CornerRadius = new CornerRadius(999),
            Background = BarBrush(tier),
        };
        Grid.SetColumn(fillBar, 0);
        columns.Children.Add(fillBar);

        return new Border
        {
            Height = 8,
            CornerRadius = new CornerRadius(999),
            Background = TrackBrush(),
            Child = columns,
        };
    }

    // Web parity: the "Range Factors" caption above the degradation / avg-daily / capacity / cycles rows.
    private static StackPanel BuildFactorsSection(ProjectedRangeDisplay display)
    {
        var section = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Stretch };
        section.Children.Add(Caption(display.FactorsLabel));

        var list = new StackPanel { Spacing = 0 };
        foreach (var factor in display.Factors)
        {
            list.Children.Add(BuildFactorRow(factor));
        }

        section.Children.Add(list);
        return section;
    }

    // Web parity: <div className="flex items-center justify-between … min-h-[44px]"> — icon + label (left), value (right).
    private static Border BuildFactorRow(ProjectedRangeFactor factor)
    {
        var grid = new Grid { ColumnSpacing = 8, MinHeight = 44, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon
        {
            Glyph = factor.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);

        var label = new TextBlock
        {
            Text = factor.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 1);

        var value = new TextBlock
        {
            Text = factor.Value,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(value, 2);

        grid.Children.Add(icon);
        grid.Children.Add(label);
        grid.Children.Add(value);

        var row = new Border
        {
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = HairlineBrush(),
            Padding = new Thickness(0, 2, 0, 2),
            Child = grid,
        };
        AutomationProperties.SetName(row, $"{factor.Label} {factor.Value}");
        return row;
    }

    private static TsBadge BuildBadge(StatusKind status, string text)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = text,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private static TextBlock Caption(string text) => new()
    {
        Text = text,
        FontSize = 10,
        Foreground = DisplayTokens.TextMuted,
        CharacterSpacing = 80,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Brush InfoBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    private static SolidColorBrush BarBrush(ProjectedRangeBarTier tier) => tier switch
    {
        ProjectedRangeBarTier.Good => new SolidColorBrush(BarGood),
        ProjectedRangeBarTier.Warning => new SolidColorBrush(BarWarning),
        _ => new SolidColorBrush(BarPoor),
    };

    // Web parity: the progress track is the elevated --surface-2; a low-opacity overlay keeps it theme-aware.
    private static SolidColorBrush TrackBrush() => new(Microsoft.UI.Colors.White) { Opacity = 0.1 };

    // Web parity: the factor-row divider is border-white/[0.04].
    private static SolidColorBrush HairlineBrush() => new(Microsoft.UI.Colors.White) { Opacity = 0.04 };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
