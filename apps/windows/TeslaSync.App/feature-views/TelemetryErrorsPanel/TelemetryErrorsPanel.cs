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
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.UI.Text;
using WinRT.Interop;

namespace TeslaSync.App.FeatureViews.TelemetryErrors;

/// <summary>
/// The native WinUI 3 <c>TelemetryErrorsPanel</c> feature surface — a parity port of
/// web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> and it renders exactly one of the five web branches —
/// <see cref="TelemetryErrorsPanelState.Idle"/> (title + idle hint),
/// <see cref="TelemetryErrorsPanelState.Loading"/> (title + 3-line skeleton),
/// <see cref="TelemetryErrorsPanelState.Error"/> (title + danger message),
/// <see cref="TelemetryErrorsPanelState.Data"/> (a <see cref="TsDataTable"/> of the errors plus a JSON
/// download), or <see cref="TelemetryErrorsPanelState.Empty"/> (title + a "0"/"?" chip, the empty message,
/// and — when the extractor failed to recognise Tesla's shape — a raw-response disclosure). The view never
/// performs HTTP; all branch selection, label resolution and formatting happen in the WinUI-free
/// <see cref="TelemetryErrorsPanelProjection"/>. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class TelemetryErrorsPanel : ContentControl
{
    private const string DownloadGlyph = "\uE896"; // Segoe Fluent — Download

    private readonly ILocalizer _localizer;
    private readonly TelemetryErrorsPanelDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private TelemetryErrorsPanelModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="TelemetryErrorsPanelModel.Idle"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    public TelemetryErrorsPanel(
        ILocalizer localizer,
        TelemetryErrorsPanelModel? model = null,
        TelemetryErrorsPanelDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? TelemetryErrorsPanelModel.Idle;
        _diagnostics = diagnostics ?? new TelemetryErrorsPanelDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TelemetryErrorsPanel</c>).</summary>
    public static string Slug => TelemetryErrorsPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public TelemetryErrorsPanelModel Model
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
        var display = TelemetryErrorsPanelProjection.Project(_model, _localizer, _clock());

        UIElement surface = display.State switch
        {
            TelemetryErrorsPanelState.Idle => BuildIdle(display),
            TelemetryErrorsPanelState.Loading => BuildLoading(display),
            TelemetryErrorsPanelState.Error => BuildError(display),
            TelemetryErrorsPanelState.Data => BuildData(display),
            _ => BuildEmpty(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Idle (web !requested) ───────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildIdle(TelemetryErrorsPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(TitleText(display.Title));
        stack.Children.Add(new TextBlock
        {
            Text = display.IdleMessage,
            FontSize = 13,
            FontStyle = FontStyle.Italic,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        });

        return Box(stack, display.AutomationName);
    }

    // ── Loading (web loading) ───────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(TelemetryErrorsPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(TitleText(display.Title));

        var lines = new StackPanel { Spacing = 8 };
        for (int i = 0; i < 3; i++)
        {
            lines.Children.Add(new TsSkeleton { BlockHeight = 14 });
        }

        stack.Children.Add(lines);

        var box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Error (web error) ───────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildError(TelemetryErrorsPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(TitleText(display.Title));
        stack.Children.Add(new TextBlock
        {
            Text = display.ErrorText,
            FontSize = 13,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            TextWrapping = TextWrapping.Wrap,
        });

        var box = Box(stack, display.AutomationName);
        LiveRegion.Configure(box, assertive: true);
        LiveRegion.Announce(box);
        return box;
    }

    // ── Data (web errors.length > 0) ────────────────────────────────────────────────────────────────
    private static StackPanel BuildData(TelemetryErrorsPanelDisplay display)
    {
        var columns = new List<TsDataColumn>(display.Columns.Count);
        foreach (var column in display.Columns)
        {
            columns.Add(new TsDataColumn { Key = column.Key, Header = column.Header });
        }

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (var row in display.Rows)
        {
            // The table conveys each row's accessible content through its cell values (a TsDataRow is a
            // plain value record, not a UI element, so it carries no AutomationProperties of its own).
            rows.Add(new TsDataRow(row.RowKey, ToValues(row.Cells)));
        }

        var table = new TsDataTable
        {
            Columns = columns,
            Rows = rows,
            PageSize = TelemetryErrorsPanelProjection.PageSize,
            Selectable = false,
            EmptyMessage = display.EmptyMessage,
        };

        var download = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = display.DownloadLabel,
            IconGlyph = DownloadGlyph,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(download, display.DownloadLabel);
        download.Click += (_, _) => _ = SaveErrorsAsync(display.DownloadJson, display.DownloadFileName);

        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(table);
        stack.Children.Add(download);
        AutomationProperties.SetName(stack, display.AutomationName);
        return stack;
    }

    // ── Empty (web fall-through: ok ? "0"/success : "?"/warning + optional raw disclosure) ───────────
    private static TsGlassPanel BuildEmpty(TelemetryErrorsPanelDisplay display)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = TitleText(display.Title);
        Grid.SetColumn(title, 0);

        var badge = new TsBadge
        {
            Status = display.BadgeStatus,
            Dot = true,
            Content = new TextBlock { Text = display.BadgeText, FontSize = 11 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(badge, 1);

        header.Children.Add(title);
        header.Children.Add(badge);

        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(header);
        stack.Children.Add(new TextBlock
        {
            Text = display.EmptyMessage,
            FontSize = 13,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        });

        if (display.ShowRawDisclosure)
        {
            stack.Children.Add(BuildRawDisclosure(display));
        }

        return Box(stack, display.AutomationName);
    }

    // Web parity for the `<details>` raw-response disclosure under the empty state.
    private static Expander BuildRawDisclosure(TelemetryErrorsPanelDisplay display)
    {
        var json = new TextBlock
        {
            Text = display.RawJson,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
        };

        var scroller = new ScrollViewer
        {
            Content = json,
            MaxHeight = 256,
            Padding = new Thickness(8),
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        var expander = new Expander
        {
            Header = display.RawDisclosureLabel,
            Content = scroller,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Margin = new Thickness(0, 4, 0, 0),
        };
        AutomationProperties.SetName(expander, display.RawDisclosureLabel);
        return expander;
    }

    private static TextBlock TitleText(string title) => new()
    {
        Text = title,
        FontSize = 12,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(12), Content = content };
        AutomationProperties.SetName(panel, automationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }

    private static Dictionary<string, object?> ToValues(IReadOnlyDictionary<string, string> cells)
    {
        var values = new Dictionary<string, object?>(cells.Count, StringComparer.Ordinal);
        foreach (var cell in cells)
        {
            values[cell.Key] = cell.Value;
        }

        return values;
    }

    // Native analogue of the web blob download: write the errors JSON through a real file-save picker
    // (mirrors TsChartExportMenu). Best-effort — a missing window or a cancelled/failed save is a no-op.
    private static async Task SaveErrorsAsync(string json, string fileName)
    {
        var window = App.MainWindow;
        if (window is null)
        {
            return;
        }

        try
        {
            var picker = new FileSavePicker
            {
                SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
                SuggestedFileName = Path.GetFileNameWithoutExtension(fileName),
            };
            picker.FileTypeChoices.Add("JSON", new List<string> { ".json" });
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));

            var file = await picker.PickSaveFileAsync().AsTask().ConfigureAwait(true);
            if (file is null)
            {
                return;
            }

            await FileIO.WriteTextAsync(file, json).AsTask().ConfigureAwait(true);
        }
        catch (Exception)
        {
            // Export is best-effort: a denied/failed save must never crash the surface.
        }
    }
}
