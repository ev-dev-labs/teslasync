using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>MonthlyCostTable</c> feature surface — a parity port of
/// web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx. It is a pure presentational control:
/// assign a <see cref="Model"/> (the web <c>data</c> prop) and it renders the web <see cref="TsGlassPanel"/>
/// with its <see cref="BarChart3"/>-iconed title in BOTH branches, then exactly one of the two web branches —
/// <see cref="MonthlyCostTableState.Ready"/> (the web sortable <c>DataTable</c>: the seven Month / Sessions /
/// Energy / Cost / Avg $/kWh / Gas Equiv / Savings columns over the cost rows, mapped to the shared
/// <see cref="TsDataTable"/> which contributes keyboard-operable column sorting, paging and a column chooser —
/// the native analogues of the web <c>pagination</c> + <c>columnVisibility</c> + <c>columnReorder</c>) or
/// <see cref="MonthlyCostTableState.Empty"/> (the web "No monthly data available" message, rendered as a
/// <see cref="TsEmptyState"/> so the region is never a blank box). The view never performs HTTP; all branch
/// selection, ordering, label resolution and number formatting happen in the WinUI-free
/// <see cref="MonthlyCostTableProjection"/>. Every string resolves through the i18n facade and the surface and
/// each row carry a Narrator name.
/// </summary>
public sealed partial class MonthlyCostTable : ContentControl
{
    private const double PanelPadding = 16;   // web GlassPanel p-4
    private const double TitleIconSize = 16;  // web BarChart3 h-4 w-4
    private const string CyanAccentBrushKey = "TsChartSpeedBrush"; // web BarChart3 text-cyan-400

    private readonly ILocalizer _localizer;
    private readonly MonthlyCostTableDiagnostics _diagnostics;
    private readonly string? _currencySymbol;

    private MonthlyCostTableModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/currency.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="MonthlyCostTableModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public MonthlyCostTable(
        ILocalizer localizer,
        MonthlyCostTableModel? model = null,
        MonthlyCostTableDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? MonthlyCostTableModel.Empty;
        _diagnostics = diagnostics ?? new MonthlyCostTableDiagnostics();
        _currencySymbol = currencySymbol;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>MonthlyCostTable</c>).</summary>
    public static string Slug => MonthlyCostTableRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public MonthlyCostTableModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
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
        var display = MonthlyCostTableProjection.Project(_model, _localizer, _currencySymbol);

        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(BuildHeader(display.Title));
        stack.Children.Add(display.State == MonthlyCostTableState.Ready
            ? BuildTable(display)
            : BuildEmpty(display));

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = stack,
        };
        AutomationProperties.SetName(panel, display.AutomationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = panel;
    }

    // ── Title row (web <h3> with the BarChart3 icon) — rendered in both branches ─────────────────────────
    private static StackPanel BuildHeader(string title)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = MonthlyCostTableRegistration.TitleGlyph,
            FontSize = TitleIconSize,
            Foreground = DisplayTokens.Brush(CyanAccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        row.Children.Add(icon);
        row.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetName(row, title);
        return row;
    }

    // ── Ready (web `sortedData.length > 0` → <DataTable>) ─────────────────────────────────────────────────
    private static TsDataTable BuildTable(MonthlyCostTableDisplay display)
    {
        var columns = new List<TsDataColumn>(display.Columns.Count);
        foreach (MonthlyCostTableColumn column in display.Columns)
        {
            columns.Add(new TsDataColumn
            {
                Key = column.Key,
                Header = column.Header,
                IsNumeric = column.IsNumeric,
            });
        }

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (MonthlyCostTableRow row in display.Rows)
        {
            // A TsDataRow is a plain value record (no AutomationProperties of its own); it conveys its accessible
            // content through the formatted cell values keyed by column key.
            rows.Add(new TsDataRow(row.RowKey, ToValues(row.Cells)));
        }

        var table = new TsDataTable
        {
            Columns = columns,
            Rows = rows,
            PageSize = MonthlyCostTableProjection.PageSize,
            Selectable = false,
            EmptyMessage = display.EmptyMessage,
        };
        AutomationProperties.SetName(table, display.AutomationName);
        return table;
    }

    // ── Empty (web `sortedData.length === 0` → "No monthly data available") ───────────────────────────────
    private static TsEmptyState BuildEmpty(MonthlyCostTableDisplay display)
    {
        var empty = new TsEmptyState
        {
            Message = display.EmptyMessage,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(empty, display.AutomationName);
        AutomationProperties.SetAccessibilityView(empty, AccessibilityView.Content);
        return empty;
    }

    private static Dictionary<string, object?> ToValues(IReadOnlyDictionary<string, string> cells)
    {
        var values = new Dictionary<string, object?>(cells.Count, StringComparer.Ordinal);
        foreach (KeyValuePair<string, string> cell in cells)
        {
            values[cell.Key] = cell.Value;
        }

        return values;
    }
}
