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

namespace TeslaSync.App.FeatureViews.FeatureFlags;

/// <summary>
/// The native WinUI 3 <c>FlagsTable</c> feature surface — a parity port of
/// web/src/features/admin/components/feature-flags/FlagsTable.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> and it renders exactly one of the three web branches —
/// <see cref="FlagsTableState.Loading"/> (header chrome + "Loading flags…" + skeleton rows),
/// <see cref="FlagsTableState.Empty"/> (header chrome + a friendly <see cref="TsEmptyState"/>), or
/// <see cref="FlagsTableState.Data"/> (the sortable-key registry table with a JSON value preview and per-row
/// Edit + Delete actions, plus the paged footer). Sorting mirrors the web <c>useSortToggle('key', 'asc')</c>
/// three-state header toggle and pagination mirrors <c>{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }</c>.
/// The view never performs HTTP; all branch selection, label resolution, value formatting, sorting and paging
/// happen in the WinUI-free <see cref="FlagsTableProjection"/>. Editing and deleting are surfaced as the
/// <see cref="EditRequested"/> / <see cref="DeleteRequested"/> events (the web <c>onEdit</c> / <c>onAskDelete</c>
/// callbacks) so the parent owns the drawer + confirm dialog. Every string resolves through the i18n facade and
/// every interactive element carries a Narrator name.
/// </summary>
public sealed partial class FlagsTable : ContentControl
{
    private const string EditGlyph = "\uE70F";     // Segoe Fluent — Edit (pencil); web lucide Pencil
    private const string DeleteGlyph = "\uE74D";   // Segoe Fluent — Delete (trash); web lucide Trash2
    private const string SortAscGlyph = "\uE70E";  // Segoe Fluent — chevron up (matches TsDataTable)
    private const string SortDescGlyph = "\uE70D"; // Segoe Fluent — chevron down

    private readonly ILocalizer _localizer;
    private readonly FlagsTableDiagnostics _diagnostics;
    private readonly TableSortState _sort = new();

    private FlagsTableModel _model;
    private int _page = 1;
    private int _pageSize = FlagsTableProjection.DefaultPageSize;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="FlagsTableModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FlagsTable(
        ILocalizer localizer,
        FlagsTableModel? model = null,
        FlagsTableDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? FlagsTableModel.Empty;
        _diagnostics = diagnostics ?? new FlagsTableDiagnostics();

        // web: useSortToggle('key', 'asc') — the table opens sorted by key ascending.
        _sort.Toggle(FlagsTableProjection.KeyColumnKey);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when a row's Edit action is invoked (web <c>onEdit</c>).</summary>
    public event EventHandler<FeatureFlagEntry>? EditRequested;

    /// <summary>Raised when a row's Delete action is invoked (web <c>onAskDelete</c>).</summary>
    public event EventHandler<FeatureFlagEntry>? DeleteRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>FlagsTable</c>).</summary>
    public static string Slug => FlagsTableRegistration.Slug;

    /// <summary>The render model; reassigning resets to the first page, re-projects and re-renders.</summary>
    public FlagsTableModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _page = 1;
            Render();
        }
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
        var display = FlagsTableProjection.Project(_model, _localizer, _sort, _page, _pageSize);
        _page = display.Page; // adopt the clamped page

        var root = new StackPanel { Spacing = 8 };
        root.Children.Add(BuildTable(display));
        if (display.ShowPagination)
        {
            root.Children.Add(BuildPaginationBar(display));
        }

        AutomationProperties.SetName(this, display.AutomationName);
        Content = new TsGlassPanel { Padding = new Thickness(12), Content = root };
    }

    private Grid BuildTable(FlagsTableDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 6 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        AddHeader(grid, display);

        if (display.State == FlagsTableState.Data)
        {
            for (int i = 0; i < display.Rows.Count; i++)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                AddBodyRow(grid, display.Rows[i], i + 1, display);
            }
        }
        else
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var stateSurface = BuildStateSurface(display);
            Grid.SetRow(stateSurface, 1);
            Grid.SetColumn(stateSurface, 0);
            Grid.SetColumnSpan(stateSurface, 3);
            grid.Children.Add(stateSurface);
        }

        return grid;
    }

    private void AddHeader(Grid grid, FlagsTableDisplay display)
    {
        var keyHeader = BuildSortHeader(display);
        Grid.SetRow(keyHeader, 0);
        Grid.SetColumn(keyHeader, 0);
        grid.Children.Add(keyHeader);

        var valueHeader = HeaderText(display.Columns[1].Header);
        Grid.SetRow(valueHeader, 0);
        Grid.SetColumn(valueHeader, 1);
        grid.Children.Add(valueHeader);

        var actionsHeader = HeaderText(display.Columns[2].Header);
        Grid.SetRow(actionsHeader, 0);
        Grid.SetColumn(actionsHeader, 2);
        grid.Children.Add(actionsHeader);
    }

    private TsButton BuildSortHeader(FlagsTableDisplay display)
    {
        string? glyph = display.KeySortDirection switch
        {
            SortDirection.Ascending => SortAscGlyph,
            SortDirection.Descending => SortDescGlyph,
            _ => null,
        };

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = display.Columns[0].Header,
            IconGlyph = glyph,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(button, display.Columns[0].Header);
        button.Click += (_, _) =>
        {
            _sort.Toggle(FlagsTableProjection.KeyColumnKey);
            _page = 1;
            Render();
        };
        return button;
    }

    private void AddBodyRow(Grid grid, FlagsTableRow row, int rowIndex, FlagsTableDisplay display)
    {
        var keyText = new TextBlock
        {
            Text = row.KeyText,
            FontFamily = MonoFont,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
            IsTextSelectionEnabled = true,
        };
        Grid.SetRow(keyText, rowIndex);
        Grid.SetColumn(keyText, 0);
        grid.Children.Add(keyText);

        var valueText = new TextBlock
        {
            Text = row.ValuePreview,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
            IsTextSelectionEnabled = true,
        };
        ToolTipService.SetToolTip(valueText, row.ValuePreview);
        Grid.SetRow(valueText, rowIndex);
        Grid.SetColumn(valueText, 1);
        grid.Children.Add(valueText);

        var actions = BuildActions(row, display);
        Grid.SetRow(actions, rowIndex);
        Grid.SetColumn(actions, 2);
        grid.Children.Add(actions);
    }

    private StackPanel BuildActions(FlagsTableRow row, FlagsTableDisplay display)
    {
        var edit = new TsButton
        {
            Variant = ButtonVariant.Secondary,
            Size = ControlSize.Small,
            Text = display.EditLabel,
            IconGlyph = EditGlyph,
        };
        AutomationProperties.SetName(edit, row.EditActionName);
        ToolTipService.SetToolTip(edit, row.EditActionName);
        edit.Click += (_, _) => EditRequested?.Invoke(this, row.Entry);

        var delete = new TsButton
        {
            Variant = ButtonVariant.Destructive,
            Size = ControlSize.Small,
            Text = display.DeleteLabel,
            IconGlyph = DeleteGlyph,
        };
        AutomationProperties.SetName(delete, row.DeleteActionName);
        ToolTipService.SetToolTip(delete, row.DeleteActionName);
        delete.Click += (_, _) => DeleteRequested?.Invoke(this, row.Entry);

        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        panel.Children.Add(edit);
        panel.Children.Add(delete);
        return panel;
    }

    private Grid BuildPaginationBar(FlagsTableDisplay display)
    {
        var pager = new TsPagination
        {
            Page = display.Page,
            PageSize = display.PageSize,
            TotalItems = display.TotalCount,
            FirstLabel = display.FirstLabel,
            PreviousLabel = display.PreviousLabel,
            NextLabel = display.NextLabel,
            LastLabel = display.LastLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        pager.PageChanged += (_, page) =>
        {
            _page = page;
            Render();
        };

        var sizeSelect = new TsSelect { MinWidth = 84, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(sizeSelect, display.PageSizeLabel);
        int selectedIndex = 0;
        for (int i = 0; i < display.PageSizeOptions.Count; i++)
        {
            int size = display.PageSizeOptions[i];
            sizeSelect.Items.Add(new ComboBoxItem
            {
                Content = size.ToString(System.Globalization.CultureInfo.CurrentCulture),
                Tag = size,
            });
            if (size == display.PageSize)
            {
                selectedIndex = i;
            }
        }

        sizeSelect.SelectedIndex = selectedIndex;
        sizeSelect.SelectionChanged += (_, _) =>
        {
            if (sizeSelect.SelectedItem is ComboBoxItem { Tag: int size })
            {
                _pageSize = size;
                _page = 1;
                Render();
            }
        };

        var sizeLabel = new TextBlock
        {
            Text = display.PageSizeLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        left.Children.Add(sizeLabel);
        left.Children.Add(sizeSelect);

        var bar = new Grid { Margin = new Thickness(0, 4, 0, 0) };
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(pager, 1);
        bar.Children.Add(left);
        bar.Children.Add(pager);
        return bar;
    }

    private static FrameworkElement BuildStateSurface(FlagsTableDisplay display)
    {
        if (display.State == FlagsTableState.Loading)
        {
            var stack = new StackPanel { Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
            stack.Children.Add(new TextBlock
            {
                Text = display.StatusMessage,
                FontSize = 13,
                Foreground = DisplayTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
            });
            for (int i = 0; i < 3; i++)
            {
                stack.Children.Add(new TsSkeleton { BlockHeight = 14 });
            }

            LiveRegion.Configure(stack);
            LiveRegion.Announce(stack);
            return stack;
        }

        return new TsEmptyState { Message = display.StatusMessage, Margin = new Thickness(0, 8, 0, 0) };
    }

    private static TextBlock HeaderText(string text) => new()
    {
        Text = text,
        FontSize = 12,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static FontFamily MonoFont => TypographyTokens.Mono ?? new FontFamily("Consolas");

    protected override AutomationPeer OnCreateAutomationPeer() => new FlagsTableAutomationPeer(this);

    private sealed class FlagsTableAutomationPeer(FlagsTable owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.DataGrid;
    }
}
