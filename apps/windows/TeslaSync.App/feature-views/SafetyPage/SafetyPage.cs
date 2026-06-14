using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>SafetyPage</c> — a parity port of the web page
/// <c>web/src/features/settings/pages/SafetyPage.tsx</c> (route <c>/settings/safety</c>, nav name
/// <c>SafetySettingsPage</c>). The web page is the AI-OFF-safe host for the deterministic listing of every
/// safety-related TeslaSync setting (notification quiet hours, the quiet-hours window, alert digest mode, critical-flash
/// signalling, tab-badge signalling and the API kill-switch), each row showing its current value and a plain-English
/// explanation with a "Docs" link. This view reproduces that composition with the shared <see cref="PageContainer"/>
/// chrome (heading-level-1 title + muted subtitle) wrapping the single <see cref="TsGlassPanel"/> listing
/// (<c>GlassPanel1</c>): a section header, the seven setting rows (title + <see cref="TsBadge"/> value + description +
/// docs link) and the read-only change hint. All branch selection, formatting and i18n happen in the view-model's
/// <see cref="SafetyDisplay"/> projection; the view is a thin renderer that performs no I/O and marshals state changes
/// onto the UI thread. The opt-in <c>AISafetySettingExplainer</c> the web page can layer above the listing is gated off
/// by default (ADR-015 §I3: the deterministic listing is the canonical baseline) and is tracked as its own surface, so
/// it is absent here — exactly as in the web off-mode (<c>ai_mode='off'</c>) static-help invariant.
/// </summary>
public sealed partial class SafetyPage : UserControl, IDisposable
{
    private const double ContentPadding = 24;   // web layout gutter
    private const double PanelPadding = 20;      // web GlassPanel p-5
    private const double SectionSpacing = 16;    // web space-y-4
    private const double HeaderSpacing = 4;      // web header space-y-1
    private const double RowSpacing = 8;         // web row gap-2
    private const double RowVerticalPadding = 12; // web li py-3
    private const double TitleValueGap = 8;      // web flex gap-2

    private readonly SafetyPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageContainer _container;
    private readonly TsGlassPanel _listingPanel = new();
    private readonly SectionTitle _listingTitle = new();
    private readonly Text _listingSubtitle = new();
    private readonly Caption _changeHint = new();
    private readonly StackPanel _rowsHost = new() { Spacing = 0 };
    private readonly List<SafetyRowControls> _rows = new();

    /// <summary>Creates the page over the default (web-defaults) source and the shell resource localizer.</summary>
    public SafetyPage()
        : this(EmptySafetySettingsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit safety-settings source and localizer (tests / dependency injection).</summary>
    /// <param name="source">The safety-settings-read data port (web <c>useSettings</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the page's <c>view.opened</c> event.</param>
    public SafetyPage(
        ISafetySettingsSource source,
        ILocalizer localizer,
        SafetyPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SafetyPageViewModel(source, localizer, diagnostics);

        BuildListingPanel(_viewModel.Display);

        _container = new PageContainer(localizer, _viewModel.Display.Title)
        {
            Subtitle = _viewModel.Display.Subtitle,
            PageContent = new TsFadeIn { DelayMs = 180, Content = _listingPanel },
        };

        IsTabStop = false;

        // The PageContainer carries the page's heading-level-1 landmark, so the wrapper hides itself from Narrator.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Content = new ScrollViewer
        {
            Content = _container,
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

    /// <summary>The diagnostics surface slug (<c>SafetyPage</c>).</summary>
    public static string Slug => SafetyPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SafetyPageViewModel ViewModel => _viewModel;

    private void BuildListingPanel(SafetyDisplay display)
    {
        var header = new StackPanel { Spacing = HeaderSpacing };
        header.Children.Add(_listingTitle);
        header.Children.Add(_listingSubtitle);

        for (var i = 0; i < display.Rows.Count; i++)
        {
            var row = new SafetyRowControls(display.Rows[i], showDivider: i > 0);
            _rows.Add(row);
            _rowsHost.Children.Add(row.Root);
        }

        var content = new StackPanel { Spacing = SectionSpacing };
        content.Children.Add(header);
        content.Children.Add(_rowsHost);
        content.Children.Add(_changeHint);

        _listingPanel.Padding = new Thickness(PanelPadding);
        _listingPanel.Content = content;

        // web <GlassPanel data-testid="safety-settings-listing">.
        AutomationProperties.SetAutomationId(_listingPanel, "safety-settings-listing");
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

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

    private void Render(SafetyDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(_container, display.AutomationName);

        _listingTitle.Value = display.ListingTitle;
        _listingSubtitle.Value = display.ListingSubtitle;
        _changeHint.Value = display.ChangeHint;

        for (var i = 0; i < _rows.Count && i < display.Rows.Count; i++)
        {
            _rows[i].Update(display.Rows[i]);
        }
    }

    /// <summary>Unsubscribe from and dispose the composed surfaces (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        _container.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SafetyPageAutomationPeer(this);

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private sealed class SafetyPageAutomationPeer(SafetyPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }

    /// <summary>
    /// One rendered safety-settings row — the native analogue of one <c>&lt;li&gt;</c> in the web listing. Holds the
    /// title, the value <see cref="TsBadge"/>, the description and the "Docs" hyperlink, and updates them in place from
    /// a <see cref="SafetyRowDisplay"/> so the view never rebuilds its visual tree.
    /// </summary>
    private sealed class SafetyRowControls
    {
        private readonly Text _title = new();
        private readonly TsBadge _value = new() { Status = StatusKind.Info };
        private readonly Caption _description = new();
        private readonly HyperlinkButton _docs = new() { VerticalAlignment = VerticalAlignment.Top, Padding = new Thickness(0) };

        public SafetyRowControls(SafetyRowDisplay row, bool showDivider)
        {
            var titleRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = TitleValueGap,
                VerticalAlignment = VerticalAlignment.Center,
            };
            titleRow.Children.Add(_title);
            titleRow.Children.Add(_value);

            var textColumn = new StackPanel { Spacing = HeaderSpacing };
            textColumn.Children.Add(titleRow);
            textColumn.Children.Add(_description);

            var grid = new Grid
            {
                ColumnSpacing = RowSpacing,
                Padding = new Thickness(0, RowVerticalPadding, 0, RowVerticalPadding),
            };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(textColumn, 0);
            Grid.SetColumn(_docs, 1);
            grid.Children.Add(textColumn);
            grid.Children.Add(_docs);

            // web li id (web data-testid={`safety-settings-row-${row.titleKey}`}).
            AutomationProperties.SetAutomationId(grid, $"safety-settings-row-{row.Key}");

            if (showDivider)
            {
                // web divide-y divide-white/5 — a hairline separator between rows.
                var divider = new Border { Height = 1, Margin = new Thickness(0) };
                if (TokenBrush("TsColorBorderBrush") is { } border)
                {
                    divider.Background = border;
                }

                var stack = new StackPanel { Spacing = 0 };
                stack.Children.Add(divider);
                stack.Children.Add(grid);
                Root = stack;
            }
            else
            {
                Root = grid;
            }

            Update(row);
        }

        public UIElement Root { get; }

        public void Update(SafetyRowDisplay row)
        {
            _title.Value = row.Title;
            _value.Content = row.Value;
            AutomationProperties.SetName(_value, $"{row.Title}: {row.Value}");
            _description.Value = row.Description;

            _docs.Content = row.DocsLabel;
            if (Uri.TryCreate(row.DocsUri, UriKind.Absolute, out var uri))
            {
                _docs.NavigateUri = uri;
            }

            AutomationProperties.SetName(_docs, $"{row.DocsLabel}: {row.Title}");
            ToolTipService.SetToolTip(_docs, row.DocsUri);
        }
    }
}
