using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.PowerUser;

/// <summary>
/// The native WinUI 3 <c>SqlPlaygroundPage</c> — a parity port of the web page
/// <c>web/src/features/power-user/pages/SqlPlaygroundPage.tsx</c> (route <c>/power/sql</c>). It lets a self-hosted
/// operator hand-write read-only SQL against a curated, install-wide-static schema catalog. The layout is a vertical
/// stack under a <see cref="PageTitle"/> + intro paragraph: GlassPanel1 (web the manual SQL editor) hosts a
/// multi-line <see cref="TsTextarea"/> with Run + Clear buttons and a deterministic run-message status line, and
/// GlassPanel2 (web the curated schema catalog) lists every curated table with its description and column metadata so
/// a query can be written without external docs. There is no browser-side execution endpoint, so Run surfaces a
/// deterministic notice directing the user to a read-only DB client (web <c>powerSql.editor.runUnavailable</c>). The
/// view is a thin renderer: all copy, i18n and the <c>canRun</c> gate live in the
/// <see cref="SqlPlaygroundPageViewModel"/>'s <see cref="SqlPlaygroundDisplay"/> projection, marshalled onto the UI
/// thread. The opt-in AI drafter (web <c>AINLSqlPlayground</c>, wrapped in <c>withAiFeature</c> and absent in
/// off-mode) is a separate parity unit and is intentionally out of scope here.
/// </summary>
public sealed partial class SqlPlaygroundPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;      // web layout gutter (p-6).
    private const double SectionSpacing = 24;      // web space-y-6.
    private const double PanelPadding = 16;         // web GlassPanel inner padding.
    private const double PanelSpacing = 16;         // web Stack gap-4.
    private const double EditorMinHeight = 220;     // web textarea rows={10}.
    private const double ActionSpacing = 8;         // web action-row gap-2.
    private const double TableSpacing = 12;         // web catalog list space-y-4 (compacted to Fluent rhythm).
    private const double TableCardPadding = 16;     // web table card p-4.
    private const double TableCardRadius = 6;       // web rounded-md.

    private readonly SqlPlaygroundPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _opened;
    private bool _suppressEditorSync;

    private readonly PageTitle _title = new();
    private readonly TextBlock _intro = new() { TextWrapping = TextWrapping.Wrap, FontSize = 14 };

    private readonly PanelTitle _editorTitle = new();
    private readonly TsTextarea _editor = new()
    {
        MinHeight = EditorMinHeight,
        AcceptsReturn = true,
        TextWrapping = TextWrapping.Wrap,
        IsSpellCheckEnabled = false,           // web spellCheck={false}.
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TsButton _runButton = new() { Variant = ButtonVariant.Primary };
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Secondary };
    private readonly TextBlock _runMessage = new()
    {
        TextWrapping = TextWrapping.Wrap,
        FontSize = 14,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly PanelTitle _catalogTitle = new();
    private readonly TextBlock _catalogIntro = new() { TextWrapping = TextWrapping.Wrap, FontSize = 14 };
    private readonly StackPanel _catalogList = new() { Spacing = TableSpacing };

    private readonly TsGlassPanel _editorPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly TsGlassPanel _catalogPanel = new() { Padding = new Thickness(PanelPadding) };

    /// <summary>Creates the page over the shell resource localizer and the app-session draft store.</summary>
    public SqlPlaygroundPage()
        : this(ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit localizer / draft store (used by tests and dependency injection).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="draftStore">The draft persistence seam (defaults to the app-session-wide in-memory store).</param>
    public SqlPlaygroundPage(ILocalizer localizer, ISqlPlaygroundDraftStore? draftStore = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SqlPlaygroundPageViewModel(localizer, draftStore);

        _intro.Foreground = DisplayTokens.TextSecondary;
        _catalogIntro.Foreground = DisplayTokens.TextSecondary;
        _runMessage.Foreground = DisplayTokens.Brush("TsColorWarningBrush"); // web text-amber-300.
        AutomationProperties.SetLiveSetting(_runMessage, AutomationLiveSetting.Polite); // web role="status".

        _editor.TextChanged += OnEditorTextChanged;
        _runButton.Click += OnRunClicked;
        _clearButton.Click += OnClearClicked;

        _editorPanel.Content = BuildEditorColumn();
        _catalogPanel.Content = BuildCatalogColumn();
        BuildCatalogList();

        var body = new StackPanel { Spacing = SectionSpacing };
        body.Children.Add(_title);
        body.Children.Add(_intro);
        body.Children.Add(_editorPanel);
        body.Children.Add(_catalogPanel);

        AutomationProperties.SetLandmarkType(_editorPanel, AutomationLandmarkType.Main);
        AutomationProperties.SetLandmarkType(_catalogPanel, AutomationLandmarkType.Custom);

        IsTabStop = false;
        Content = new ScrollViewer
        {
            Content = body,
            Padding = new Thickness(ContentPadding),
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SqlPlaygroundPage</c>).</summary>
    public static string Slug => SqlPlaygroundRegistration.Slug;

    private StackPanel BuildEditorColumn()
    {
        var actionRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actionRow.Children.Add(_runButton);
        actionRow.Children.Add(_clearButton);
        actionRow.Children.Add(_runMessage);

        var column = new StackPanel { Spacing = PanelSpacing };
        column.Children.Add(_editorTitle);
        column.Children.Add(_editor);
        column.Children.Add(actionRow);
        return column;
    }

    private StackPanel BuildCatalogColumn()
    {
        var column = new StackPanel { Spacing = PanelSpacing };
        column.Children.Add(_catalogTitle);
        column.Children.Add(_catalogIntro);
        column.Children.Add(_catalogList);
        return column;
    }

    // The curated catalog is install-wide-static and language-independent (its names/types are schema identifiers),
    // so it is built once rather than on every projection.
    private void BuildCatalogList()
    {
        _catalogList.Children.Clear();
        foreach (var table in SqlCatalog.Sorted)
        {
            _catalogList.Children.Add(BuildTableCard(table));
        }
    }

    private static Border BuildTableCard(CuratedTable table)
    {
        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(new TextBlock
        {
            Text = table.Name,
            FontFamily = MonoFontFamily(),
            FontSize = 15,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"), // web text-cyan-300.
            TextWrapping = TextWrapping.Wrap,
        });
        header.Children.Add(new TextBlock
        {
            Text = table.Description,
            FontSize = 13,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        });

        var columns = new StackPanel { Spacing = 4, Margin = new Thickness(0, 10, 0, 0) };
        foreach (var column in table.Columns)
        {
            columns.Children.Add(BuildColumnLine(column));
        }

        var card = new StackPanel { Spacing = 0 };
        card.Children.Add(header);
        card.Children.Add(columns);

        var border = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(TableCardRadius),
            Padding = new Thickness(TableCardPadding),
            Child = card,
        };
        AutomationProperties.SetName(border, $"{table.Name}. {table.Description}");
        return border;
    }

    private static TextBlock BuildColumnLine(CuratedColumn column)
    {
        // web: <name mono emerald> · <type muted> — <description>.
        var line = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 12 };
        line.Inlines.Add(new Run
        {
            Text = column.Name,
            FontFamily = MonoFontFamily(),
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"), // web text-emerald-300.
        });
        line.Inlines.Add(new Run { Text = " · ", Foreground = DisplayTokens.TextMuted });
        line.Inlines.Add(new Run { Text = column.Type, Foreground = DisplayTokens.TextSecondary });
        line.Inlines.Add(new Run { Text = " — ", Foreground = DisplayTokens.TextMuted });
        line.Inlines.Add(new Run { Text = column.Description, Foreground = DisplayTokens.TextSecondary });
        AutomationProperties.SetName(line, $"{column.Name}, {column.Type}, {column.Description}");
        return line;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from the view-model and child controls (CA1001; mirrors the sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _editor.TextChanged -= OnEditorTextChanged;
        _runButton.Click -= OnRunClicked;
        _clearButton.Click -= OnClearClicked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnEditorTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEditorSync)
        {
            return;
        }

        _viewModel.SetSql(_editor.Text);
    }

    private void OnRunClicked(object sender, RoutedEventArgs e) => _viewModel.Run();

    private void OnClearClicked(object sender, RoutedEventArgs e) => _viewModel.Clear();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
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

    private void Render(SqlPlaygroundDisplay display)
    {
        _title.Value = display.Title;
        _intro.Text = display.Intro;
        AutomationProperties.SetName(this, display.Title);

        _editorTitle.Value = display.EditorTitle;
        _editor.Hint = display.EditorHint;
        AutomationProperties.SetName(_editor, display.EditorLabel);
        AutomationProperties.SetName(_editorPanel, display.EditorTitle);

        if (!string.Equals(_editor.Text, display.Sql, StringComparison.Ordinal))
        {
            _suppressEditorSync = true;
            _editor.Text = display.Sql;
            _editor.SelectionStart = _editor.Text.Length;
            _suppressEditorSync = false;
        }

        _runButton.Text = display.RunLabel;
        _clearButton.Text = display.ClearLabel;
        _runButton.IsEnabled = display.CanRun;   // web disabled={!canRun}.
        _clearButton.IsEnabled = display.CanRun;  // web disabled={!canRun}.

        _runMessage.Text = display.RunMessage;
        _runMessage.Visibility = string.IsNullOrEmpty(display.RunMessage)
            ? Visibility.Collapsed
            : Visibility.Visible;

        _catalogTitle.Value = display.CatalogTitle;
        _catalogIntro.Text = display.CatalogIntro;
        AutomationProperties.SetName(_catalogPanel, display.CatalogTitle);
    }

    private static FontFamily MonoFontFamily() => TypographyTokens.Mono ?? new FontFamily("Consolas");

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SqlPlaygroundPageAutomationPeer(this);

    private sealed class SqlPlaygroundPageAutomationPeer(SqlPlaygroundPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
