using System.Collections.Generic;
using System.Linq;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Full-featured tabular grid (mirrors the web <c>DataTable</c>). Renders a
/// declarative <see cref="TsDataColumn"/> set over loosely-typed
/// <see cref="TsDataRow"/> records and composes the supporting primitives:
/// keyboard-operable column sorting (<see cref="TableSortState"/>), tri-state
/// row selection with a bulk action bar (<see cref="TableSelectionState{TKey}"/>),
/// per-row expansion drawers, live column resizing
/// (<see cref="TsDataTableResizer"/>), a column chooser
/// (<see cref="TsDataTableColumnsMenu"/>), and paging (<see cref="PaginationState"/>
/// via <see cref="TsPagination"/>). All user-facing strings are consumer-supplied.
/// </summary>
public partial class TsDataTable : ContentControl
{
    private const double SelectColumnWidth = 44;
    private const double ExpandColumnWidth = 36;

    private readonly TableSortState _sort = new();
    private readonly TableSelectionState<object> _selection = new();
    private readonly PaginationState _pagination = new();

    private readonly TsDataTableBulkBar _bulkBar = new();
    private readonly TsDataTableColumnsMenu _columnsMenu = new();
    private readonly StackPanel _headerRow = new() { Orientation = Orientation.Horizontal };
    private readonly StackPanel _bodyPanel = new() { Orientation = Orientation.Vertical };
    private readonly TsPagination _pager = new();
    private readonly CheckBox _selectAll = new() { Width = SelectColumnWidth, IsThreeState = true };
    private readonly TextBlock _emptyState = new() { Visibility = Visibility.Collapsed, Margin = new Thickness(12) };

    private IReadOnlyList<TsDataRow> _allRows = [];
    private IReadOnlyList<TsDataRow> _sortedRows = [];

    public static readonly DependencyProperty ColumnsProperty = DependencyProperty.Register(
        nameof(Columns), typeof(IReadOnlyList<TsDataColumn>), typeof(TsDataTable),
        new PropertyMetadata(null, OnColumnsChanged));

    public static readonly DependencyProperty RowsProperty = DependencyProperty.Register(
        nameof(Rows), typeof(IReadOnlyList<TsDataRow>), typeof(TsDataTable),
        new PropertyMetadata(null, OnRowsChanged));

    public static readonly DependencyProperty PageSizeProperty = DependencyProperty.Register(
        nameof(PageSize), typeof(int), typeof(TsDataTable),
        new PropertyMetadata(25, OnRowsChanged));

    public static readonly DependencyProperty SelectableProperty = DependencyProperty.Register(
        nameof(Selectable), typeof(bool), typeof(TsDataTable),
        new PropertyMetadata(true, OnStructureChanged));

    public static readonly DependencyProperty ExpandableProperty = DependencyProperty.Register(
        nameof(Expandable), typeof(bool), typeof(TsDataTable),
        new PropertyMetadata(false, OnStructureChanged));

    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsDataTable),
        new PropertyMetadata(null, OnStructureChanged));

    public TsDataTable()
    {
        IsTabStop = false;
        DefaultStyleKey = typeof(TsDataTable);

        _selectAll.Checked += (s, e) => OnSelectAllToggled(true);
        _selectAll.Unchecked += (s, e) => OnSelectAllToggled(false);
        _bulkBar.SelectionCleared += (s, e) => ClearSelection();
        _pager.PageChanged += (s, e) =>
        {
            _pagination.Page = e;
            RenderRows();
        };

        var topBar = new Grid();
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_bulkBar, 0);
        Grid.SetColumn(_columnsMenu, 1);
        topBar.Children.Add(_bulkBar);
        topBar.Children.Add(_columnsMenu);

        var bodyScroller = new ScrollViewer
        {
            Content = _bodyPanel,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        };

        var root = new StackPanel { Spacing = 8 };
        root.Children.Add(topBar);
        root.Children.Add(_headerRow);
        root.Children.Add(_emptyState);
        root.Children.Add(bodyScroller);
        root.Children.Add(_pager);
        Content = root;
    }

    /// <summary>Raised when the selected-row set changes.</summary>
    public event EventHandler<IReadOnlyCollection<object>>? SelectionChanged;

    /// <summary>Raised when a column's sort direction changes.</summary>
    public event EventHandler? SortChanged;

    public IReadOnlyList<TsDataColumn>? Columns
    {
        get => (IReadOnlyList<TsDataColumn>?)GetValue(ColumnsProperty);
        set => SetValue(ColumnsProperty, value);
    }

    public IReadOnlyList<TsDataRow>? Rows
    {
        get => (IReadOnlyList<TsDataRow>?)GetValue(RowsProperty);
        set => SetValue(RowsProperty, value);
    }

    public int PageSize
    {
        get => (int)GetValue(PageSizeProperty);
        set => SetValue(PageSizeProperty, value);
    }

    public bool Selectable
    {
        get => (bool)GetValue(SelectableProperty);
        set => SetValue(SelectableProperty, value);
    }

    public bool Expandable
    {
        get => (bool)GetValue(ExpandableProperty);
        set => SetValue(ExpandableProperty, value);
    }

    /// <summary>Localized message shown when there are no rows.</summary>
    public string? EmptyMessage
    {
        get => (string?)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    /// <summary>Currently selected row keys.</summary>
    public IReadOnlyCollection<object> SelectedKeys => _selection.SelectedKeys;

    private static void OnColumnsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var table = (TsDataTable)d;
        if (e.OldValue is IReadOnlyList<TsDataColumn> oldColumns)
        {
            foreach (var column in oldColumns)
            {
                column.Changed -= table.OnColumnChanged;
            }
        }

        if (e.NewValue is IReadOnlyList<TsDataColumn> newColumns)
        {
            foreach (var column in newColumns)
            {
                column.Changed += table.OnColumnChanged;
            }
        }

        table._columnsMenu.Columns = table.Columns;
        table.RebuildHeader();
        table.RenderRows();
    }

    private static void OnRowsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var table = (TsDataTable)d;
        table._allRows = table.Rows ?? [];
        table._pagination.PageSize = table.PageSize;
        table.Resort();
    }

    private static void OnStructureChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var table = (TsDataTable)d;
        table.RebuildHeader();
        table.RenderRows();
    }

    private void OnColumnChanged(object? sender, EventArgs e)
    {
        if (sender is TsDataColumn column && !column.IsVisible)
        {
            RebuildHeader();
            RenderRows();
        }
    }

    private IReadOnlyList<TsDataColumn> VisibleColumns =>
        Columns?.Where(c => c.IsVisible).ToList() ?? [];

    private void Resort()
    {
        if (_sort.Column is null)
        {
            _sortedRows = _allRows;
        }
        else
        {
            var key = _sort.Column;
            _sortedRows = _sort.Apply(_allRows, row => row.ValueFor(key));
        }

        _pagination.Total = _sortedRows.Count;
        RenderRows();
    }

    private void RebuildHeader()
    {
        _headerRow.Children.Clear();

        if (Selectable)
        {
            _headerRow.Children.Add(_selectAll);
        }

        if (Expandable)
        {
            _headerRow.Children.Add(new Border { Width = ExpandColumnWidth });
        }

        foreach (var column in VisibleColumns)
        {
            _headerRow.Children.Add(BuildHeaderCell(column));
        }
    }

    private Grid BuildHeaderCell(TsDataColumn column)
    {
        var sortButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Text = column.Header ?? column.Key,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            IsEnabled = column.CanSort,
        };
        UpdateSortGlyph(sortButton, column);
        sortButton.Click += (s, e) =>
        {
            if (!column.CanSort)
            {
                return;
            }

            _sort.Toggle(column.Key);
            RebuildHeader();
            Resort();
            SortChanged?.Invoke(this, EventArgs.Empty);
        };

        var cell = new Grid();
        cell.Children.Add(sortButton);

        if (column.CanResize)
        {
            var resizer = new TsDataTableResizer
            {
                Column = column,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            cell.Children.Add(resizer);
        }

        BindWidth(cell, column);
        return cell;
    }

    private void UpdateSortGlyph(TsButton button, TsDataColumn column)
    {
        button.IconGlyph = _sort.DirectionFor(column.Key) switch
        {
            SortDirection.Ascending => "\uE70E",
            SortDirection.Descending => "\uE70D",
            _ => null,
        };
    }

    private void RenderRows()
    {
        _bodyPanel.Children.Clear();
        _pagination.PageSize = PageSize;

        var page = _pagination.Slice(_sortedRows);
        _emptyState.Text = EmptyMessage ?? string.Empty;
        _emptyState.Visibility = _sortedRows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        foreach (var row in page)
        {
            _bodyPanel.Children.Add(BuildRow(row));
        }

        _pager.PageSize = PageSize;
        _pager.TotalItems = _sortedRows.Count;
        _pager.Page = _pagination.Page;

        UpdateSelectionVisuals();
    }

    private StackPanel BuildRow(TsDataRow row)
    {
        var rowLine = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            IsTabStop = true,
        };
        AutomationProperties.SetAccessibilityView(rowLine, AccessibilityView.Content);

        if (Selectable)
        {
            var check = new CheckBox { Width = SelectColumnWidth, IsChecked = _selection.IsSelected(row.Key) };
            check.Checked += (s, e) => SetRowSelected(row, true);
            check.Unchecked += (s, e) => SetRowSelected(row, false);
            rowLine.Children.Add(check);
        }

        ToggleButton? expandToggle = null;
        var detail = new ContentPresenter
        {
            Content = row.ExpansionContent,
            Visibility = row.IsExpanded ? Visibility.Visible : Visibility.Collapsed,
            Margin = new Thickness(SelectColumnWidth, 0, 0, 8),
        };

        if (Expandable)
        {
            expandToggle = new ToggleButton
            {
                Width = ExpandColumnWidth,
                Content = new FontIcon { Glyph = "\uE76C", FontSize = 12 },
                IsChecked = row.IsExpanded,
            };
            expandToggle.Checked += (s, e) => SetRowExpanded(row, detail, true);
            expandToggle.Unchecked += (s, e) => SetRowExpanded(row, detail, false);
            rowLine.Children.Add(expandToggle);
        }

        foreach (var column in VisibleColumns)
        {
            rowLine.Children.Add(BuildCell(row, column));
        }

        rowLine.KeyDown += (s, e) => OnRowKeyDown(e, row, detail, expandToggle);

        var container = new StackPanel { Orientation = Orientation.Vertical };
        container.Children.Add(rowLine);
        if (Expandable)
        {
            container.Children.Add(detail);
        }

        return container;
    }

    private static Border BuildCell(TsDataRow row, TsDataColumn column)
    {
        var value = row.ValueFor(column.Key);
        var text = new TextBlock
        {
            Text = value?.ToString() ?? "\u2014",
            Padding = new Thickness(8, 6, 8, 6),
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = column.IsNumeric ? HorizontalAlignment.Right : HorizontalAlignment.Left,
        };
        var cell = new Border { Child = text };
        BindWidth(cell, column);
        return cell;
    }

    private static void BindWidth(FrameworkElement element, TsDataColumn column)
    {
        element.SetBinding(FrameworkElement.WidthProperty, new Binding
        {
            Source = column,
            Path = new PropertyPath(nameof(TsDataColumn.Width)),
            Mode = BindingMode.OneWay,
        });
    }

    private void OnRowKeyDown(KeyRoutedEventArgs e, TsDataRow row, ContentPresenter detail, ToggleButton? expandToggle)
    {
        if (e.Key == Windows.System.VirtualKey.Space && Selectable)
        {
            e.Handled = true;
            SetRowSelected(row, !_selection.IsSelected(row.Key));
            UpdateSelectionVisuals();
        }
        else if (e.Key == Windows.System.VirtualKey.Enter && Expandable)
        {
            e.Handled = true;
            var next = !row.IsExpanded;
            SetRowExpanded(row, detail, next);
            if (expandToggle is not null)
            {
                expandToggle.IsChecked = next;
            }
        }
    }

    private void SetRowSelected(TsDataRow row, bool selected)
    {
        _selection.Set(row.Key, selected);
        UpdateSelectionVisuals();
        SelectionChanged?.Invoke(this, _selection.SelectedKeys);
    }

    private static void SetRowExpanded(TsDataRow row, ContentPresenter detail, bool expanded)
    {
        row.IsExpanded = expanded;
        detail.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnSelectAllToggled(bool selected)
    {
        var universe = _sortedRows.Select(r => r.Key).ToList();
        if (selected)
        {
            _selection.SelectAll(universe);
        }
        else
        {
            _selection.Clear();
        }

        RenderRows();
        SelectionChanged?.Invoke(this, _selection.SelectedKeys);
    }

    private void ClearSelection()
    {
        _selection.Clear();
        RenderRows();
        SelectionChanged?.Invoke(this, _selection.SelectedKeys);
    }

    private void UpdateSelectionVisuals()
    {
        var universe = _sortedRows.Select(r => r.Key).ToList();
        _selectAll.Visibility = Selectable ? Visibility.Visible : Visibility.Collapsed;

        if (_selection.IsIndeterminate(universe))
        {
            _selectAll.IsChecked = null;
        }
        else
        {
            _selectAll.IsChecked = _selection.AllSelected(universe);
        }

        _bulkBar.SelectedCount = _selection.Count;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new TsDataTableAutomationPeer(this);

    private sealed class TsDataTableAutomationPeer(TsDataTable owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.DataGrid;
    }
}
