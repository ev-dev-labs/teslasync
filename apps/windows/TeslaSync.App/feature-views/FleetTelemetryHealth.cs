using System.Collections.Generic;
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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Fleet Telemetry health surface — a parity port of
/// web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx. It composes the web's two
/// <c>ToolCard</c> glass panels: an "Error VINs" card (a danger/success count badge, an optional active
/// "Filtered: {vin}" chip with a clear affordance, a "Refresh from Tesla" button, and a table of the
/// error VINs whose VIN cell is a button that toggles the per-VIN filter) and an "Error Log" card (a
/// "Refresh from Tesla" button and a scrollable table of the — optionally filtered — error rows with a
/// danger error-code badge and recency-coloured timestamps). Each card renders every state — loading
/// skeleton, populated table, friendly empty text, an explicit retry surface on hard failure, plus stale
/// and offline freshness chips. All data flows through the shared <see cref="FleetTelemetryHealthViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade and every interactive
/// element carries a Narrator name.
/// </summary>
public sealed partial class FleetTelemetryHealth : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string ClearGlyph = "\uE711";   // Segoe Fluent — Cancel (×)
    private const double VinColumnWidth = 200;
    private const double TimeColumnWidth = 188;
    private const double CodeColumnWidth = 132;
    private const double ErrorFeedMaxHeight = 360;

    private readonly FleetTelemetryHealthViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly FleetTelemetryHealthDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    public FleetTelemetryHealth(
        IFleetTelemetryHealthSource source,
        ILocalizer localizer,
        FleetTelemetryHealthDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new FleetTelemetryHealthDiagnostics();
        _viewModel = new FleetTelemetryHealthViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _localizer.GetString("devtools.health.errorLogTitle", "Error Log"));

        var scroller = new ScrollViewer
        {
            Content = _root,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(4),
        };
        Content = scroller;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>fleet-telemetry-health</c>).</summary>
    public static string SurfaceId => FleetTelemetryHealthRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public FleetTelemetryHealthViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="FleetTelemetryHealthSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static FleetTelemetryHealth Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        FleetTelemetryHealthDiagnostics? diagnostics = null)
    {
        var source = new FleetTelemetryHealthSource(api, engine, options);
        return new FleetTelemetryHealth(source, localizer, diagnostics);
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
        _root.Children.Clear();
        _root.Children.Add(BuildErrorVinsCard());
        _root.Children.Add(BuildErrorLogCard());
    }

    // ── Error VINs card ──────────────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorVinsCard()
    {
        var controls = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var countBadge = new TsBadge
        {
            Status = _viewModel.VinsDisplay.CountStatus,
            Content = new TextBlock { Text = _viewModel.VinsDisplay.CountBadgeText, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(countBadge, _viewModel.VinsDisplay.CountBadgeText);
        controls.Children.Add(countBadge);

        if (_viewModel.HasVinFilter)
        {
            controls.Children.Add(BuildFilterChip());
        }

        controls.Children.Add(BuildRefreshButton(
            _viewModel.IsRefreshingVins,
            _localizer.GetString("devtools.health.refreshVins", "Refresh from Tesla"),
            OnRefreshVins));

        controls.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.VinsUpdatedAt,
            IsFetching = _viewModel.VinsIsFetching,
            IsError = _viewModel.VinsIsError,
            VerticalAlignment = VerticalAlignment.Center,
        });

        UIElement body = _viewModel.VinsState switch
        {
            FleetTelemetrySectionState.Loading => BuildLoading(_viewModel.VinsLoadingLabel, 4),
            FleetTelemetrySectionState.Error => BuildError(
                _viewModel.VinsErrorMessage, _viewModel.VinsAttempts, OnRetryVins),
            _ => _viewModel.VinsDisplay.HasRows
                ? (UIElement)BuildVinsTable(_viewModel.VinsDisplay)
                : BuildEmpty(FleetTelemetryHealthProjection.ErrorVinsGlyph, _viewModel.NoErrorVinsMessage),
        };

        return BuildCard(
            FleetTelemetryHealthProjection.ErrorVinsGlyph,
            StatusKind.Danger,
            _viewModel.ErrorVinsTitle,
            _viewModel.ErrorVinsDescription,
            controls,
            body);
    }

    private FrameworkElement BuildFilterChip()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(new TextBlock
        {
            Text = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", _viewModel.FilteredByLabel, _viewModel.SelectedVin),
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var clear = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = ClearGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            MinWidth = 28,
        };
        AutomationProperties.SetName(clear, _viewModel.ClearVinFilterLabel);
        clear.Click += OnClearVinFilter;
        row.Children.Add(clear);

        var chip = new TsBadge
        {
            Status = StatusKind.Info,
            Content = row,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(
            chip,
            string.Format(CultureInfo.CurrentCulture, "{0}: {1}", _viewModel.FilteredByLabel, _viewModel.SelectedVin));
        return chip;
    }

    private StackPanel BuildVinsTable(FleetTelemetryErrorVinsDisplay display)
    {
        var columns = new[]
        {
            new ColumnSpec(_viewModel.VinHeader, new GridLength(1, GridUnitType.Star)),
            new ColumnSpec(_viewModel.FirstSeenHeader, new GridLength(TimeColumnWidth)),
            new ColumnSpec(_viewModel.LastSeenHeader, new GridLength(TimeColumnWidth)),
        };

        var table = NewTable(columns);
        foreach (var row in display.Rows)
        {
            var vinButton = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                Text = row.Vin,
                HorizontalAlignment = HorizontalAlignment.Left,
                FontFamily = new FontFamily("Consolas"),
            };
            AutomationProperties.SetName(
                vinButton,
                string.Format(CultureInfo.CurrentCulture, "{0} {1}", _viewModel.FilteredByLabel, row.Vin));
            vinButton.Click += (_, _) => OnSelectVin(row.Vin);

            var firstSeen = TimeCell(row.FirstSeenText, row.FirstSeenTooltip, DisplayTokens.TextSecondary);
            var lastSeen = TimeCell(
                row.LastSeenText,
                row.LastSeenTooltip,
                row.LastSeenIsRecent ? DisplayTokens.Brush("TsColorDangerBrush") : DisplayTokens.Brush("TsColorWarningBrush"));

            table.Children.Add(BuildRow(columns, new UIElement[] { vinButton, firstSeen, lastSeen }, row.AutomationName));
        }

        return table;
    }

    private void OnSelectVin(string vin) => _ = _viewModel.SelectVinAsync(vin);

    private void OnClearVinFilter(object sender, RoutedEventArgs e) => _ = _viewModel.ClearVinAsync();

    private void OnRefreshVins(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshVinsAsync();

    private void OnRetryVins(object? sender, EventArgs e) => _ = _viewModel.RetryVinsAsync();

    // ── Error Log card ───────────────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorLogCard()
    {
        var controls = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        controls.Children.Add(BuildRefreshButton(
            _viewModel.IsRefreshingErrors,
            _localizer.GetString("devtools.health.refreshErrors", "Refresh from Tesla"),
            OnRefreshErrors));

        controls.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.ErrorsUpdatedAt,
            IsFetching = _viewModel.ErrorsIsFetching,
            IsError = _viewModel.ErrorsIsError,
            VerticalAlignment = VerticalAlignment.Center,
        });

        UIElement body = _viewModel.ErrorsState switch
        {
            FleetTelemetrySectionState.Loading => BuildLoading(_viewModel.ErrorsLoadingLabel, 6),
            FleetTelemetrySectionState.Error => BuildError(
                _viewModel.ErrorsErrorMessage, _viewModel.ErrorsAttempts, OnRetryErrors),
            _ => _viewModel.ErrorsDisplay.HasRows
                ? (UIElement)new ScrollViewer
                {
                    Content = BuildErrorsTable(_viewModel.ErrorsDisplay),
                    MaxHeight = ErrorFeedMaxHeight,
                    VerticalScrollMode = ScrollMode.Auto,
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    HorizontalScrollMode = ScrollMode.Disabled,
                    HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                }
                : BuildEmpty(FleetTelemetryHealthProjection.ErrorLogGlyph, _viewModel.NoErrorsMessage),
        };

        return BuildCard(
            FleetTelemetryHealthProjection.ErrorLogGlyph,
            StatusKind.Warning,
            _viewModel.ErrorLogTitle,
            _viewModel.ErrorLogDescription,
            controls,
            body);
    }

    private StackPanel BuildErrorsTable(FleetTelemetryErrorsDisplay display)
    {
        var columns = new[]
        {
            new ColumnSpec(_viewModel.VinHeader, new GridLength(VinColumnWidth)),
            new ColumnSpec(_viewModel.ErrorCodeHeader, new GridLength(CodeColumnWidth)),
            new ColumnSpec(_viewModel.MessageHeader, new GridLength(1, GridUnitType.Star)),
            new ColumnSpec(_viewModel.ReportedAtHeader, new GridLength(TimeColumnWidth)),
        };

        var table = NewTable(columns);
        foreach (var row in display.Rows)
        {
            var vin = new TextBlock
            {
                Text = row.Vin,
                FontSize = 12,
                FontFamily = new FontFamily("Consolas"),
                Foreground = DisplayTokens.TextPrimary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                VerticalAlignment = VerticalAlignment.Center,
            };

            UIElement code = row.HasErrorCode
                ? new TsBadge
                {
                    Status = StatusKind.Danger,
                    Content = new TextBlock { Text = row.ErrorCode, FontSize = 11 },
                    HorizontalAlignment = HorizontalAlignment.Left,
                    VerticalAlignment = VerticalAlignment.Center,
                }
                : new TextBlock
                {
                    Text = FleetTelemetryHealthProjection.EmDash,
                    FontSize = 12,
                    Foreground = DisplayTokens.TextMuted,
                    VerticalAlignment = VerticalAlignment.Center,
                };

            var message = new TextBlock
            {
                Text = row.Message,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var reported = TimeCell(
                row.ReportedAtText,
                row.ReportedAtTooltip,
                row.ReportedAtIsRecent ? DisplayTokens.Brush("TsColorDangerBrush") : DisplayTokens.TextSecondary);

            table.Children.Add(BuildRow(columns, new[] { vin, code, message, reported }, row.AutomationName));
        }

        return table;
    }

    private void OnRefreshErrors(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshErrorsAsync();

    private void OnRetryErrors(object? sender, EventArgs e) => _ = _viewModel.RetryErrorsAsync();

    // ── Shared chrome ────────────────────────────────────────────────────────────────────────────────

    private static TsGlassPanel BuildCard(
        string glyph,
        StatusKind accent,
        string title,
        string description,
        UIElement controls,
        UIElement body)
    {
        var iconHost = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 10),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            VerticalAlignment = VerticalAlignment.Top,
            Child = new FontIcon
            {
                Glyph = glyph,
                FontSize = 20,
                Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(accent)),
            },
        };
        AutomationProperties.SetAccessibilityView(iconHost, AccessibilityView.Raw);

        var titleBlock = new TextBlock
        {
            Text = title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.NoWrap,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        var descBlock = new TextBlock
        {
            Text = description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };
        var titleColumn = new StackPanel { Spacing = 2 };
        titleColumn.Children.Add(titleBlock);
        titleColumn.Children.Add(descBlock);

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        header.Children.Add(iconHost);
        header.Children.Add(titleColumn);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(header);
        column.Children.Add(controls);
        column.Children.Add(body);

        return new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = column,
        };
    }

    private TsButton BuildRefreshButton(bool isRefreshing, string label, RoutedEventHandler handler)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Secondary,
            Size = ControlSize.Small,
            Text = label,
            IconGlyph = RefreshGlyph,
            IsLoading = isRefreshing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, label);
        button.Click += handler;
        return button;
    }

    private StackPanel BuildLoading(string announce, int rows)
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(0, 4, 0, 4) };
        for (int i = 0; i < rows; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, announce);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError(string? message, int attempts, EventHandler retry)
    {
        var error = new TsQueryError
        {
            Message = message ?? _localizer.GetString("devtools.health.error", "Couldn't load fleet telemetry health"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += retry;
        return error;
    }

    private static TsEmptyState BuildEmpty(string glyph, string message) => new()
    {
        IconGlyph = glyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Table primitives ─────────────────────────────────────────────────────────────────────────────

    private static StackPanel NewTable(IReadOnlyList<ColumnSpec> columns)
    {
        var table = new StackPanel { Spacing = 0 };

        var headerGrid = NewColumnGrid(columns);
        headerGrid.Padding = new Thickness(8, 4, 8, 6);
        for (int i = 0; i < columns.Count; i++)
        {
            var caption = new TextBlock
            {
                Text = columns[i].Header,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextMuted,
                CharacterSpacing = 40,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            Grid.SetColumn(caption, i);
            headerGrid.Children.Add(caption);
        }

        var headerBorder = new Border
        {
            Child = headerGrid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        table.Children.Add(headerBorder);
        return table;
    }

    private static Border BuildRow(IReadOnlyList<ColumnSpec> columns, IReadOnlyList<UIElement> cells, string automationName)
    {
        var grid = NewColumnGrid(columns);
        grid.Padding = new Thickness(8, 6, 8, 6);
        grid.MinHeight = 40;
        for (int i = 0; i < cells.Count && i < columns.Count; i++)
        {
            var cell = cells[i];
            Grid.SetColumn((FrameworkElement)cell, i);
            grid.Children.Add(cell);
        }

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, automationName);
        return border;
    }

    private static Grid NewColumnGrid(IReadOnlyList<ColumnSpec> columns)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        foreach (var column in columns)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = column.Width });
        }

        return grid;
    }

    private static TextBlock TimeCell(string text, string tooltip, Brush foreground)
    {
        var block = new TextBlock
        {
            Text = text,
            FontSize = 12,
            Foreground = foreground,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (!string.IsNullOrEmpty(tooltip) && tooltip != FleetTelemetryHealthProjection.EmDash)
        {
            ToolTipService.SetToolTip(block, tooltip);
        }

        return block;
    }

    private readonly record struct ColumnSpec(string Header, GridLength Width);
}
