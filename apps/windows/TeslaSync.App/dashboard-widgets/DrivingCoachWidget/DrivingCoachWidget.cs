using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Driving Coach dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/DrivingCoachWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping either the
/// compact score + potential-savings chip (1×N), or — when standard (≥2 cols) — the score header
/// ("{score} / 100" plus the savings chip) above the severity-free <c>WidgetTipCards</c> (lightbulb +
/// category title + impact badge + tip text). A friendly "No tips available" empty state covers the
/// no-data case for both layouts. All data flows through the shared <see cref="DrivingCoachViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade and every interactive or
/// informative element carries a Narrator name.
/// </summary>
public sealed partial class DrivingCoachWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly DrivingCoachViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DrivingCoachDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public DrivingCoachWidget(
        IDrivingCoachSource source,
        ILocalizer localizer,
        DrivingCoachSize size,
        DrivingCoachDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DrivingCoachDiagnostics();
        _viewModel = new DrivingCoachViewModel(source, localizer, size);
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

    /// <summary>The canonical registry id this surface registers under (<c>driving-coach</c>).</summary>
    public static string RegistryId => DrivingCoachRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public DrivingCoachSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DrivingCoachSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies + the widget vehicle source).
    /// </summary>
    public static DrivingCoachWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DrivingCoachSize? size = null,
        long? vehicleId = null,
        DrivingCoachDiagnostics? diagnostics = null)
    {
        var source = new DrivingCoachSource(vehicles, api, engine, options, vehicleId);
        return new DrivingCoachWidget(
            source, localizer, size ?? DrivingCoachRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = DrivingCoachProjection.LightbulbGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.drivingCoach.refresh", "Refresh driving coach"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
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
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

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
            case DrivingCoachState.Loading:
                Content = BuildLoading();
                break;

            case DrivingCoachState.Error:
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
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.State == DrivingCoachState.Empty)
        {
            return BuildEmpty();
        }

        var display = _viewModel.Display;
        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18, ReduceMotion = MotionPreference.ReduceMotion });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.drivingCoach.loading", "Loading driving coach"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.drivingCoach.error", "Couldn't load driving coach"),
            ActionText = _localizer.GetString("widget.drivingCoach.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DrivingCoachProjection.LightbulbGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(DrivingCoachDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 8,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var score = new TextBlock
        {
            Text = display.ScoreText,
            FontSize = 28,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(score, AccessibilityView.Raw);
        column.Children.Add(score);

        if (display.ShowSavings)
        {
            column.Children.Add(BuildSavingsBadge(display, HorizontalAlignment.Center));
        }
        else if (display.ShowCompactEmpty)
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = DrivingCoachProjection.LightbulbGlyph,
                Message = display.EmptyMessage,
                MinHeight = 0,
            });
        }

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static StackPanel BuildStandard(DrivingCoachDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildScoreHeader(display));
        column.Children.Add(BuildTips(display));
        return column;
    }

    private static Grid BuildScoreHeader(DrivingCoachDisplay display)
    {
        var scoreBlock = new TextBlock { VerticalAlignment = VerticalAlignment.Bottom };
        scoreBlock.Inlines.Add(new Run
        {
            Text = display.ScoreText,
            FontSize = 30,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        });
        scoreBlock.Inlines.Add(new Run
        {
            Text = $" {display.ScoreLabel}",
            FontSize = 12,
            FontWeight = FontWeights.Normal,
            Foreground = DisplayTokens.TextMuted,
        });
        AutomationProperties.SetName(scoreBlock, display.ScoreAutomationName);

        var row = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(scoreBlock, 0);
        row.Children.Add(scoreBlock);

        if (display.ShowSavings)
        {
            var badge = BuildSavingsBadge(display, HorizontalAlignment.Right);
            badge.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(badge, 1);
            row.Children.Add(badge);
        }

        return row;
    }

    private static UIElement BuildTips(DrivingCoachDisplay display)
    {
        if (!display.HasTips)
        {
            return new TsEmptyState
            {
                IconGlyph = DrivingCoachProjection.LightbulbGlyph,
                Message = display.EmptyMessage,
                MinHeight = 0,
                VerticalAlignment = VerticalAlignment.Top,
            };
        }

        var column = new StackPanel { Spacing = 8 };
        int rendered = 0;
        foreach (var tip in display.Tips)
        {
            if (rendered >= DrivingCoachProjection.MaxStandardTips)
            {
                break;
            }

            column.Children.Add(BuildTipCard(tip));
            rendered++;
        }

        return column;
    }

    private static Border BuildTipCard(CoachTip tip)
    {
        var icon = new FontIcon
        {
            Glyph = tip.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = tip.Title,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var titleRow = new Grid { ColumnSpacing = 8 };
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(title, 0);
        titleRow.Children.Add(title);

        if (tip.ShowImpact)
        {
            var badge = new TsBadge
            {
                Status = tip.ImpactStatus,
                Content = tip.ImpactLabel,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(badge, tip.ImpactLabel);
            Grid.SetColumn(badge, 1);
            titleRow.Children.Add(badge);
        }

        var description = new TextBlock
        {
            Text = tip.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var body = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(titleRow);
        body.Children.Add(description);

        var grid = new Grid { ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        grid.Children.Add(icon);
        grid.Children.Add(body);

        var card = new Border
        {
            Child = grid,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
            MinHeight = 44,
        };
        AutomationProperties.SetName(card, tip.AutomationName);
        return card;
    }

    private static TsBadge BuildSavingsBadge(DrivingCoachDisplay display, HorizontalAlignment alignment)
    {
        var badge = new TsBadge
        {
            Status = TeslaSync.App.Core.StatusKind.Success,
            Content = display.SavingsLabel,
            HorizontalAlignment = alignment,
        };
        AutomationProperties.SetName(badge, display.SavingsLabel);
        return badge;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
