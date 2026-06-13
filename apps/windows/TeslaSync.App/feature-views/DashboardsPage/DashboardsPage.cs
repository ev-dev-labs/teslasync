using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.PowerUser;

/// <summary>
/// The native WinUI 3 <c>DashboardsPage</c> — a parity port of the web page
/// <c>web/src/features/power-user/pages/DashboardsPage.tsx</c> (route <c>/power/dashboards</c>, nav name
/// <c>Dashboards</c>). It binds to a <see cref="DashboardsPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header and intro; the manual JSON editor glass panel (the
/// labelled multi-line editor, the Copy / Clear affordances and the polite copy-status live region); and the
/// curated panel-catalog glass panel (its intro and the two-column grid of bordered catalog entries). The view
/// is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="DashboardComposerDisplay"/> projection, and the editor / clipboard / draft persistence flow
/// through the view-model seams. State changes are marshalled onto the UI thread, and every panel carries a
/// Narrator automation name.
/// </summary>
/// <remarks>
/// The web page also renders the optional <c>AINLDashboardComposer</c> AI drafter above the editor. That is a
/// separate shared component (a distinct W3 parity unit with its own i18n keys); this page unit's manifest
/// scopes only the two manual glass panels and their thirteen strings, so the AI drafter is intentionally out of
/// scope here and the manual baseline — which the web renders in AI-off mode — is reproduced in full.
/// </remarks>
public sealed partial class DashboardsPage : UserControl, IDisposable
{
    private const double PagePadding = 24;   // web p-6
    private const double SectionSpacing = 24; // web space-y-6
    private const double StackSpacing = 16;   // web Stack gap-4
    private const double EditorMinHeight = 260; // web rows={12}
    private const double IntroFontSize = 14;  // web text-sm
    private const double DescriptionFontSize = 12; // web text-xs
    private const double CatalogColumnSpacing = 8; // web gap-2
    private const int CatalogColumns = 2;     // web sm:grid-cols-2

    private readonly DashboardsPageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;
    private bool _updatingEditor;
    private string? _announcedStatus;

    private readonly PageTitle _title = new();
    private readonly TextBlock _intro = new()
    {
        FontSize = IntroFontSize,
        Foreground = DisplayTokens.TextSecondary,
        TextWrapping = TextWrapping.Wrap,
    };

    // GlassPanel1 — manual dashboard JSON editor.
    private readonly TsGlassPanel _editorPanel = new();
    private readonly PanelTitle _editorTitle = new();
    private readonly TsTextarea _editor = new() { MinHeight = EditorMinHeight, TextWrapping = TextWrapping.Wrap };
    private readonly TsButton _copyButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Medium };
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Medium };
    private readonly TextBlock _status = new()
    {
        FontSize = IntroFontSize,
        Foreground = DisplayTokens.Brush("TsColorWarningBrush"), // web text-amber-300
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };

    // GlassPanel2 — curated panel catalog.
    private readonly TsGlassPanel _catalogPanel = new();
    private readonly PanelTitle _catalogTitle = new();
    private readonly TextBlock _catalogIntro = new()
    {
        FontSize = IntroFontSize,
        Foreground = DisplayTokens.TextSecondary,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly Grid _catalogGrid = new() { ColumnSpacing = CatalogColumnSpacing, RowSpacing = CatalogColumnSpacing };

    /// <summary>Creates the page over the real draft store, the WinUI clipboard and the shell resource localizer.</summary>
    public DashboardsPage()
        : this(new LocalSettingsDashboardDraftStore(), new WindowsDashboardClipboard(), ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit seams and localizer (used by tests / dependency injection).</summary>
    /// <param name="store">The draft persistence seam (web <c>localStorage</c>).</param>
    /// <param name="clipboard">The clipboard seam (web <c>navigator.clipboard</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DashboardsPage(IDashboardDraftStore store, IDashboardClipboard clipboard, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(clipboard);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DashboardsPageViewModel(store, clipboard, localizer);

        Content = BuildLayout();
        BuildCatalog(_viewModel.Display.Panels);

        // Seed the editor before wiring the handler so seeding raises no view-model change.
        _editor.Text = _viewModel.Json;
        _editor.TextChanged += OnEditorTextChanged;
        _copyButton.Click += OnCopyClick;
        _clearButton.Click += OnClearClick;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>PowerDashboards</c>).</summary>
    public static string RouteName => DashboardsRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DashboardsPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        BuildEditorPanel();
        BuildCatalogPanel();

        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PagePadding) };
        stack.Children.Add(_title);
        stack.Children.Add(_intro);
        stack.Children.Add(_editorPanel);
        stack.Children.Add(_catalogPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private void BuildEditorPanel()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = CatalogColumnSpacing, // web gap-2
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_copyButton);
        actions.Children.Add(_clearButton);

        var body = new StackPanel { Spacing = StackSpacing };
        body.Children.Add(_editorTitle);
        body.Children.Add(_editor);
        body.Children.Add(actions);
        body.Children.Add(_status);

        _editorPanel.Padding = new Thickness(PagePadding);
        _editorPanel.Content = body;
    }

    private void BuildCatalogPanel()
    {
        var body = new StackPanel { Spacing = StackSpacing };
        body.Children.Add(_catalogTitle);
        body.Children.Add(_catalogIntro);
        body.Children.Add(_catalogGrid);

        _catalogPanel.Padding = new Thickness(PagePadding);
        _catalogPanel.Content = body;
    }

    private void BuildCatalog(IReadOnlyList<CuratedDashboardPanel> panels)
    {
        _catalogGrid.Children.Clear();
        _catalogGrid.ColumnDefinitions.Clear();
        _catalogGrid.RowDefinitions.Clear();

        for (var c = 0; c < CatalogColumns; c++)
        {
            _catalogGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (panels.Count + CatalogColumns - 1) / CatalogColumns;
        for (var r = 0; r < rows; r++)
        {
            _catalogGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (var i = 0; i < panels.Count; i++)
        {
            var card = BuildCatalogItem(panels[i]);
            Grid.SetColumn(card, i % CatalogColumns);
            Grid.SetRow(card, i / CatalogColumns);
            _catalogGrid.Children.Add(card);
        }
    }

    private static Border BuildCatalogItem(CuratedDashboardPanel panel)
    {
        var name = new TextBlock
        {
            Text = panel.Name,
            FontSize = IntroFontSize, // web text-sm
            Foreground = DisplayTokens.Brush("TsChartSpeedBrush"), // web text-cyan-300
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
        };

        if (TypographyTokens.Mono is { } mono)
        {
            name.FontFamily = mono; // web font-mono
        }

        var description = new TextBlock
        {
            Text = panel.Description,
            FontSize = DescriptionFontSize, // web text-xs
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var column = new StackPanel { Spacing = 4 }; // web gap-1
        column.Children.Add(name);
        column.Children.Add(description);

        var border = new Border
        {
            BorderBrush = DisplayTokens.Border,        // web border-[var(--border-subtle)]
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 6), // web rounded-md
            Padding = new Thickness(12),               // web p-3
            Child = column,
        };

        AutomationProperties.SetName(border, $"{panel.Name}. {panel.Description}");
        return border;
    }

    private void OnEditorTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_updatingEditor)
        {
            return;
        }

        _viewModel.SetText(_editor.Text);
    }

    private void OnCopyClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.CopyAsync());

    private void OnClearClick(object sender, RoutedEventArgs e) => _viewModel.Clear();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render();
        }
        else
        {
            _dispatcher.TryEnqueue(Render);
        }
    }

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        var d = _viewModel.Display;

        _title.Value = d.Title;
        _intro.Text = d.Intro;
        AutomationProperties.SetName(this, d.Title);

        _editorTitle.Value = d.EditorTitle;
        _editor.Hint = d.EditorHint;
        AutomationProperties.SetName(_editor, d.EditorLabel);

        _copyButton.Text = d.CopyLabel;
        _copyButton.IsEnabled = d.CanCopy;
        AutomationProperties.SetName(_copyButton, d.CopyLabel);

        _clearButton.Text = d.ClearLabel;
        _clearButton.IsEnabled = d.CanCopy;
        AutomationProperties.SetName(_clearButton, d.ClearLabel);

        _catalogTitle.Value = d.PanelsTitle;
        _catalogIntro.Text = d.PanelsIntro;
        AutomationProperties.SetName(_editorPanel, d.EditorTitle);
        AutomationProperties.SetName(_catalogPanel, d.PanelsTitle);

        SyncEditorText();
        RenderStatus();
    }

    private void SyncEditorText()
    {
        // Re-pull the editor text from the view-model only when they diverge (e.g. after Clear), guarding the
        // round-trip so a programmatic update never re-enters the change handler as user input.
        if (string.Equals(_editor.Text, _viewModel.Json, StringComparison.Ordinal))
        {
            return;
        }

        _updatingEditor = true;
        _editor.Text = _viewModel.Json;
        _updatingEditor = false;
    }

    private void RenderStatus()
    {
        string message = _viewModel.StatusMessage;
        bool hasMessage = !string.IsNullOrEmpty(message);

        _status.Text = message;
        _status.Visibility = hasMessage ? Visibility.Visible : Visibility.Collapsed;

        if (!hasMessage)
        {
            _announcedStatus = null;
            return;
        }

        // Announce the copy outcome through a polite live region (web role="status").
        LiveRegion.Configure(_status, assertive: false);
        AutomationProperties.SetName(_status, message);
        if (!string.Equals(_announcedStatus, message, StringComparison.Ordinal))
        {
            _announcedStatus = message;
            LiveRegion.Announce(_status);
        }
    }

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _editor.TextChanged -= OnEditorTextChanged;
        _copyButton.Click -= OnCopyClick;
        _clearButton.Click -= OnClearClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DashboardsPageAutomationPeer(this);

    private sealed class DashboardsPageAutomationPeer(DashboardsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((DashboardsPage)Owner).ViewModel.Title : name;
        }
    }
}
