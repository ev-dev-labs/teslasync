using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>AIFeatureToggleList</c> feature surface — a parity port of
/// <c>web/src/features/settings/components/AIFeatureToggleList.tsx</c>. Like the web component it is a pure,
/// controlled presentational control: it maps over the canonical <see cref="AiFeatureRegistry"/> (the native
/// mirror of the web <c>AI_FEATURE_IDS</c> registry — never hand-listed) and renders, inside a tokenized
/// hairline-bordered section, a <see cref="Subhead"/> legend above one row per feature. Each row shows the
/// feature label (web <c>text-sm font-medium</c>) and its <see cref="Caption"/> description beside a
/// <see cref="TsToggle"/> whose state is the controlled <see cref="Values"/> map (web
/// <c>checked={Boolean(values[id])}</c>) and whose change raises <see cref="FeatureToggled"/> (the native
/// analogue of the web <c>onToggle(id, value)</c> callback). The hosting settings page owns persistence; the
/// control never performs HTTP, so there is no fetch-driven loading / error / stale / offline branch to
/// reproduce — the web component never fetches. Every conditional, label and fallback is resolved in the
/// WinUI-free <see cref="AIFeatureToggleListProjection"/>. The section carries the legend as its Narrator name
/// (web <c>aria-label</c>), every toggle carries the feature label as its Narrator name (web
/// <c>aria-label={label}</c>), and the surface, rows and toggles carry the web <c>data-testid</c> values as
/// automation ids. Every string resolves through the i18n facade.
/// </summary>
public sealed partial class AIFeatureToggleList : ContentControl
{
    private const double SectionPadding = 16;    // web p-4
    private const double SectionSpacing = 8;     // web space-y-2
    private const double RowColumnGap = 12;      // web gap-3
    private const double RowPaddingX = 8;        // web px-2
    private const double RowPaddingY = 8;        // web py-2
    private const double LabelDescriptionGap = 2;
    private const double LabelFontSize = 14;     // web text-sm

    /// <summary>The web <c>data-testid</c> for the section root.</summary>
    public const string RootAutomationId = "ai-feature-toggle-list";

    private readonly ILocalizer _localizer;
    private readonly AIFeatureToggleListDiagnostics _diagnostics;
    private readonly Dictionary<string, bool> _values;
    private readonly Border _section;
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private bool _opened;

    /// <summary>Creates the surface over the i18n facade, the initial controlled values and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the web <c>useTranslation</c> seam).</param>
    /// <param name="values">The initial controlled opt-in map (web <c>values</c> prop); unknown ids default off.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AIFeatureToggleList(
        ILocalizer localizer,
        IReadOnlyDictionary<string, bool>? values = null,
        AIFeatureToggleListDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AIFeatureToggleListDiagnostics();
        _values = values is null
            ? new Dictionary<string, bool>(StringComparer.Ordinal)
            : new Dictionary<string, bool>(values, StringComparer.Ordinal);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _section = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 6),
            Padding = new Thickness(SectionPadding),
            Child = _root,
        };
        Content = _section;
        AutomationProperties.SetAutomationId(this, RootAutomationId);

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when a feature toggle changes (the native analogue of the web <c>onToggle</c> callback).</summary>
    public event EventHandler<AiFeatureToggleChangedEventArgs>? FeatureToggled;

    /// <summary>The canonical surface id (<c>AIFeatureToggleList</c>).</summary>
    public static string SurfaceId => AIFeatureToggleListRegistration.Slug;

    /// <summary>The current controlled opt-in map (web <c>values</c> prop), keyed by feature id.</summary>
    public IReadOnlyDictionary<string, bool> Values => _values;

    /// <summary>Replace the controlled values and re-render (the native analogue of a new <c>values</c> prop).</summary>
    public void SetValues(IReadOnlyDictionary<string, bool>? values)
    {
        _values.Clear();
        if (values is not null)
        {
            foreach (var pair in values)
            {
                _values[pair.Key] = pair.Value;
            }
        }

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

        var display = AIFeatureToggleListProjection.Project(_localizer, _values);

        // Web: the <section> carries the legend as its aria-label, and the legend also renders as the heading.
        AutomationProperties.SetName(this, display.Legend);
        _root.Children.Add(new Subhead { Value = display.Legend });

        if (!display.HasRows)
        {
            _root.Children.Add(BuildEmpty());
            return;
        }

        var list = new StackPanel { Spacing = SectionSpacing };
        AutomationProperties.SetName(list, display.Legend);
        foreach (var row in display.Rows)
        {
            list.Children.Add(BuildRow(row));
        }

        _root.Children.Add(list);
    }

    private Grid BuildRow(AiFeatureToggleRow row)
    {
        var grid = new Grid
        {
            ColumnSpacing = RowColumnGap,
            Padding = new Thickness(RowPaddingX, RowPaddingY, RowPaddingX, RowPaddingY),
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        AutomationProperties.SetAutomationId(grid, $"ai-feature-row-{row.Id}");

        var textColumn = new StackPanel
        {
            Spacing = LabelDescriptionGap,
            VerticalAlignment = VerticalAlignment.Top,
        };
        textColumn.Children.Add(new TextBlock
        {
            Text = row.Label,
            FontSize = LabelFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });
        if (row.HasDescription)
        {
            textColumn.Children.Add(new Caption { Value = row.Description });
        }

        Grid.SetColumn(textColumn, 0);

        var toggle = new TsToggle
        {
            IsOn = row.IsOn,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(toggle, row.AutomationName);
        AutomationProperties.SetAutomationId(toggle, $"ai-feature-toggle-{row.Id}");
        toggle.Toggled += (_, _) => OnToggled(row.Id, toggle.IsOn);
        Grid.SetColumn(toggle, 1);

        grid.Children.Add(textColumn);
        grid.Children.Add(toggle);
        return grid;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = AIFeatureToggleListRegistration.EmptyGlyph,
        Message = AIFeatureToggleListRegistration.EmptyMessage(_localizer),
    };

    private void OnToggled(string id, bool isOn)
    {
        _values[id] = isOn;
        FeatureToggled?.Invoke(this, new AiFeatureToggleChangedEventArgs(id, isOn));
    }
}

/// <summary>
/// The payload of <see cref="AIFeatureToggleList.FeatureToggled"/> — the native analogue of the web
/// <c>onToggle(id, value)</c> arguments: the feature <see cref="FeatureId"/> and its new <see cref="IsOn"/>
/// state. The hosting page persists the change through its own settings write path.
/// </summary>
public sealed class AiFeatureToggleChangedEventArgs : EventArgs
{
    /// <summary>Creates the event payload.</summary>
    public AiFeatureToggleChangedEventArgs(string featureId, bool isOn)
    {
        FeatureId = featureId;
        IsOn = isOn;
    }

    /// <summary>The toggled feature id (web <c>id</c>).</summary>
    public string FeatureId { get; }

    /// <summary>The new opt-in state (web <c>value</c>).</summary>
    public bool IsOn { get; }
}
