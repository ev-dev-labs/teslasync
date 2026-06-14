using System;
using System.Buffers;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SignalDiff;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The native WinUI 3 <c>SignalDiffPage</c> — a parity port of the web page
/// web/src/features/telemetry/pages/SignalDiffPage.tsx (route <c>/signal-diff</c>, nav name <c>Signal Diff</c>). The
/// web page composes the shared <see cref="SignalCompareControls"/> + <c>SignalDiffTable</c> +
/// <see cref="BulkActionsToolbar"/> inside a <c>PageContainer</c>; this view reproduces the whole tree natively: it
/// mounts the shared <see cref="SharedSurfaces.PageContainer"/> (title + subtitle + the "Share" copy-link) whose body
/// holds the <see cref="SignalCompareControls"/> bar (with the page-local vehicle picker in its top slot), the four
/// diff stat cards (Changed-signals / Visible-after-filter / Pinned / Window-span), the shared
/// <see cref="BulkActionsToolbar"/> (Pin / Unpin / Copy CSV / Add-as-alert), and the diff <see cref="TsGlassPanel"/>
/// with its load-failed banner, loading skeleton, no-changes empty, selectable pinned-first rows, and pinned-chips
/// footer. The view is a thin renderer: every label, value, data-state and section-visibility flag flows from the
/// view-model's <see cref="SignalDiffPageDisplay"/> projection; state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SignalDiffPage : UserControl, IDisposable
{
    private const double SectionSpacing = 20;
    private const string PinGlyph = "\uE718";          // Segoe Fluent — Pin
    private const string UnpinGlyph = "\uE77A";        // Segoe Fluent — UnPin
    private const string CompareGlyph = "\uE8AB";      // Segoe Fluent — switch/compare
    private const string BellGlyph = "\uEA8F";         // Segoe Fluent — Ringer/alert
    private const string CopyGlyph = "\uE8C8";         // Segoe Fluent — Copy
    private const string ShareLinkUri = "teslasync://signal-diff";
    private const double SelectColumnWidth = 40;
    private const double PinColumnWidth = 36;
    private const double SourceColumnWidth = 64;

    private static readonly SearchValues<char> CsvSpecialChars = SearchValues.Create(",\"\n\r");

    private readonly SignalDiffPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SharedSurfaces.PageContainer _container;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    // ── Vehicle picker (SignalCompareControls top slot) ─────────────────────────────────────────
    private readonly SignalCompareControls _compareControls;
    private readonly Caption _vehicleLabel = new();
    private readonly TsSelect _vehicleSelect = new() { MinWidth = 220 };
    private bool _suppressVehicle;
    private string _vehicleOptionsKey = string.Empty;

    // ── Stat cards (panels 1-4) ─────────────────────────────────────────────────────────────────
    private readonly TsStatCard _statChanged = new() { Glyph = CompareGlyph };
    private readonly TsStatCard _statVisible = new();
    private readonly TsStatCard _statPinned = new() { Glyph = PinGlyph };
    private readonly TsStatCard _statWindowSpan = new();

    // ── Bulk-actions toolbar (shared surface) ───────────────────────────────────────────────────
    private readonly BulkActionsToolbar _bulkToolbar;

    // ── Diff panel (panel 5: GlassPanel5) ───────────────────────────────────────────────────────
    private readonly TsAlertBanner _errorBanner = new()
    {
        Variant = CalloutVariant.Danger,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsGlassPanel _diffPanel = new() { Padding = new Thickness(18) };
    private readonly Grid _diffBodyHost = new();
    private readonly StackPanel _diffLoadingHost = new() { Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly StackPanel _diffEmptyHost = new()
    {
        Spacing = 8,
        Padding = new Thickness(0, 40, 0, 40),
        HorizontalAlignment = HorizontalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly FontIcon _diffEmptyIcon = new() { Glyph = CompareGlyph, FontSize = 28, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly HelperText _diffEmptyText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly StackPanel _diffRowsHost = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _diffHeader = new();
    private readonly StackPanel _diffRowsBody = new();
    private readonly HelperText _filteredEmptyText = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        Visibility = Visibility.Collapsed,
        Margin = new Thickness(0, 24, 0, 24),
    };

    private readonly CheckBox _selectAll = new() { Width = SelectColumnWidth, IsThreeState = true };
    private readonly Dictionary<string, CheckBox> _rowChecks = new(StringComparer.Ordinal);

    private readonly StackPanel _pinnedChipsHost = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        Visibility = Visibility.Collapsed,
    };

    private readonly Caption _pinnedChipsLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _pinnedChipsItems = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsCopyLinkButton _shareLink = new()
    {
        LinkText = ShareLinkUri,
        VerticalAlignment = VerticalAlignment.Center,
    };

    /// <summary>Creates the page over the default no-backend feed and the shell resource localizer.</summary>
    public SignalDiffPage()
        : this(EmptySignalDiffPageFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The Signal Diff data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The initially-selected vehicle id (web URL <c>vehicle</c> param); 0 = auto-pick first.</param>
    public SignalDiffPage(ISignalDiffPageFeed feed, ILocalizer localizer, long vehicleId = 0)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new SignalDiffPageViewModel(feed, localizer, vehicleId);
        _compareControls = new SignalCompareControls(localizer);
        _bulkToolbar = new BulkActionsToolbar(BuildBulkActions(), localizer);

        BuildContent();

        _container = new SharedSurfaces.PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            Actions = BuildActions(),
            PageContent = _root,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);
        Content = _container;

        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _compareControls.WindowAChanged += OnWindowAChanged;
        _compareControls.WindowBChanged += OnWindowBChanged;
        _compareControls.SearchChanged += OnSearchChanged;
        _compareControls.CategoryChanged += OnCategoryChanged;
        _bulkToolbar.SelectionCleared += OnSelectionCleared;
        _selectAll.Click += OnSelectAllClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when a bulk affordance requests navigation (web router push), e.g. "Add as alert rule".</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The navigation route name the shell page factory registers this surface under (<c>SignalDiff</c>).</summary>
    public static string RouteName => SignalDiffPageRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>SignalDiffPage</c>).</summary>
    public static string Slug => SignalDiffPageRegistration.Slug;

    private void BuildContent()
    {
        _compareControls.TopSlot = BuildVehiclePicker();
        _compareControls.Model = new SignalCompareControlsModel(
            _viewModel.WindowAInput,
            _viewModel.WindowBInput,
            string.Empty,
            null);

        _root.Children.Add(_compareControls);
        _root.Children.Add(BuildStats());
        _root.Children.Add(_bulkToolbar);
        _root.Children.Add(_errorBanner);
        BuildDiffPanel();
        _root.Children.Add(_diffPanel);
    }

    private BulkAction[] BuildBulkActions()
    {
        var display = _viewModel.Display;
        return
        [
            new BulkAction("pin", display.BulkPinLabel, _ => _viewModel.BulkTogglePinAsync(true), iconGlyph: PinGlyph),
            new BulkAction("unpin", display.BulkUnpinLabel, _ => _viewModel.BulkTogglePinAsync(false), iconGlyph: UnpinGlyph),
            new BulkAction("csv", display.BulkCsvLabel, _ => { CopySelectionCsv(); return Task.CompletedTask; }, iconGlyph: CopyGlyph),
            new BulkAction("alert", display.BulkAddAlertLabel, _ => { RaiseAlertNavigation(); return Task.CompletedTask; }, iconGlyph: BellGlyph),
        ];
    }

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_shareLink);
        return actions;
    }

    private StackPanel BuildVehiclePicker()
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(_vehicleLabel);
        _vehicleSelect.HorizontalAlignment = HorizontalAlignment.Left;
        column.Children.Add(_vehicleSelect);
        return column;
    }

    private Grid BuildStats()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Place(grid, _statChanged, 0);
        Place(grid, _statVisible, 1);
        Place(grid, _statPinned, 2);
        Place(grid, _statWindowSpan, 3);
        return grid;
    }

    private void BuildDiffPanel()
    {
        for (int i = 0; i < 6; i++)
        {
            _diffLoadingHost.Children.Add(new TsSkeleton { BlockHeight = 32, Radius = 8 });
        }

        _diffEmptyHost.Children.Add(_diffEmptyIcon);
        _diffEmptyHost.Children.Add(_diffEmptyText);

        BuildDiffHeader();
        _diffRowsHost.Children.Add(_diffHeader);
        _diffRowsHost.Children.Add(_diffRowsBody);
        _diffRowsHost.Children.Add(_filteredEmptyText);

        _diffBodyHost.Children.Add(_diffLoadingHost);
        _diffBodyHost.Children.Add(_diffEmptyHost);
        _diffBodyHost.Children.Add(_diffRowsHost);

        _pinnedChipsHost.Children.Add(_pinnedChipsLabel);
        _pinnedChipsHost.Children.Add(_pinnedChipsItems);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_diffBodyHost);
        body.Children.Add(_pinnedChipsHost);
        _diffPanel.Content = body;
    }

    private void BuildDiffHeader()
    {
        AddDiffColumns(_diffHeader);
        _diffHeader.Padding = new Thickness(8, 6, 8, 6);
        _diffHeader.BorderThickness = new Thickness(0, 0, 0, 1);
        _diffHeader.BorderBrush = TokenBrush("TsColorBorderBrush");

        AutomationProperties.SetName(_selectAll, _localizer.GetString("signalDiff.selectAll", "Select all signals"));
        PlaceDiffCell(_diffHeader, _selectAll, 0);
        PlaceDiffCell(_diffHeader, new Label { Value = string.Empty }, 1);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.signal", "Signal") }, 2);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.valueA", "Window A") }, 3);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.valueB", "Window B") }, 4);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.delta", "\u0394") }, 5);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.sourceA", "Src A") }, 6);
        PlaceDiffCell(_diffHeader, new Label { Value = _localizer.GetString("signalDiff.sourceB", "Src B") }, 7);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private async void OnVehicleSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressVehicle || _vehicleSelect.SelectedItem is not ComboBoxItem { Tag: string value })
        {
            return;
        }

        if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
        {
            await _viewModel.SetVehicleAsync(id).ConfigureAwait(true);
        }
    }

    private void OnWindowAChanged(object? sender, string value) => _viewModel.SetWindowA(value);

    private void OnWindowBChanged(object? sender, string value) => _viewModel.SetWindowB(value);

    private void OnSearchChanged(object? sender, string value) => _viewModel.SetSearch(value);

    private void OnCategoryChanged(object? sender, string? value) => _viewModel.SetCategory(value);

    private void OnSelectionCleared(object? sender, EventArgs e) => _viewModel.ClearSelection();

    private void OnSelectAllClick(object sender, RoutedEventArgs e) =>
        _viewModel.SetSelectAll(_selectAll.IsChecked == true);

    private void RaiseAlertNavigation()
    {
        // web: navigate to /alert-studio?signals=<csv>&from=signal-diff. The shell wires NavigationRequested.
        string csv = string.Join(',', _viewModel.SelectedSignals);
        NavigationRequested?.Invoke(this, "alert-studio?signals=" + Uri.EscapeDataString(csv) + "&from=signal-diff");
    }

    private void CopySelectionCsv()
    {
        var selected = _viewModel.SelectedSignals.ToHashSet(StringComparer.Ordinal);
        if (selected.Count == 0)
        {
            return;
        }

        var rows = _viewModel.VisibleRows.Where(r => selected.Contains(r.Name)).ToArray();
        if (rows.Length == 0)
        {
            return;
        }

        var csv = new StringBuilder();
        csv.Append("signal,window_a,window_b,source_a,source_b\n");
        foreach (var row in rows)
        {
            csv.Append(CsvCell(row.Name)).Append(',')
                .Append(CsvCell(row.DisplayA)).Append(',')
                .Append(CsvCell(row.DisplayB)).Append(',')
                .Append(CsvCell(row.SourceA ?? string.Empty)).Append(',')
                .Append(CsvCell(row.SourceB ?? string.Empty))
                .Append('\n');
        }

        try
        {
            var package = new DataPackage { RequestedOperation = DataPackageOperation.Copy };
            package.SetText(csv.ToString());
            Clipboard.SetContent(package);
        }
        catch (Exception)
        {
            // Clipboard access can fail when the window is not foreground; the export is best-effort (web parity: a toast).
        }
    }

    private void Render(SignalDiffPageDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _shareLink.Label = display.ShareLabel;
        AutomationProperties.SetName(_shareLink, display.ShareLabel);

        RenderVehiclePicker(display);
        RenderStats(display);

        _bulkToolbar.SetSelection(
            _viewModel.SelectedSignals.Select(BulkSelectionId.Text).ToArray(),
            display.DiffDisplay.Rows.Count);

        _errorBanner.Message = display.ErrorMessage;
        _errorBanner.IsOpen = true;
        _errorBanner.Visibility = Show(display.ShowError);

        RenderDiff(display);
        RenderPinnedChips(display);
    }

    private void RenderVehiclePicker(SignalDiffPageDisplay display)
    {
        _vehicleLabel.Value = display.VehicleLabel;
        AutomationProperties.SetName(_vehicleSelect, display.VehicleLabel);

        string key = string.Join('\u001f', display.VehicleOptions.Select(o => o.Value + '\u001e' + o.Label));
        if (!string.Equals(key, _vehicleOptionsKey, StringComparison.Ordinal))
        {
            _vehicleOptionsKey = key;
            _suppressVehicle = true;
            _vehicleSelect.Items.Clear();
            foreach (var option in display.VehicleOptions)
            {
                _vehicleSelect.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Value });
            }

            _suppressVehicle = false;
        }

        _suppressVehicle = true;
        _vehicleSelect.SelectedItem = _vehicleSelect.Items
            .OfType<ComboBoxItem>()
            .FirstOrDefault(i => i.Tag is string v && string.Equals(v, display.SelectedVehicleValue, StringComparison.Ordinal));
        _suppressVehicle = false;
    }

    private void RenderStats(SignalDiffPageDisplay display)
    {
        _statChanged.Label = display.ChangedSignalsLabel;
        _statChanged.Value = display.ChangedSignalsValue;
        _statVisible.Label = display.VisibleLabel;
        _statVisible.Value = display.VisibleValue;
        _statPinned.Label = display.PinnedLabel;
        _statPinned.Value = display.PinnedValue;
        _statWindowSpan.Label = display.WindowSpanLabel;
        _statWindowSpan.Value = display.WindowSpanValue;
    }

    private void RenderDiff(SignalDiffPageDisplay display)
    {
        _diffLoadingHost.Visibility = Show(display.ShowDiffLoading);
        _diffEmptyHost.Visibility = Show(display.ShowDiffEmpty);
        _diffRowsHost.Visibility = Show(display.ShowDiffRows);

        _diffEmptyText.Value = display.NoChangesMessage;
        AutomationProperties.SetName(_diffEmptyHost, display.NoChangesMessage);

        RenderDiffRows(display);
    }

    private void RenderDiffRows(SignalDiffPageDisplay display)
    {
        _diffRowsBody.Children.Clear();
        _rowChecks.Clear();

        var rows = display.DiffDisplay.Rows;
        foreach (var row in rows)
        {
            _diffRowsBody.Children.Add(BuildDiffRow(row));
        }

        bool hasRows = rows.Count > 0;
        bool filteredEmpty = display.ShowDiffRows && !hasRows;
        _filteredEmptyText.Visibility = Show(filteredEmpty);
        _filteredEmptyText.Value = display.FilterActive
            ? _localizer.GetString("signalDiff.tableNoMatches", "No signals match the current filter")
            : _localizer.GetString("signalDiff.tableEmpty", "No differences between the two snapshots");
        _diffRowsBody.Visibility = Show(hasRows);
        _diffHeader.Visibility = Show(hasRows);

        // header select-all tri-state: all visible selected -> checked, some -> indeterminate, none -> unchecked.
        int selectedVisible = rows.Count(r => _viewModel.IsSelected(r.Name));
        _selectAll.IsChecked = hasRows && selectedVisible == rows.Count
            ? true
            : selectedVisible == 0 ? false : null;
    }

    private Border BuildDiffRow(SignalDiffDisplayRow row)
    {
        var grid = new Grid { Padding = new Thickness(8, 6, 8, 6) };
        AddDiffColumns(grid);

        string name = row.Name;
        var check = new CheckBox { Width = SelectColumnWidth, IsChecked = _viewModel.IsSelected(name) };
        AutomationProperties.SetName(check, name);
        check.Click += (_, _) => _viewModel.ToggleSelection(name);
        _rowChecks[name] = check;
        PlaceDiffCell(grid, check, 0);

        bool pinned = row.IsPinned;
        var pin = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = pinned ? UnpinGlyph : PinGlyph,
        };
        AutomationProperties.SetName(pin, (pinned ? UnpinGlyph : PinGlyph) + " " + name);
        pin.Click += async (_, _) => await _viewModel.TogglePinAsync(name, !pinned).ConfigureAwait(true);
        PlaceDiffCell(grid, pin, 1);

        var nameCell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        if (pinned)
        {
            var glyph = new FontIcon { Glyph = PinGlyph, FontSize = 11, VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
            nameCell.Children.Add(glyph);
        }

        nameCell.Children.Add(new Text { Value = name, VerticalAlignment = VerticalAlignment.Center });
        PlaceDiffCell(grid, nameCell, 2);

        PlaceDiffCell(grid, new Text { Value = row.DisplayA, VerticalAlignment = VerticalAlignment.Center }, 3);
        PlaceDiffCell(grid, new Text { Value = row.DisplayB, VerticalAlignment = VerticalAlignment.Center }, 4);

        var delta = new Text { Value = row.DeltaText, VerticalAlignment = VerticalAlignment.Center };
        var brush = DeltaBrush(row.DeltaTone);
        if (brush is not null)
        {
            delta.Foreground = brush;
        }

        PlaceDiffCell(grid, delta, 5);

        PlaceDiffCell(grid, BuildSourceCell(row.SourceA), 6);
        PlaceDiffCell(grid, BuildSourceCell(row.SourceB), 7);

        var border = new Border { Child = grid, BorderThickness = new Thickness(0, 0, 0, 1) };
        border.BorderBrush = TokenBrush("TsColorBorderBrush");
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private static FrameworkElement BuildSourceCell(string? source)
    {
        if (string.IsNullOrEmpty(source))
        {
            return new Caption { Value = SignalDiffRow.EmDash, VerticalAlignment = VerticalAlignment.Center };
        }

        return new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = source.ToUpperInvariant(),
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private void RenderPinnedChips(SignalDiffPageDisplay display)
    {
        _pinnedChipsLabel.Value = display.PinnedChipsLabel;
        _pinnedChipsItems.Children.Clear();
        foreach (var chip in display.PinnedChips)
        {
            _pinnedChipsItems.Children.Add(new TsBadge { Status = StatusKind.Neutral, Content = chip });
        }

        _pinnedChipsHost.Visibility = Show(display.ShowPinnedChips);
    }

    /// <summary>Unsubscribe and dispose the view-model and the IDisposable child surfaces (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _vehicleSelect.SelectionChanged -= OnVehicleSelectionChanged;
        _compareControls.WindowAChanged -= OnWindowAChanged;
        _compareControls.WindowBChanged -= OnWindowBChanged;
        _compareControls.SearchChanged -= OnSearchChanged;
        _compareControls.CategoryChanged -= OnCategoryChanged;
        _bulkToolbar.SelectionCleared -= OnSelectionCleared;
        _selectAll.Click -= OnSelectAllClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _bulkToolbar.Dispose();
        _viewModel.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    private static string CsvCell(string value)
    {
        if (value.AsSpan().IndexOfAny(CsvSpecialChars) < 0)
        {
            return value;
        }

        return "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private static void AddDiffColumns(Grid grid)
    {
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SelectColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(PinColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SourceColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SourceColumnWidth) });
    }

    private static void PlaceDiffCell(Grid grid, FrameworkElement element, int column)
    {
        element.Margin = new Thickness(8, 0, 8, 0);
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static void Place(Grid grid, FrameworkElement element, int column)
    {
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static Brush? DeltaBrush(SignalDiffDeltaTone tone) => tone switch
    {
        SignalDiffDeltaTone.Positive => TokenBrush(StatusResources.AccentBrushKey(StatusKind.Success)),
        SignalDiffDeltaTone.Negative => TokenBrush(StatusResources.AccentBrushKey(StatusKind.Danger)),
        SignalDiffDeltaTone.Changed => TokenBrush(StatusResources.AccentBrushKey(StatusKind.Warning)),
        _ => DisplayTokens.TextMuted,
    };

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SignalDiffPageAutomationPeer(this);

    private sealed class SignalDiffPageAutomationPeer(SignalDiffPage owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
