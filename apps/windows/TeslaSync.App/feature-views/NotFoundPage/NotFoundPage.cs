using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>NotFoundPage</c> — a parity port of the web catch-all page
/// <c>web/src/features/system/pages/NotFoundPage.tsx</c> (route <c>/*</c>, nav name <c>NotFound</c>). It binds to a
/// <see cref="NotFoundPageViewModel"/> and reproduces the web render with Fluent components and design tokens: a
/// <see cref="TsPageContainer"/> (the <c>PageContainer</c>) carrying the page title and hosting the single
/// <see cref="TsGlassPanel"/> (web <c>GlassPanel mx-auto max-w-2xl</c>) — a centred column with a Compass glyph
/// (web Lucide <c>Compass</c>, decorative), the heading, the path-filled body, the conditional "Did you mean"
/// suggestion list (web <c>suggestions.length &gt; 0</c>, each a navigable link of label + path), and the three
/// escape-hatch buttons (Go back / Go to dashboard / Open command palette). The view is a thin renderer: all copy,
/// suggestion ranking and i18n happen in the view-model's <see cref="NotFoundDisplay"/> projection. The view holds
/// no router — each affordance leaves through this surface's events, which the shell wires to real navigation; the
/// operational 404 diagnostic is emitted once on <see cref="FrameworkElement.Loaded"/>. Every string resolves
/// through the i18n facade, the surface carries a Narrator name, the glyph is hidden from the accessibility tree,
/// and no custom motion is added (button visual states are system-driven, honouring reduced motion by
/// construction). The web source performs no asynchronous read, so this surface reproduces that single success
/// state faithfully — there is no loading / error / empty branch to model.
/// </summary>
public sealed partial class NotFoundPage : ContentControl, INotFoundNavigator
{
    // web GlassPanel className="mx-auto max-w-2xl px-6 py-12" → centred, 2xl max width, 24/48 padding.
    private const double PanelMaxWidth = 672;
    private const double CompassSize = 48;

    private readonly NotFoundPageViewModel _viewModel;
    private bool _shown;

    /// <summary>Creates the surface for an empty unmatched path over the shell resource localizer.</summary>
    public NotFoundPage()
        : this(string.Empty, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface for an unmatched path over the shell resource localizer.</summary>
    /// <param name="unmatchedPath">The unmatched path the page was reached with (web <c>location.pathname</c>).</param>
    public NotFoundPage(string unmatchedPath)
        : this(unmatchedPath, ShellLocalizer.Instance)
    {
    }

    /// <summary>
    /// Creates the surface over an explicit unmatched path, localizer, route table and (optional) diagnostics
    /// (used by tests / dependency injection). The display is composed immediately so the surface renders before it
    /// is marked shown.
    /// </summary>
    /// <param name="unmatchedPath">The unmatched path the page was reached with (web <c>location.pathname</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="routes">The route table searched for suggestions (defaults to <see cref="RouteTable.All"/>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the 404 / navigation events.</param>
    public NotFoundPage(
        string unmatchedPath,
        ILocalizer localizer,
        IReadOnlyList<RouteDefinition>? routes = null,
        NotFoundDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new NotFoundPageViewModel(this, localizer, unmatchedPath, routes, diagnostics);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildContent(_viewModel.Display);
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        Loaded += OnLoaded;
    }

    /// <summary>Raised when the "Go back" affordance is activated (web <c>window.history.back()</c>).</summary>
    public event EventHandler? GoBackRequested;

    /// <summary>Raised when the "Go to dashboard" affordance is activated (web <c>navigate('/')</c>).</summary>
    public event EventHandler? GoHomeRequested;

    /// <summary>Raised when the "Open command palette" affordance is activated (web <c>toggle-command-palette</c>).</summary>
    public event EventHandler? OpenSearchRequested;

    /// <summary>Raised with a route path when a suggestion is activated (web <c>&lt;Link to={s.path}&gt;</c>).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>NotFoundPage</c>).</summary>
    public static string Slug => NotFoundRegistration.Slug;

    /// <summary>The render-ready 404 surface (localized copy + ranked suggestions + Narrator name).</summary>
    public NotFoundDisplay Display => _viewModel.Display;

    void INotFoundNavigator.GoBack() => GoBackRequested?.Invoke(this, EventArgs.Empty);

    void INotFoundNavigator.GoToDashboard() => GoHomeRequested?.Invoke(this, EventArgs.Empty);

    void INotFoundNavigator.OpenCommandPalette() => OpenSearchRequested?.Invoke(this, EventArgs.Empty);

    void INotFoundNavigator.NavigateTo(string path) => NavigationRequested?.Invoke(this, path);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_shown)
        {
            return;
        }

        _shown = true;

        // Mirrors the web component mounting: emit the operational 404 diagnostic exactly once. Idempotent inside
        // the view-model, so a re-entrant Loaded never re-fires.
        _viewModel.MarkShown();
    }

    private TsPageContainer BuildContent(NotFoundDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 0,
            HorizontalAlignment = HorizontalAlignment.Center,
            MaxWidth = PanelMaxWidth,
        };

        // web <Compass className="mx-auto mb-4 h-12 w-12 text-[var(--text-muted)]" aria-hidden /> — decorative.
        var compass = new FontIcon
        {
            Glyph = NotFoundRegistration.CompassGlyph,
            FontSize = CompassSize,
            Foreground = Brush("TsColorTextMutedBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 16),
        };
        AutomationProperties.SetAccessibilityView(compass, AccessibilityView.Raw);
        column.Children.Add(compass);

        // web <h2 className="text-2xl font-semibold text-[var(--text-primary)]">{heading}</h2>
        var heading = new Heading
        {
            Value = display.Heading,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetHeadingLevel(heading, AutomationHeadingLevel.Level2);
        column.Children.Add(heading);

        // web <p className="mt-2 break-all text-[var(--text-secondary)]">{body}</p>
        var body = new Text
        {
            Value = display.Body,
            Foreground = Brush("TsColorTextSecondaryBrush"),
            HorizontalContentAlignment = HorizontalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 8, 0, 0),
        };
        column.Children.Add(body);

        // web {suggestions.length > 0 && (<div className="mt-6">…</div>)} — only rendered when non-empty.
        if (display.HasSuggestions)
        {
            column.Children.Add(BuildSuggestions(display));
        }

        // web <div className="mt-8 flex flex-wrap items-center justify-center gap-3">…buttons…</div>
        column.Children.Add(BuildActions(display));

        // web <GlassPanel className="mx-auto max-w-2xl px-6 py-12 text-center">…</GlassPanel>
        var panel = new TsGlassPanel
        {
            Padding = new Thickness(24, 48, 24, 48),
            HorizontalAlignment = HorizontalAlignment.Center,
            MaxWidth = PanelMaxWidth,
            Content = column,
        };

        // web <PageContainer title={t('notFound.title')}>…</PageContainer>
        return new TsPageContainer
        {
            Title = display.PageTitle,
            PageContent = panel,
        };
    }

    private StackPanel BuildSuggestions(NotFoundDisplay display)
    {
        var section = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 24, 0, 0),
        };

        // web <p className="mb-2 text-sm text-[var(--text-muted)]">{didYouMean}</p>
        var didYouMean = new Caption
        {
            Value = display.DidYouMeanLabel,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        section.Children.Add(didYouMean);

        // web <ul className="flex flex-col items-center gap-2">{suggestions.map(...)}</ul>
        foreach (var suggestion in display.Suggestions)
        {
            section.Children.Add(BuildSuggestionLink(suggestion));
        }

        return section;
    }

    private HyperlinkButton BuildSuggestionLink(NotFoundSuggestionDisplay suggestion)
    {
        // web <Link to={s.path}>{label}<span className="ml-2 text-xs text-[var(--text-muted)]">{s.path}</span></Link>
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TextBlock
        {
            Text = suggestion.Label,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new TextBlock
        {
            Text = suggestion.Path,
            FontSize = 12,
            Foreground = Brush("TsColorTextMutedBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });

        var link = new HyperlinkButton
        {
            Content = row,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(link, suggestion.AutomationName);
        link.Click += (_, _) => _viewModel.NavigateToSuggestion(suggestion.Path);
        return link;
    }

    private StackPanel BuildActions(NotFoundDisplay display)
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 32, 0, 0),
        };

        // web <Button variant="ghost" icon={ArrowLeft}>{goBack}</Button> — ghost ≈ Subtle.
        var goBack = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            IconGlyph = NotFoundRegistration.BackGlyph,
            Text = display.GoBackLabel,
        };
        goBack.Click += (_, _) => _viewModel.GoBack();
        actions.Children.Add(goBack);

        // web <Button variant="primary" icon={Home}>{goHome}</Button>
        var goHome = new TsButton
        {
            Variant = ButtonVariant.Primary,
            IconGlyph = NotFoundRegistration.HomeGlyph,
            Text = display.GoHomeLabel,
        };
        goHome.Click += (_, _) => _viewModel.GoToDashboard();
        actions.Children.Add(goHome);

        // web <Button variant="ghost" icon={Search}>{openSearch}</Button> — ghost ≈ Subtle.
        var openSearch = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            IconGlyph = NotFoundRegistration.SearchGlyph,
            Text = display.OpenSearchLabel,
        };
        openSearch.Click += (_, _) => _viewModel.OpenCommandPalette();
        actions.Children.Add(openSearch);

        return actions;
    }

    private static Microsoft.UI.Xaml.Media.Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Microsoft.UI.Xaml.Media.Brush brush ? brush : null;
}
