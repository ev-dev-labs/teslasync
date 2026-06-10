using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SettingField</c> feature surface — a parity port of
/// web/src/features/settings/components/SettingField.tsx. It is a pure presentational wrapper: it lays out a
/// tokenized field label (the web <c>uppercase</c>, muted, wide-tracked <c>&lt;label&gt;</c>) with an optional
/// inline help affordance beside it, and renders the supplied <see cref="Field"/> control (the web
/// <c>children</c>) below. Because the web source has no fetch lifecycle, there is no loading / error / stale /
/// offline branch to reproduce here — the parent settings page owns the query lifecycle and only mounts a
/// resolved field. The only conditional render is the help affordance, which appears exactly when a
/// <see cref="SettingFieldHelp"/> resolves to non-empty text (the web <c>{help &amp;&amp; &lt;HelpIcon&gt;}</c>
/// gate together with the icon's own empty-text suppression). The help affordance is the shared
/// <see cref="TsHelpTooltip"/>; its tooltip / description carry the resolved help text while its accessible name
/// reproduces the web <c>aria-label</c> ("Help for {id}" or "More info"). The label's natural casing is exposed
/// to Narrator even though it is displayed upper-cased, all copy resolves through the i18n facade, and the view
/// never performs HTTP — every branch selection and copy resolution happens in the WinUI-free
/// <see cref="SettingFieldProjection"/>.
/// </summary>
public sealed partial class SettingField : ContentControl
{
    private const double LabelRowSpacing = 4;      // web gap-1
    private const double FieldSpacing = 6;         // web mb-1.5 (label row → field)
    private const double LabelTrackingWider = 50;  // web tracking-wider (0.05em → 50/1000 em)

    private readonly ILocalizer _localizer;
    private readonly SettingFieldDiagnostics _diagnostics;
    private readonly StackPanel _root = new() { Spacing = FieldSpacing };

    private SettingFieldModel _model;
    private UIElement? _field;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, an optional field, and diagnostics.</summary>
    /// <param name="localizer">The i18n facade the help text and accessible name resolve through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SettingFieldModel.Unlabeled"/>.</param>
    /// <param name="field">The field control rendered under the label (the web <c>children</c>), or null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SettingField(
        ILocalizer localizer,
        SettingFieldModel? model = null,
        UIElement? field = null,
        SettingFieldDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SettingFieldModel.Unlabeled;
        _field = field;
        _diagnostics = diagnostics ?? new SettingFieldDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        Content = _root;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SettingField</c>).</summary>
    public static string Slug => SettingFieldRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SettingFieldModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The field control rendered under the label (the web <c>children</c>); reassigning re-renders.</summary>
    public UIElement? Field
    {
        get => _field;
        set
        {
            _field = value;
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
        var display = SettingFieldProjection.Project(_model, _localizer);

        // Rebuild in place so the caller-owned field can be re-parented across re-renders without tripping the
        // "element already has a parent" guard.
        _root.Children.Clear();
        _root.Children.Add(BuildLabelRow(display));
        if (_field is not null)
        {
            _root.Children.Add(_field);
        }
    }

    private static StackPanel BuildLabelRow(SettingFieldDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LabelRowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.DisplayLabel,
            FontSize = TypographyTokens.Size("TsTypeLabelFontSize", 12),
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = (int)LabelTrackingWider,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The label is displayed upper-cased (web `uppercase`) but spoken in its natural casing.
        AutomationProperties.SetName(label, display.Label);
        row.Children.Add(label);

        if (display.HasHelp)
        {
            var help = new TsHelpTooltip { VerticalAlignment = VerticalAlignment.Center };

            // Setting Hint installs the visual tooltip and a default Narrator name; override the name with the
            // web aria-label ("Help for {id}" / "More info") and keep the help text as the spoken description.
            help.Hint = display.HelpText;
            AutomationProperties.SetName(help, display.HelpAccessibleName);
            AutomationProperties.SetHelpText(help, display.HelpText);
            row.Children.Add(help);
        }

        return row;
    }
}
