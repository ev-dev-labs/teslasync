namespace TeslaSync.App.UITests.Fixtures;

/// <summary>
/// Thrown when the UI automation suite cannot execute because the WinAppDriver/Appium runner or the
/// packaged app under test is absent. It is deliberately a hard failure, not an xUnit skip: an absent
/// runner is an honest BLOCKED condition the W9-0002 gate must see as red, never as a silent pass.
/// The message always carries the precise, actionable reason from <c>RunnerAvailability.Probe()</c>.
/// </summary>
public sealed class UiAutomationUnavailableException(string reason)
    : Exception("UI automation cannot run: " + reason);
