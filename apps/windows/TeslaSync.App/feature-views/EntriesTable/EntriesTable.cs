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
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.DlqInspector;

/// <summary>
/// The native WinUI 3 <c>EntriesTable</c> feature surface — a parity port of
/// <c>web/src/features/admin/components/dlq-inspector/EntriesTable.tsx</c>. It is a pure presentational control:
/// assign a <see cref="Model"/> (the web <c>rows</c> + <c>loading</c> props) and an <see cref="Inspect"/>
/// callback (the web <c>onInspect</c>) and it renders one of three branches — the sorted, paged table
/// (<see cref="EntriesTableState.Data"/>), the loading body, or the clean-pipeline empty body. The web table
/// uses a <c>Badge</c> for the replayable column and a <c>Button</c> for the actions column; because the shared
/// <c>TsDataTable</c> renders text-only cells, this view composes the table from the same shared primitives
/// (<see cref="TsBadge"/>, <see cref="TsButton"/>, <see cref="TsPagination"/>, <see cref="TsSelect"/>) driven by
/// the WinUI-free <see cref="EntriesTableProjection"/>. Sortable headers, the chronological / locale / numeric
/// sort, and the 25-row pagination mirror the web source. Every string resolves through the i18n facade and
/// every interactive element carries a Narrator name.
/// </summary>
public sealed partial class EntriesTable : ContentControl
{
    private const string SortAscendingGlyph = "\uE70E";
    private const string SortDescendingGlyph = "\uE70D";

    private readonly ILocalizer _localizer;
    private readonly EntriesTableDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private EntriesTableModel _model;
    private Action<DlqEntrySummary>? _inspect;
    private EntriesTableSort _sort = EntriesTableSort.Default;
    private int _pageIndex;
    private int _pageSize = EntriesTablePaging.DefaultPageSize;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, the inspect callback and (optional) seams.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="EntriesTableModel.Empty"/>.</param>
    /// <param name="inspect">The callback invoked with the row entry when its inspect button is pressed.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    public EntriesTable(
        ILocalizer localizer,
        EntriesTableModel? model = null,
        Action<DlqEntrySummary>? inspect = null,
        EntriesTableDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? EntriesTableModel.Empty;
        _inspect = inspect;
        _diagnostics = diagnostics ?? new EntriesTableDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>EntriesTable</c>).</summary>
    public static string Slug => EntriesTableRegistration.Slug;

    /// <summary>The render model (the web <c>rows</c> + <c>loading</c> props); reassigning re-renders from page one.</summary>
    public EntriesTableModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _pageIndex = 0;
            Render();
        }
    }

    /// <summary>The inspect callback (the web <c>onInspect</c>), invoked with the row's source entry.</summary>
    public Action<DlqEntrySummary>? Inspect
    {
        get => _inspect;
        set => _inspect = value;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        var display = EntriesTableProjection.Project(_model, _sort, _clock(), _localizer);

        var table = new StackPanel { Spacing = 0 };
        table.Children.Add(BuildHeader(display));
        table.Children.Add(BuildBody(display));

        var scroller = new ScrollViewer
        {
            Content = table,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        var root = new StackPanel { Spacing = 12 };
        root.Children.Add(scroller);

        if (display.State == EntriesTableState.Data)
        {
            root.Children.Add(BuildFooter(display));
        }

        AutomationProperties.SetName(this, display.AutomationName);
        Content = root;
    }

    // ── Header ──────────────────────────────────────────────────────────────────────────────────────
    private Border BuildHeader(EntriesTableDisplay display)
    {
        var grid = NewRowGrid(display.Columns);
        for (int i = 0; i < display.Columns.Count; i++)
        {
            var cell = BuildHeaderCell(display.Columns[i], display.Sort);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 0, 0, 6),
        };
    }

    private FrameworkElement BuildHeaderCell(EntriesTableColumn column, EntriesTableSort sort)
    {
        if (!column.Sortable)
        {
            return new TextBlock
            {
                Text = column.Header,
                FontFamily = TypographyTokens.Sans,
                FontSize = 12,
                FontWeight = FontWeights.Medium,
                Foreground = DisplayTokens.TextSecondary,
                Padding = new Thickness(8, 4, 8, 4),
                HorizontalAlignment = IsRightAligned(column.Style) ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            };
        }

        bool active = sort.Key == column.Key;
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = column.Header,
            IconGlyph = active ? (sort.Ascending ? SortAscendingGlyph : SortDescendingGlyph) : null,
            HorizontalAlignment = IsRightAligned(column.Style) ? HorizontalAlignment.Right : HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(button, HeaderAutomationName(column.Header, active, sort.Ascending));
        button.Click += (_, _) => OnHeaderClicked(column.Key);
        return button;
    }

    private void OnHeaderClicked(string key)
    {
        _sort = _sort.Toggle(key);
        Render();
    }

    private string HeaderAutomationName(string header, bool active, bool ascending)
    {
        if (!active)
        {
            return _localizer.GetString("a11y.sortableColumn", "{0}, sortable").Replace("{0}", header, StringComparison.Ordinal);
        }

        string direction = ascending
            ? _localizer.GetString("a11y.sortedAscending", "sorted ascending")
            : _localizer.GetString("a11y.sortedDescending", "sorted descending");
        return $"{header}, {direction}";
    }

    // ── Body: rows, or the loading / empty message ──────────────────────────────────────────────────
    private FrameworkElement BuildBody(EntriesTableDisplay display)
    {
        if (display.State != EntriesTableState.Data)
        {
            var message = new TextBlock
            {
                Text = display.EmptyMessage,
                FontFamily = TypographyTokens.Sans,
                FontSize = 13,
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
                Padding = new Thickness(12, 24, 12, 24),
            };

            LiveRegion.Configure(message);
            LiveRegion.Announce(message);
            return message;
        }

        var page = EntriesTablePaging.Slice(display.Rows, _pageIndex, _pageSize);
        var body = new StackPanel { Spacing = 0 };
        foreach (var row in page)
        {
            body.Children.Add(BuildRow(row, display));
        }

        return body;
    }

    private Border BuildRow(EntriesTableRowView row, EntriesTableDisplay display)
    {
        var grid = NewRowGrid(display.Columns);
        for (int i = 0; i < display.Columns.Count; i++)
        {
            var cell = BuildCell(row, display.Columns[i], display);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        AutomationProperties.SetName(grid, row.AutomationName);
        AutomationProperties.SetAccessibilityView(grid, AccessibilityView.Content);

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 4, 0, 4),
        };
    }

    private FrameworkElement BuildCell(EntriesTableRowView row, EntriesTableColumn column, EntriesTableDisplay display)
    {
        return column.Style switch
        {
            EntriesCellStyle.ReplayableBadge => BuildReplayableBadge(row),
            EntriesCellStyle.InspectAction => BuildInspectButton(row, display),
            _ => BuildValueCell(row.Cells.TryGetValue(column.Key, out var text) ? text : "\u2014", column.Style),
        };
    }

    private static TextBlock BuildValueCell(string text, EntriesCellStyle style)
    {
        bool mono = style is EntriesCellStyle.ReasonMono or EntriesCellStyle.MutedMono;
        bool muted = style is EntriesCellStyle.MutedMono or EntriesCellStyle.Size;
        bool right = IsRightAligned(style);

        return new TextBlock
        {
            Text = text,
            FontFamily = mono ? Monospace : TypographyTokens.Sans,
            FontSize = mono ? 12 : 13,
            Foreground = muted ? DisplayTokens.TextMuted : DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Padding = new Thickness(8, 2, 8, 2),
            HorizontalAlignment = right ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            TextAlignment = right ? TextAlignment.Right : TextAlignment.Left,
        };
    }

    private static TsBadge BuildReplayableBadge(EntriesTableRowView row)
    {
        var badge = new TsBadge
        {
            Status = row.Replayable ? StatusKind.Success : StatusKind.Neutral,
            Content = new TextBlock { Text = row.ReplayableText, FontSize = 11 },
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, row.ReplayableText);
        return badge;
    }

    private TsButton BuildInspectButton(EntriesTableRowView row, EntriesTableDisplay display)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Secondary,
            Size = ControlSize.Small,
            Text = display.InspectLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, row.InspectAutomationName);
        button.Click += (_, _) => _inspect?.Invoke(row.Source);
        return button;
    }

    // ── Footer: page-size selector + pager (web DataTable pagination footer) ─────────────────────────
    private Grid BuildFooter(EntriesTableDisplay display)
    {
        var footer = new Grid { Margin = new Thickness(0, 4, 0, 0) };
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var sizer = BuildPageSizeSelector();
        Grid.SetColumn(sizer, 0);
        footer.Children.Add(sizer);

        var pager = BuildPager(display);
        Grid.SetColumn(pager, 1);
        footer.Children.Add(pager);

        return footer;
    }

    private StackPanel BuildPageSizeSelector()
    {
        var label = new TextBlock
        {
            Text = _localizer.GetString("pagination.pageSize", "Rows per page"),
            FontFamily = TypographyTokens.Sans,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var select = new TsSelect { MinWidth = 88, VerticalAlignment = VerticalAlignment.Center };
        foreach (var size in EntriesTablePaging.PageSizeOptions)
        {
            select.Items.Add(new ComboBoxItem
            {
                Content = size.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Tag = size,
            });
        }

        select.SelectedIndex = Math.Max(0, IndexOfPageSize(_pageSize));
        AutomationProperties.SetName(select, _localizer.GetString("pagination.pageSize", "Rows per page"));
        select.SelectionChanged += OnPageSizeChanged;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(label);
        row.Children.Add(select);
        return row;
    }

    private void OnPageSizeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is TsSelect select && select.SelectedItem is ComboBoxItem item && item.Tag is int size)
        {
            _pageSize = size;
            _pageIndex = 0;
            Render();
        }
    }

    private TsPagination BuildPager(EntriesTableDisplay display)
    {
        var pager = new TsPagination
        {
            PageSize = _pageSize,
            TotalItems = display.Rows.Count,
            Page = _pageIndex + 1,
            FirstLabel = _localizer.GetString("pagination.first", "First page"),
            PreviousLabel = _localizer.GetString("pagination.previous", "Previous page"),
            NextLabel = _localizer.GetString("pagination.next", "Next page"),
            LastLabel = _localizer.GetString("pagination.last", "Last page"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        pager.PageChanged += OnPageChanged;
        return pager;
    }

    private void OnPageChanged(object? sender, int page)
    {
        _pageIndex = Math.Max(0, page - 1);
        Render();
    }

    // ── Shared helpers ──────────────────────────────────────────────────────────────────────────────
    private static Grid NewRowGrid(IReadOnlyList<EntriesTableColumn> columns)
    {
        var grid = new Grid();
        foreach (var column in columns)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ColumnWidth(column.Key)) });
        }

        return grid;
    }

    private static double ColumnWidth(string key) => key switch
    {
        EntriesTableColumns.ArrivedAtKey => 184,
        EntriesTableColumns.ReasonKey => 200,
        EntriesTableColumns.VinKey => 168,
        EntriesTableColumns.TopicKey => 240,
        EntriesTableColumns.RedeliveriesKey => 80,
        EntriesTableColumns.SizeKey => 96,
        EntriesTableColumns.ReplayableKey => 116,
        EntriesTableColumns.ActionsKey => 120,
        _ => 140,
    };

    private static bool IsRightAligned(EntriesCellStyle style) =>
        style is EntriesCellStyle.Count or EntriesCellStyle.Size;

    private static int IndexOfPageSize(int pageSize)
    {
        var options = EntriesTablePaging.PageSizeOptions;
        for (int i = 0; i < options.Count; i++)
        {
            if (options[i] == pageSize)
            {
                return i;
            }
        }

        return -1;
    }

    private static FontFamily Monospace => TypographyTokens.Mono ?? new FontFamily("Consolas");

    protected override AutomationPeer OnCreateAutomationPeer() => new EntriesTableAutomationPeer(this);

    private sealed class EntriesTableAutomationPeer(EntriesTable owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.DataGrid;
    }
}
