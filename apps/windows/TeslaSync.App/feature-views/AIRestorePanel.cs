using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>AIRestorePanel</c> feature surface — a parity port of
/// <c>web/src/features/settings/components/AIRestorePanel.tsx</c>. Like the web component it is a pure, controlled
/// presentational control: the hosting AI-settings page owns the data and decides when to mount it, so there is
/// no fetch-driven loading / error / stale / offline branch to reproduce — the web component never fetches. Given
/// the archived AI-feature snapshot it renders, inside a tokenized purple-accented alert region (web
/// <c>role="alert" aria-live="polite"</c>), the web composition: a <see cref="AIRestorePanelRegistration.SparkleGlyph"/>
/// mark beside the <see cref="Subhead"/> title and <see cref="Caption"/> description, the optional bulleted preview
/// of archived feature labels (web <c>labels.length &gt; 0</c>), and a right-aligned action row with a
/// subtle decline button (web <c>variant="ghost"</c>) and a primary restore button (web <c>variant="primary"</c>).
/// The decline raises <see cref="DeclineRequested"/> (web <c>onDecline</c>) and the restore raises
/// <see cref="ConfirmRequested"/> (web <c>onConfirm</c>); the host applies the archived selection and persists it.
/// Every conditional, label and fallback is resolved in the WinUI-free <see cref="AIRestorePanelProjection"/>. The
/// alert region carries the composed prompt as its Narrator name and announces on appearance, the sparkle mark is
/// hidden from Narrator (web <c>aria-hidden</c>), and the surface, decline and restore controls carry the web
/// <c>data-testid</c> values as automation ids. Every string resolves through the i18n facade.
/// </summary>
public sealed partial class AIRestorePanel : ContentControl
{
    private const double PanelPadding = 16;     // web p-4
    private const double SectionSpacing = 8;    // web space-y-2
    private const double HeaderGap = 8;         // web gap-2
    private const double TextSpacing = 2;       // label/description/list rhythm
    private const double ListTopMargin = 8;     // web mt-2
    private const double ButtonGap = 8;         // web gap-2
    private const double IconSize = 16;         // web h-4 w-4
    private const double IconTopNudge = 2;      // web mt-0.5
    private const double BulletFontSize = 12;   // web text-xs
    private const double SectionBorderThickness = 1;

    /// <summary>The web <c>data-testid</c> for the section root.</summary>
    public const string RootAutomationId = "ai-restore-panel";

    /// <summary>The web <c>data-testid</c> for the decline affordance.</summary>
    public const string DeclineAutomationId = "ai-restore-decline";

    /// <summary>The web <c>data-testid</c> for the confirm affordance.</summary>
    public const string ConfirmAutomationId = "ai-restore-confirm";

    // web border-purple-400/40 + bg-purple-500/5 + the purple-300 sparkle: the codebase maps "web purple" to
    // the Power chart-role brush so light / dark / high-contrast all flow from the generated token set.
    private const string PurpleAccentKey = "TsChartPowerBrush";

    private readonly ILocalizer _localizer;
    private readonly AIRestorePanelDiagnostics _diagnostics;
    private readonly Border _section;
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private AIRestorePanelModel _model;
    private bool _opened;

    /// <summary>Creates the surface over the i18n facade, the initial archived snapshot and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the web <c>useTranslation</c> seam).</param>
    /// <param name="archived">The initial archived opt-in snapshot (web <c>archived</c> prop); null / empty is the empty state.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AIRestorePanel(
        ILocalizer localizer,
        IReadOnlyDictionary<string, bool>? archived = null,
        AIRestorePanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AIRestorePanelDiagnostics();
        _model = AIRestorePanelModel.For(archived);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _section = new Border
        {
            BorderBrush = DisplayTokens.Brush(PurpleAccentKey),
            BorderThickness = new Thickness(SectionBorderThickness),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 6),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(PanelPadding),
            Child = _root,
        };
        Content = _section;

        AutomationProperties.SetAutomationId(this, RootAutomationId);
        LiveRegion.Configure(_section); // web role="alert" aria-live="polite"

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes the restore affordance (the native analogue of the web <c>onConfirm</c>).</summary>
    public event EventHandler? ConfirmRequested;

    /// <summary>Raised when the user invokes the decline affordance (the native analogue of the web <c>onDecline</c>).</summary>
    public event EventHandler? DeclineRequested;

    /// <summary>The canonical surface id (<c>AIRestorePanel</c>).</summary>
    public static string SurfaceId => AIRestorePanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public AIRestorePanelModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>Replace the archived snapshot and re-render (the native analogue of a new <c>archived</c> prop).</summary>
    /// <param name="archived">The archived opt-in snapshot, or null / empty for the empty state.</param>
    public void SetArchived(IReadOnlyDictionary<string, bool>? archived)
    {
        _model = AIRestorePanelModel.For(archived);
        Render();
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        _root.Children.Clear();

        AIRestorePanelDisplay display = AIRestorePanelProjection.Project(_model, _localizer);

        // The whole alert region announces the prompt (web role="alert"); the control mirrors that Narrator name.
        AutomationProperties.SetName(this, display.AutomationName);
        AutomationProperties.SetName(_section, display.AutomationName);

        _root.Children.Add(BuildHeader(display));
        _root.Children.Add(BuildActions(display));

        LiveRegion.Announce(_section);
    }

    // web: <div className="flex items-start gap-2"><Sparkles/><div className="flex-1 min-w-0">…</div></div>
    private static Grid BuildHeader(AIRestorePanelDisplay display)
    {
        var header = new Grid { ColumnSpacing = HeaderGap };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        FontIcon icon = BuildIcon();
        Grid.SetColumn(icon, 0);
        header.Children.Add(icon);

        var text = new StackPanel { Spacing = TextSpacing };
        text.Children.Add(new Subhead { Value = display.Title });
        text.Children.Add(new Caption { Value = display.Description });
        if (display.HasLabels)
        {
            text.Children.Add(BuildLabelList(display.Labels));
        }

        Grid.SetColumn(text, 1);
        header.Children.Add(text);
        return header;
    }

    // web: <Sparkles className="h-4 w-4 text-purple-300 mt-0.5" aria-hidden />
    private static FontIcon BuildIcon()
    {
        var icon = new FontIcon
        {
            Glyph = AIRestorePanelRegistration.SparkleGlyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.Brush(PurpleAccentKey),
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, IconTopNudge, 0, 0),
        };

        // Decorative — the prompt is carried by the surrounding text and the alert region's Narrator name.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    // web: <ul className="mt-2 list-disc list-inside text-xs text-[var(--text-secondary)]">{labels.map(...)}</ul>
    private static StackPanel BuildLabelList(IReadOnlyList<string> labels)
    {
        var list = new StackPanel { Spacing = 0, Margin = new Thickness(0, ListTopMargin, 0, 0) };
        foreach (string label in labels)
        {
            list.Children.Add(new TextBlock
            {
                Text = "\u2022  " + label,
                FontSize = BulletFontSize,
                Foreground = DisplayTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        return list;
    }

    // web: <div className="flex items-center justify-end gap-2"><Button ghost/><Button primary/></div>
    private StackPanel BuildActions(AIRestorePanelDisplay display)
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ButtonGap,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        var decline = new TsButton { Variant = ButtonVariant.Subtle, Text = display.DeclineLabel };
        AutomationProperties.SetName(decline, display.DeclineLabel);
        AutomationProperties.SetAutomationId(decline, DeclineAutomationId);
        decline.Click += OnDeclineClick;

        var restore = new TsButton { Variant = ButtonVariant.Primary, Text = display.RestoreLabel };
        AutomationProperties.SetName(restore, display.RestoreLabel);
        AutomationProperties.SetAutomationId(restore, ConfirmAutomationId);
        restore.Click += OnConfirmClick;

        actions.Children.Add(decline);
        actions.Children.Add(restore);
        return actions;
    }

    private void OnDeclineClick(object sender, RoutedEventArgs e) =>
        DeclineRequested?.Invoke(this, EventArgs.Empty);

    private void OnConfirmClick(object sender, RoutedEventArgs e) =>
        ConfirmRequested?.Invoke(this, EventArgs.Empty);
}
