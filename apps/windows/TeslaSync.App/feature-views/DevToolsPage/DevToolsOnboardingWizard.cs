using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The Fleet API onboarding stepper — a parity port of the web <c>OnboardingWorkflow</c> inside
/// FleetApiSection.tsx, driven by the seven <c>ONBOARDING_STEPS</c>. It shows one step at a time inside a glass
/// card (a progress caption, the step's accent icon, localized label and description) with Previous / Mark
/// Complete / Next controls. The step index and per-step completion are local UI state (web <c>useState</c>);
/// every visible string resolves through the i18n facade.
/// </summary>
internal sealed partial class DevToolsOnboardingWizard : ContentControl
{
    private sealed record Step(string Glyph, string LabelKey, string LabelFallback, string DescKey, string DescFallback);

    private static readonly IReadOnlyList<Step> Steps =
    [
        new("\uE192", "devtools.fleet.step.account.label", "Tesla Developer Account", "devtools.fleet.step.account.desc", "Create a Tesla Developer account at developer.tesla.com"),
        new("\uE7C3", "devtools.fleet.step.application.label", "Create Application", "devtools.fleet.step.application.desc", "Register a new application in the Tesla Developer Portal"),
        new("\uE192", "devtools.fleet.step.keypair.label", "Generate Key Pair", "devtools.fleet.step.keypair.desc", "Generate an EC private/public key pair for Fleet API authentication"),
        new("\uE774", "devtools.fleet.step.register.label", "Register Partner", "devtools.fleet.step.register.desc", "Register as a Fleet API partner with your public key"),
        new("\uE72E", "devtools.fleet.step.auth.label", "Authorize Account", "devtools.fleet.step.auth.desc", "Complete OAuth2 authorization to get API access tokens"),
        new("\uE71B", "devtools.fleet.step.pair.label", "Pair Vehicle Key", "devtools.fleet.step.pair.desc", "Pair your public key with each vehicle for command access"),
        new("\uE701", "devtools.fleet.step.telemetry.label", "Fleet Telemetry", "devtools.fleet.step.telemetry.desc", "Configure Fleet Telemetry streaming for real-time data"),
    ];

    private readonly ILocalizer _localizer;
    private readonly bool[] _completed = new bool[Steps.Count];
    private readonly TsGlassPanel _panel = new() { Padding = new Thickness(20) };
    private int _current;

    public DevToolsOnboardingWizard(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _panel;
        Render();
    }

    private void Render()
    {
        var step = Steps[_current];
        var column = new StackPanel { Spacing = 12 };

        var progressTemplate = _localizer.GetString("devtools.fleet.wizard.progress", "Step {0} of {1}");
        column.Children.Add(new Caption
        {
            Value = string.Format(CultureInfo.CurrentCulture, progressTemplate, _current + 1, Steps.Count),
        });

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        var icon = new FontIcon { Glyph = step.Glyph, FontSize = 20, Foreground = DisplayTokens.Accent };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
        header.Children.Add(icon);
        header.Children.Add(new PanelTitle { Value = _localizer.GetString(step.LabelKey, step.LabelFallback) });
        column.Children.Add(header);

        column.Children.Add(new Caption { Value = _localizer.GetString(step.DescKey, step.DescFallback) });

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(NavButton("devtools.fleet.wizard.previous", "Previous", "\uE76B", ButtonVariant.Subtle, _current == 0, () => Move(-1)));

        bool done = _completed[_current];
        var completeButton = new TsButton
        {
            Variant = done ? ButtonVariant.Secondary : ButtonVariant.Primary,
            Size = ControlSize.Small,
            IconGlyph = "\uE73E",
            Content = done
                ? _localizer.GetString("devtools.fleet.wizard.completed", "Completed")
                : _localizer.GetString("devtools.fleet.wizard.markComplete", "Mark Complete"),
        };
        AutomationProperties.SetName(completeButton, (string)completeButton.Content);
        completeButton.Click += (_, _) => MarkComplete();
        actions.Children.Add(completeButton);

        actions.Children.Add(NavButton("devtools.fleet.wizard.next", "Next", "\uE76C", ButtonVariant.Subtle, _current == Steps.Count - 1, () => Move(1)));
        column.Children.Add(actions);

        _panel.Content = column;
    }

    private TsButton NavButton(string labelKey, string labelFallback, string glyph, ButtonVariant variant, bool disabled, Action onClick)
    {
        var label = _localizer.GetString(labelKey, labelFallback);
        var button = new TsButton
        {
            Variant = variant,
            Size = ControlSize.Small,
            IconGlyph = glyph,
            Content = label,
            IsEnabled = !disabled,
        };
        AutomationProperties.SetName(button, label);
        button.Click += (_, _) => onClick();
        return button;
    }

    private void Move(int delta)
    {
        int next = Math.Clamp(_current + delta, 0, Steps.Count - 1);
        if (next == _current)
        {
            return;
        }

        _current = next;
        Render();
    }

    private void MarkComplete()
    {
        _completed[_current] = !_completed[_current];
        Render();
    }
}
