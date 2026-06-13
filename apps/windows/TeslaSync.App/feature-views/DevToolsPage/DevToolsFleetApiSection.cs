using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>The outcome of one Fleet API tool run: a resolved payload, or an error message (never both).</summary>
internal readonly record struct DevToolsToolResult(object? Data, string? Error);

/// <summary>Runs one Fleet API dev-tool operation, returning the classified outcome (web <c>apiFetch</c>).</summary>
internal delegate Task<DevToolsToolResult> DevToolsToolRunner(string operation, CancellationToken cancellationToken);

/// <summary>
/// The native WinUI 3 Fleet API section hosted in the DevTools page's first tab — a parity port of
/// web/src/features/admin/components/devtools/FleetApiSection.tsx. It reproduces the web component's two
/// regions in order: the <b>Setup Wizard</b> (the seven-step Tesla Fleet API onboarding stepper, web
/// <c>OnboardingWorkflow</c> over <c>ONBOARDING_STEPS</c>) and the <b>Fleet API Tools</b> grid — the nine tool
/// cards (Config, Partner Registration, Partner Public Key, Public Key Setup, Vehicle Key Pairing, Telemetry
/// Subscribe, Telemetry Config, Fleet Status, Vehicle Data), each a shared <see cref="ToolCard"/> wrapping its
/// inputs, action buttons and a <see cref="ResultPanel"/>. Every tool fires through the injected
/// <see cref="DevToolsToolRunner"/>; the default runner reports that the Fleet API backend is unreachable from
/// the desktop build, so each tool surfaces an honest error result rather than a blank panel (ADR-011). All
/// copy resolves through the i18n facade and the surface is keyboard- and Narrator-navigable by construction.
/// </summary>
internal sealed partial class DevToolsFleetApiSection : ContentControl, IDisposable
{
    private const double RegionSpacing = 24;
    private const double CardSpacing = 16;
    private const double BodySpacing = 12;

    private readonly ILocalizer _localizer;
    private readonly DevToolsToolRunner _runner;
    private readonly List<TsButton> _actionButtons = new();
    private CancellationTokenSource? _cts;
    private bool _disposed;

    /// <summary>Creates the section over the localizer and an optional tool runner (defaults to the offline runner).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="runner">The operation runner; when null, an offline runner reporting an unreachable backend is used.</param>
    public DevToolsFleetApiSection(ILocalizer localizer, DevToolsToolRunner? runner = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _runner = runner ?? RunOfflineAsync;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        var root = new StackPanel { Spacing = RegionSpacing };
        root.Children.Add(BuildWizardRegion());
        root.Children.Add(BuildToolsRegion());

        AutomationProperties.SetName(this, _localizer.GetString("devtools.tab.fleetApi", "Fleet API"));
        Content = root;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<DevToolsToolResult> RunOfflineAsync(string operation, CancellationToken cancellationToken)
    {
        await Task.Yield();
        return new DevToolsToolResult(null, _localizer.GetString(
            "devtools.fleet.unreachable",
            "The Fleet API backend is not reachable from this build. Connect TeslaSync to run this tool."));
    }

    // ── Setup Wizard ─────────────────────────────────────────────────────────

    private StackPanel BuildWizardRegion()
    {
        var region = new StackPanel { Spacing = 8 };
        region.Children.Add(new SectionTitle { Value = _localizer.GetString("devtools.fleet.setupWizard", "Setup Wizard") });
        region.Children.Add(new DevToolsOnboardingWizard(_localizer));
        return region;
    }

    // ── Fleet API tool grid ──────────────────────────────────────────────────

    private StackPanel BuildToolsRegion()
    {
        var region = new StackPanel { Spacing = 8 };
        region.Children.Add(new SectionTitle { Value = _localizer.GetString("devtools.fleet.toolsTitle", "Fleet API Tools") });

        var grid = new StackPanel { Spacing = CardSpacing };
        grid.Children.Add(BuildConfigTool());
        grid.Children.Add(BuildPartnerRegistrationTool());
        grid.Children.Add(BuildPartnerPublicKeyTool());
        grid.Children.Add(BuildPublicKeySetupTool());
        grid.Children.Add(BuildVehicleKeyPairingTool());
        grid.Children.Add(BuildTelemetrySubscribeTool());
        grid.Children.Add(BuildTelemetryConfigTool());
        grid.Children.Add(BuildFleetStatusTool());
        grid.Children.Add(BuildVehicleDataTool());
        region.Children.Add(grid);
        return region;
    }

    private ToolCard BuildConfigTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        var fields = new StackPanel { Spacing = 8 };
        fields.Children.Add(InfoField("devtools.fleet.config.baseUrl", "Base URL"));
        fields.Children.Add(InfoField("devtools.fleet.config.clientId", "Client ID"));
        fields.Children.Add(InfoField("devtools.fleet.config.authStatus", "Auth Status"));
        fields.Children.Add(InfoField("devtools.fleet.config.regions", "Regions"));
        body.Children.Add(fields);

        var result = NewResult("devtools.fleet.config.title", "Configuration");
        body.Children.Add(ActionRow("devtools.fleet.config.reload", "Reload", "\uE72C", ButtonVariant.Secondary, "fleet-api-info", result));
        body.Children.Add(result);

        return Card("\uE713", "cyan", "devtools.fleet.config.title", "Configuration",
            "devtools.fleet.config.desc", "Current Fleet API client configuration and authentication state.", body);
    }

    private ToolCard BuildPartnerRegistrationTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        body.Children.Add(WarningNote("devtools.fleet.partnerReg.prereq",
            "Generate an EC key pair and host the public key at /.well-known before registering."));
        var domain = NewInput("yourapp.example.com");
        body.Children.Add(LabeledField("devtools.fleet.domain", "Domain", domain));
        var result = NewResult("devtools.fleet.partnerReg.title", "Partner Registration");
        body.Children.Add(ActionRow("devtools.fleet.partnerReg.register", "Register", "\uE768", ButtonVariant.Primary, "register-partner", result));
        body.Children.Add(result);

        return Card("\uE774", "green", "devtools.fleet.partnerReg.title", "Partner Registration",
            "devtools.fleet.partnerReg.desc", "Register this application as a Tesla Fleet API partner.", body);
    }

    private ToolCard BuildPartnerPublicKeyTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        var domain = NewInput("yourapp.example.com");
        body.Children.Add(LabeledField("devtools.fleet.domain", "Domain", domain));
        var result = NewResult("devtools.fleet.partnerKey.title", "Public Key Verification");
        body.Children.Add(ActionRow("devtools.fleet.partnerKey.verify", "Verify", "\uE768", ButtonVariant.Primary, "partner-public-key", result));
        body.Children.Add(result);

        return Card("\uE72E", "cyan", "devtools.fleet.partnerKey.title", "Public Key Verification",
            "devtools.fleet.partnerKey.desc", "Verify your registered public key with Tesla.", body);
    }

    private ToolCard BuildPublicKeySetupTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        body.Children.Add(LabeledValue("devtools.fleet.status", "Status", _localizer.GetString("devtools.fleet.notConfigured", "Not Configured")));
        body.Children.Add(WarningNote("devtools.fleet.publicKey.warning",
            "Keep the private key secret. It is never displayed or transmitted by this tool."));

        var keyResult = NewResult("devtools.fleet.publicKey.keypair", "Key Pair");
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(MakeButton("devtools.fleet.publicKey.generate", "Generate Keypair", "\uE192", ButtonVariant.Primary, "generate-keypair", keyResult));
        actions.Children.Add(MakeButton("devtools.fleet.publicKey.delete", "Delete Keypair", "\uE74D", ButtonVariant.Destructive, "public-key", keyResult));
        body.Children.Add(actions);
        body.Children.Add(keyResult);

        var pem = new TsTextarea { AcceptsReturn = true, Height = 96, Hint = _localizer.GetString("devtools.fleet.publicKey.pemHint", "Paste a PEM-encoded public key") };
        body.Children.Add(LabeledField("devtools.fleet.publicKey.upload", "Upload PEM", pem));
        var uploadResult = NewResult("devtools.fleet.publicKey.upload", "Upload PEM");
        body.Children.Add(ActionRow("devtools.fleet.publicKey.uploadKey", "Upload Key", "\uE898", ButtonVariant.Secondary, "upload-public-key", uploadResult));
        body.Children.Add(uploadResult);

        return Card("\uE192", "purple", "devtools.fleet.publicKey.title", "Public Key Setup",
            "devtools.fleet.publicKey.desc", "Generate, upload or remove the Fleet API public key.", body);
    }

    private ToolCard BuildVehicleKeyPairingTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        body.Children.Add(LabeledValue("devtools.fleet.pairing.url", "Pairing URL", "https://tesla.com/_ak/yourapp.example.com"));
        body.Children.Add(new Caption
        {
            Value = _localizer.GetString("devtools.fleet.pairing.desc",
                "Open this link on a phone paired with the vehicle to authorize command access."),
        });

        return Card("\uE804", "green", "devtools.fleet.pairing.title", "Vehicle Key Pairing",
            "devtools.fleet.pairing.cardDesc", "Pair the public key with each vehicle for command access.", body);
    }

    private ToolCard BuildTelemetrySubscribeTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        body.Children.Add(LabeledField("devtools.fleet.vehicle", "Vehicle", NewVehicleSelect()));
        var result = NewResult("devtools.fleet.telemetrySub.title", "Telemetry Subscription");
        body.Children.Add(ActionRow("devtools.fleet.telemetrySub.subscribe", "Subscribe", "\uE768", ButtonVariant.Primary, "fleet-telemetry-subscribe", result));
        body.Children.Add(result);

        return Card("\uE701", "cyan", "devtools.fleet.telemetrySub.title", "Telemetry Subscription",
            "devtools.fleet.telemetrySub.desc", "Subscribe a vehicle to Fleet Telemetry streaming.", body);
    }

    private ToolCard BuildTelemetryConfigTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        body.Children.Add(LabeledField("devtools.fleet.vehicle", "Vehicle", NewVehicleSelect()));
        var result = NewResult("devtools.fleet.telemetryConfig.title", "Telemetry Config");
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(MakeButton("devtools.fleet.telemetryConfig.fetch", "Fetch Config", "\uE72C", ButtonVariant.Secondary, "fleet-telemetry-config", result));
        actions.Children.Add(MakeButton("devtools.fleet.telemetryConfig.delete", "Delete Config", "\uE74D", ButtonVariant.Destructive, "fleet-telemetry-config-delete", result));
        body.Children.Add(actions);
        body.Children.Add(result);

        return Card("\uEC05", "purple", "devtools.fleet.telemetryConfig.title", "Telemetry Config",
            "devtools.fleet.telemetryConfig.desc", "Inspect or remove a vehicle's Fleet Telemetry configuration.", body);
    }

    private ToolCard BuildFleetStatusTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        var result = NewResult("devtools.fleet.status.title", "Fleet Status");
        body.Children.Add(ActionRow("devtools.fleet.status.check", "Check Fleet Status", "\uE768", ButtonVariant.Primary, "fleet-status", result));
        body.Children.Add(result);

        return Card("\uE945", "green", "devtools.fleet.status.title", "Fleet Status",
            "devtools.fleet.status.desc", "Check Fleet API status for all vehicles.", body);
    }

    private ToolCard BuildVehicleDataTool()
    {
        var body = new StackPanel { Spacing = BodySpacing };
        body.Children.Add(LabeledField("devtools.fleet.vehicle", "Vehicle", NewVehicleSelect()));
        var result = NewResult("devtools.fleet.vehicleData.title", "Vehicle Data");
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(MakeButton("devtools.fleet.vehicleData.charging", "Nearby Charging", "\uE7F7", ButtonVariant.Secondary, "nearby-charging", result));
        actions.Children.Add(MakeButton("devtools.fleet.vehicleData.releaseNotes", "Release Notes", "\uE7C3", ButtonVariant.Secondary, "release-notes", result));
        actions.Children.Add(MakeButton("devtools.fleet.vehicleData.alerts", "Recent Alerts", "\uE7BA", ButtonVariant.Secondary, "recent-alerts", result));
        actions.Children.Add(MakeButton("devtools.fleet.vehicleData.service", "Service Data", "\uE90F", ButtonVariant.Secondary, "service-data", result));
        body.Children.Add(actions);
        body.Children.Add(result);

        return Card("\uE804", "cyan", "devtools.fleet.vehicleData.title", "Vehicle Data",
            "devtools.fleet.vehicleData.desc", "Fetch read-only Fleet API data for a selected vehicle.", body);
    }

    // ── building helpers ─────────────────────────────────────────────────────

    private ToolCard Card(string glyph, string accent, string titleKey, string titleFallback, string descKey, string descFallback, UIElement body) =>
        new()
        {
            IconGlyph = glyph,
            Accent = accent,
            Title = _localizer.GetString(titleKey, titleFallback),
            Description = _localizer.GetString(descKey, descFallback),
            Body = body,
        };

    private StackPanel LabeledField(string labelKey, string labelFallback, FrameworkElement control)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new Caption { Value = _localizer.GetString(labelKey, labelFallback) });
        stack.Children.Add(control);
        return stack;
    }

    private StackPanel LabeledValue(string labelKey, string labelFallback, string value)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new Caption { Value = _localizer.GetString(labelKey, labelFallback) });
        var valueText = new TextBlock
        {
            Text = value,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
        };
        if (TypographyTokens.Mono is { } mono)
        {
            valueText.FontFamily = mono;
        }

        stack.Children.Add(valueText);
        return stack;
    }

    private StackPanel InfoField(string labelKey, string labelFallback) =>
        LabeledValue(labelKey, labelFallback, "\u2014");

    private Caption WarningNote(string key, string fallback) => new()
    {
        Value = _localizer.GetString(key, fallback),
    };

    private static TsInput NewInput(string hint) => new()
    {
        Hint = hint,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private TsSelect NewVehicleSelect() => new()
    {
        Hint = _localizer.GetString("devtools.fleet.selectVehicle", "Select Vehicle"),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private ResultPanel NewResult(string titleKey, string titleFallback) => new(_localizer)
    {
        Title = _localizer.GetString(titleKey, titleFallback),
        IdleMessage = _localizer.GetString("devtools.fleet.idle", "Run this tool to see results"),
    };

    private StackPanel ActionRow(string labelKey, string labelFallback, string glyph, ButtonVariant variant, string operation, ResultPanel result)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(MakeButton(labelKey, labelFallback, glyph, variant, operation, result));
        return row;
    }

    private TsButton MakeButton(string labelKey, string labelFallback, string glyph, ButtonVariant variant, string operation, ResultPanel result)
    {
        var label = _localizer.GetString(labelKey, labelFallback);
        var button = new TsButton
        {
            Variant = variant,
            Size = ControlSize.Small,
            IconGlyph = glyph,
            Content = label,
        };
        AutomationProperties.SetName(button, label);
        button.Click += async (_, _) => await RunToolAsync(button, operation, result).ConfigureAwait(true);
        _actionButtons.Add(button);
        return button;
    }

    private async Task RunToolAsync(TsButton button, string operation, ResultPanel result)
    {
        if (_disposed)
        {
            return;
        }

        button.IsLoading = true;
        result.Error = null;
        result.Data = null;
        try
        {
            var cts = new CancellationTokenSource();
            var previous = Interlocked.Exchange(ref _cts, cts);
            previous?.Cancel();
            previous?.Dispose();

            var outcome = await _runner(operation, cts.Token).ConfigureAwait(true);
            result.Error = outcome.Error;
            result.Data = outcome.Data;
        }
        catch (OperationCanceledException)
        {
            // Superseded or disposed — leave the panel untouched.
        }
        catch (Exception ex)
        {
            result.Error = ex.Message;
        }
        finally
        {
            button.IsLoading = false;
        }
    }
}
