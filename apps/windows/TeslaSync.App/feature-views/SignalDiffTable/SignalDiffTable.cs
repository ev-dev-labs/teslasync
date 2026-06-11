using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Signal Diff table surface — a parity port of
/// web/src/features/telemetry/components/SignalDiffTable.tsx. It renders the server-side diff between two
/// point-in-time snapshots for one vehicle as a selectable, pinned-first table: a leading multi-select
/// checkbox column, a per-row pin toggle, the signal name, the Window A / Window B values, a coloured Δ
/// (numeric delta + percent, or the amber "changed" chip for non-numeric differences), and the L1/L2/LOG/STALE
/// source-layer badge for each window. Above the header sits the legend with the Δ and source-layer help
/// tooltips and a data-freshness chip. Every state renders — loading skeleton, populated table, the friendly
/// "No differences between the two snapshots" empty surface, a filtered-empty in-table message, an explicit
/// retry surface on hard failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="SignalDiffTableViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SignalDiffTable : ContentControl, IDisposable
{
    private const string PinGlyph = "\uE718";          // Segoe Fluent — Pin
    private const string UnpinGlyph = "\uE77A";        // Segoe Fluent — UnPin
    private const double SelectColumnWidth = 44;
    private const double PinColumnWidth = 40;
    private const double DeltaColumnWidth = 132;
    private const double SourceColumnWidth = 64;
    private const double TableMaxHeight = 560;
    private const int LoadingSkeletonRows = 6;

    private readonly SignalDiffTableViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SignalDiffTableDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();
    private readonly CheckBox _selectAll = new() { Width = SelectColumnWidth, IsThreeState = true };
    private readonly Dictionary<string, CheckBox> _rowChecks = new(StringComparer.Ordinal);

    private bool _started;
    private bool _renderQueued;
    private bool _syncingSelection;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, the vehicle id, localizer and diagnostics.</summary>
    public SignalDiffTable(
        ISignalDiffTableSource source,
        long vehicleId,
        ILocalizer localizer,
        SignalDiffTableDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SignalDiffTableDiagnostics();
        _viewModel = new SignalDiffTableViewModel(source, vehicleId, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        _selectAll.Checked += OnSelectAllToggled;
        _selectAll.Unchecked += OnSelectAllToggled;
        AutomationProperties.SetName(_selectAll, _localizer.GetString("signalDiff.selectAll", "Select all signals"));

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

    /// <summary>The canonical surface id (<c>signal-diff-table</c>).</summary>
    public static string SurfaceId => SignalDiffTableRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SignalDiffTableViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SignalDiffTableSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static SignalDiffTable Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long vehicleId,
        ILocalizer localizer,
        SignalDiffTableDiagnostics? diagnostics = null)
    {
        var source = new SignalDiffTableSource(api, engine, options);
        return new SignalDiffTable(source, vehicleId, localizer, diagnostics);
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
        _selectAll.Checked -= OnSelectAllToggled;
        _selectAll.Unchecked -= OnSelectAllToggled;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        // Selection-only changes update the checkbox visuals in place; everything else (state, projected
        // rows after a load / filter / pin re-sort, freshness) rebuilds the coalesced body.
        if (e.PropertyName is nameof(SignalDiffTableViewModel.SelectedSignals)
            or nameof(SignalDiffTableViewModel.SelectedCount))
        {
            EnqueueOnUi(UpdateSelectionVisuals);
        }
        else
        {
            ScheduleRender();
        }
    }

    private void EnqueueOnUi(Action action)
    {
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        EnqueueOnUi(RenderCoalesced);
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    // ── Persistent header (legend + freshness; built once) ───────────────────────────────────────────────

    private Grid BuildHeader()
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };
        legend.Children.Add(BuildLegendItem(_viewModel.LegendDelta, _viewModel.DeltaHelp, _viewModel.DeltaAria));
        legend.Children.Add(BuildLegendItem(_viewModel.LegendSource, _viewModel.SourceHelp, _viewModel.SourceAria));

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(legend, 0);
        Grid.SetColumn(_freshness, 1);
        header.Children.Add(legend);
        header.Children.Add(_freshness);
        return header;
    }

    private static StackPanel BuildLegendItem(string label, string hint, string ariaLabel)
    {
        var text = new TextBlock
        {
            Text = label,
            FontSize = 11,
            FontFamily = MonoFont,
            CharacterSpacing = 40,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var help = new TsHelpTooltip { Hint = hint, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(help, ariaLabel);

        var item = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        item.Children.Add(text);
        item.Children.Add(help);
        return item;
    }

    // ── Render ───────────────────────────────────────────────────────────────────────────────────────

    private void Render()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _rowChecks.Clear();
        _bodyHost.Child = _viewModel.State switch
        {
            SignalDiffSectionState.Loading => BuildLoading(),
            SignalDiffSectionState.Error => BuildError(),
            SignalDiffSectionState.Empty => BuildEmpty(),
            _ => BuildTable(_viewModel.Display),
        };

        UpdateSelectionVisuals();
    }

    // ── Table ────────────────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildTable(SignalDiffDisplay display)
    {
        var table = new StackPanel { Spacing = 0 };
        table.Children.Add(BuildHeaderRow());

        if (!display.HasRows)
        {
            table.Children.Add(BuildFilteredEmpty());
            return table;
        }

        var body = new StackPanel { Spacing = 0 };
        foreach (var row in display.Rows)
        {
            body.Children.Add(BuildRow(row));
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

    private Border BuildHeaderRow()
    {
        var grid = NewColumnGrid();
        grid.Padding = new Thickness(8, 4, 8, 6);

        Place(grid, _selectAll, 0);
        Place(grid, new Border { Width = PinColumnWidth }, 1);
        Place(grid, HeaderText(_viewModel.SignalHeader, TextAlignment.Left), 2);
        Place(grid, HeaderText(_viewModel.WindowAHeader, TextAlignment.Right), 3);
        Place(grid, HeaderText(_viewModel.WindowBHeader, TextAlignment.Right), 4);
        Place(grid, HeaderText(_viewModel.DeltaHeader, TextAlignment.Right), 5);
        Place(grid, HeaderText(_viewModel.SourceAHeader, TextAlignment.Center), 6);
        Place(grid, HeaderText(_viewModel.SourceBHeader, TextAlignment.Center), 7);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
    }

    private Border BuildRow(SignalDiffDisplayRow row)
    {
        var grid = NewColumnGrid();
        grid.Padding = new Thickness(8, 6, 8, 6);
        grid.MinHeight = 38;

        Place(grid, BuildRowCheck(row.Name), 0);
        Place(grid, BuildPinButton(row), 1);
        Place(grid, MonoCell(row.Name, DisplayTokens.TextPrimary, TextAlignment.Left), 2);
        Place(grid, MonoCell(row.DisplayA, DisplayTokens.TextSecondary, TextAlignment.Right), 3);
        Place(grid, MonoCell(row.DisplayB, DisplayTokens.TextPrimary, TextAlignment.Right), 4);
        Place(grid, BuildDeltaCell(row), 5);
        Place(grid, BuildSourceBadge(row.SourceA, row.AgeMsA), 6);
        Place(grid, BuildSourceBadge(row.SourceB, row.AgeMsB), 7);

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private CheckBox BuildRowCheck(string signal)
    {
        var check = new CheckBox
        {
            Width = SelectColumnWidth,
            MinWidth = SelectColumnWidth,
            IsChecked = _viewModel.IsSelected(signal),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(check, $"{_localizer.GetString("signalDiff.selectRow", "Select")} {signal}");
        check.Checked += (_, _) => OnRowCheckToggled(signal, true);
        check.Unchecked += (_, _) => OnRowCheckToggled(signal, false);
        _rowChecks[signal] = check;
        return check;
    }

    private ToggleButton BuildPinButton(SignalDiffDisplayRow row)
    {
        string label = row.IsPinned ? _viewModel.UnpinLabel : _viewModel.PinLabel;
        var button = new ToggleButton
        {
            Width = PinColumnWidth,
            MinWidth = PinColumnWidth,
            Padding = new Thickness(0),
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            IsChecked = row.IsPinned,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Content = new FontIcon
            {
                Glyph = row.IsPinned ? UnpinGlyph : PinGlyph,
                FontSize = 14,
                Foreground = row.IsPinned ? DisplayTokens.Brush("TsColorWarningBrush") : DisplayTokens.TextMuted,
            },
        };
        AutomationProperties.SetName(button, label);
        ToolTipService.SetToolTip(button, label);
        button.Click += (_, _) => _viewModel.TogglePin(row.Name);
        return button;
    }

    private static TextBlock BuildDeltaCell(SignalDiffDisplayRow row)
    {
        return new TextBlock
        {
            Text = row.DeltaText,
            FontSize = 12,
            FontFamily = MonoFont,
            Foreground = DeltaBrush(row.DeltaTone),
            HorizontalAlignment = HorizontalAlignment.Right,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
    }

    private static Brush DeltaBrush(SignalDiffDeltaTone tone) => tone switch
    {
        SignalDiffDeltaTone.Positive => DisplayTokens.Brush("TsColorSuccessBrush"),
        SignalDiffDeltaTone.Negative => DisplayTokens.Brush("TsColorDangerBrush"),
        SignalDiffDeltaTone.Changed => DisplayTokens.Brush("TsColorWarningBrush"),
        _ => DisplayTokens.TextMuted,
    };

    private static TsSourceLayerBadge BuildSourceBadge(string? source, double? ageMs)
    {
        var badge = new TsSourceLayerBadge
        {
            Source = source ?? string.Empty,
            AgeMs = ageMs ?? double.NaN,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        return badge;
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

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(0, 4, 0, 4) };
        for (int i = 0; i < LoadingSkeletonRows; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("signalDiff.error", "Failed to load diff"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Selection ────────────────────────────────────────────────────────────────────────────────────

    private void OnRowCheckToggled(string signal, bool selected)
    {
        if (_syncingSelection)
        {
            return;
        }

        if (_viewModel.IsSelected(signal) != selected)
        {
            _viewModel.ToggleSelection(signal);
        }
    }

    private void OnSelectAllToggled(object sender, RoutedEventArgs e)
    {
        if (_syncingSelection)
        {
            return;
        }

        if (_selectAll.IsChecked == true)
        {
            _viewModel.SelectAllVisible();
        }
        else
        {
            _viewModel.ClearSelection();
        }
    }

    private void UpdateSelectionVisuals()
    {
        _syncingSelection = true;
        try
        {
            int visible = 0;
            int selected = 0;
            foreach (var row in _viewModel.Display.Rows)
            {
                visible++;
                bool isSelected = _viewModel.IsSelected(row.Name);
                if (isSelected)
                {
                    selected++;
                }

                if (_rowChecks.TryGetValue(row.Name, out var check) && (check.IsChecked == true) != isSelected)
                {
                    check.IsChecked = isSelected;
                }
            }

            _selectAll.IsChecked = visible == 0 || selected == 0
                ? (selected == 0 ? false : (bool?)null)
                : selected == visible ? true : (bool?)null;
        }
        finally
        {
            _syncingSelection = false;
        }
    }

    // ── Table primitives ─────────────────────────────────────────────────────────────────────────────

    private static FontFamily MonoFont => new("Consolas");

    private static TextBlock HeaderText(string text, TextAlignment align) => new()
    {
        Text = text,
        FontSize = 11,
        FontWeight = FontWeights.SemiBold,
        Foreground = DisplayTokens.TextMuted,
        CharacterSpacing = 40,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        VerticalAlignment = VerticalAlignment.Center,
        TextAlignment = align,
        HorizontalAlignment = align == TextAlignment.Right
            ? HorizontalAlignment.Right
            : align == TextAlignment.Center
                ? HorizontalAlignment.Center
                : HorizontalAlignment.Left,
    };

    private static TextBlock MonoCell(string text, Brush foreground, TextAlignment align) => new()
    {
        Text = text,
        FontSize = 12,
        FontFamily = MonoFont,
        Foreground = foreground,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        VerticalAlignment = VerticalAlignment.Center,
        TextAlignment = align,
        HorizontalAlignment = align == TextAlignment.Right ? HorizontalAlignment.Right : HorizontalAlignment.Left,
    };

    private static Grid NewColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SelectColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(PinColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(DeltaColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SourceColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SourceColumnWidth) });
        return grid;
    }

    private static void Place(Grid grid, FrameworkElement element, int column)
    {
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new SignalDiffTableAutomationPeer(this);

    private sealed class SignalDiffTableAutomationPeer(SignalDiffTable owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.DataGrid;
    }
}
