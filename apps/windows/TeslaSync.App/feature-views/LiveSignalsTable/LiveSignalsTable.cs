using System.Collections.Generic;
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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Live Signals table surface — a parity port of
/// web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx. It renders the Redis-cached
/// live signal snapshot for one vehicle as a filterable + sortable table: a search-prefixed filter field, a
/// data-freshness chip, and a three-column table (Signal / Value / Last update) whose Signal and Last-update
/// headers are keyboard-operable sort toggles. Every state renders — loading skeleton, populated table, the
/// friendly "No live signals cached" empty surface, a filtered-empty in-table message, an explicit retry
/// surface on hard failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="LiveSignalsTableViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class LiveSignalsTable : ContentControl, IDisposable
{
    private const string SearchGlyph = "\uE721";       // Segoe Fluent — Search
    private const string SortAscGlyph = "\uE70E";      // chevron up
    private const string SortDescGlyph = "\uE70D";     // chevron down
    private const double FilterMaxWidth = 380;
    private const double TimeColumnWidth = 188;
    private const double TableMaxHeight = 420;
    private const int LoadingSkeletonRows = 6;

    private readonly LiveSignalsTableViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LiveSignalsTableDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly TsInput _filterBox = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, the vehicle id, localizer and diagnostics.</summary>
    public LiveSignalsTable(
        ILiveSignalsTableSource source,
        long vehicleId,
        ILocalizer localizer,
        LiveSignalsTableDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LiveSignalsTableDiagnostics();
        _viewModel = new LiveSignalsTableViewModel(source, vehicleId, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _localizer.GetString("admin.liveSignals.title", "Live signals"));

        _root.Children.Add(BuildHeader());
        _root.Children.Add(_bodyHost);

        Content = new ScrollViewer
        {
            Content = _root,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(4),
        };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>live-signals-table</c>).</summary>
    public static string SurfaceId => LiveSignalsTableRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LiveSignalsTableViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="LiveSignalsTableSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static LiveSignalsTable Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long vehicleId,
        ILocalizer localizer,
        LiveSignalsTableDiagnostics? diagnostics = null)
    {
        var source = new LiveSignalsTableSource(api, engine, options);
        return new LiveSignalsTable(source, vehicleId, localizer, diagnostics);
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
        _filterBox.TextChanged -= OnFilterTextChanged;
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

    // ── Persistent header (built once so the filter caret/focus survives re-render) ──────────────────────

    private Grid BuildHeader()
    {
        _filterBox.Hint = _viewModel.FilterHint;
        AutomationProperties.SetName(_filterBox, _viewModel.FilterAria);
        _filterBox.TextChanged += OnFilterTextChanged;

        var searchIcon = new FontIcon
        {
            Glyph = SearchGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            Margin = new Thickness(0, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(searchIcon, AccessibilityView.Raw);

        var filterGrid = new Grid
        {
            MaxWidth = FilterMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        filterGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        filterGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(searchIcon, 0);
        Grid.SetColumn(_filterBox, 1);
        filterGrid.Children.Add(searchIcon);
        filterGrid.Children.Add(_filterBox);

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(filterGrid, 0);
        Grid.SetColumn(_freshness, 1);
        header.Children.Add(filterGrid);
        header.Children.Add(_freshness);
        return header;
    }

    private void OnFilterTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        _viewModel.SetFilter(_filterBox.Text ?? string.Empty);
    }

    // ── Render ───────────────────────────────────────────────────────────────────────────────────────

    private void Render()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _bodyHost.Child = _viewModel.State switch
        {
            LiveSignalsSectionState.Loading => BuildLoading(_viewModel.LoadingLabel),
            LiveSignalsSectionState.Error => BuildError(_viewModel.ErrorMessage, _viewModel.Attempts),
            LiveSignalsSectionState.Empty => BuildEmpty(),
            _ => BuildTable(_viewModel.Display),
        };
    }

    // ── Table ────────────────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildTable(LiveSignalsDisplay display)
    {
        var columns = new[]
        {
            new ColumnSpec(_viewModel.NameHeader, LiveSignalSortKey.Name, new GridLength(1.4, GridUnitType.Star)),
            new ColumnSpec(_viewModel.ValueHeader, null, new GridLength(1, GridUnitType.Star)),
            new ColumnSpec(_viewModel.TimestampHeader, LiveSignalSortKey.Timestamp, new GridLength(TimeColumnWidth)),
        };

        var table = new StackPanel { Spacing = 0 };
        table.Children.Add(BuildHeaderRow(columns));

        if (!display.HasRows)
        {
            table.Children.Add(BuildFilteredEmpty());
            return table;
        }

        var body = new StackPanel { Spacing = 0 };
        foreach (var row in display.Rows)
        {
            body.Children.Add(BuildRow(columns, row));
        }

        table.Children.Add(new ScrollViewer
        {
            Content = body,
            MaxHeight = TableMaxHeight,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        });
        return table;
    }

    private Border BuildHeaderRow(IReadOnlyList<ColumnSpec> columns)
    {
        var grid = NewColumnGrid(columns);
        grid.Padding = new Thickness(8, 4, 8, 6);
        for (int i = 0; i < columns.Count; i++)
        {
            var column = columns[i];
            UIElement cell = column.SortKey is { } key
                ? BuildSortHeader(column.Header, key)
                : new TextBlock
                {
                    Text = column.Header,
                    FontSize = 11,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = DisplayTokens.TextMuted,
                    CharacterSpacing = 40,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    TextWrapping = TextWrapping.NoWrap,
                    VerticalAlignment = VerticalAlignment.Center,
                };
            Grid.SetColumn((FrameworkElement)cell, i);
            grid.Children.Add(cell);
        }

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
    }

    private TsButton BuildSortHeader(string label, LiveSignalSortKey key)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = label,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        if (_viewModel.SortKey == key)
        {
            button.IconGlyph = _viewModel.SortDir == LiveSignalSortDirection.Ascending ? SortAscGlyph : SortDescGlyph;
        }

        AutomationProperties.SetName(button, label);
        button.Click += (_, _) => _viewModel.ToggleSort(key);
        return button;
    }

    private static Border BuildRow(IReadOnlyList<ColumnSpec> columns, LiveSignalDisplayRow row)
    {
        var name = new TextBlock
        {
            Text = row.Name,
            FontSize = 13,
            FontFamily = MonoFont,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var value = new TextBlock
        {
            Text = row.ValueDisplay,
            FontSize = 12,
            FontFamily = MonoFont,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        UIElement updated = row.Timestamp is { } ts
            ? new TsDateTime
            {
                Value = ts,
                Variant = DateTimeVariant.Relative,
                VerticalAlignment = VerticalAlignment.Center,
            }
            : new TextBlock
            {
                Text = LiveSignalRow.EmDash,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };

        var grid = NewColumnGrid(columns);
        grid.Padding = new Thickness(8, 6, 8, 6);
        grid.MinHeight = 38;
        var cells = new UIElement[] { name, value, updated };
        for (int i = 0; i < cells.Length && i < columns.Count; i++)
        {
            Grid.SetColumn((FrameworkElement)cells[i], i);
            grid.Children.Add(cells[i]);
        }

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private TextBlock BuildFilteredEmpty()
    {
        var block = new TextBlock
        {
            Text = _viewModel.FilteredEmptyMessage,
            FontSize = 13,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(12, 24, 12, 24),
        };
        LiveRegion.Configure(block);
        LiveRegion.Announce(block);
        return block;
    }

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildLoading(string announce)
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(0, 4, 0, 4) };
        for (int i = 0; i < LoadingSkeletonRows; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, announce);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError(string? message, int attempts)
    {
        var error = new TsQueryError
        {
            Message = message ?? _localizer.GetString("admin.liveSignals.error", "Couldn't load live signals"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.EmptyTitle,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Table primitives ─────────────────────────────────────────────────────────────────────────────

    private static FontFamily MonoFont => new("Consolas");

    private static Grid NewColumnGrid(IReadOnlyList<ColumnSpec> columns)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        foreach (var column in columns)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = column.Width });
        }

        return grid;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new LiveSignalsTableAutomationPeer(this);

    private sealed class LiveSignalsTableAutomationPeer(LiveSignalsTable owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.DataGrid;
    }

    private readonly record struct ColumnSpec(string Header, LiveSignalSortKey? SortKey, GridLength Width);
}
