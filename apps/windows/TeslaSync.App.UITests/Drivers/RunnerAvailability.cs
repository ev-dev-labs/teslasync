using System.Net.Sockets;

namespace TeslaSync.App.UITests.Drivers;

/// <summary>
/// The outcome of probing whether this machine can actually run the UI automation suite: a reachable
/// (or launchable) WinAppDriver endpoint plus a resolvable application under test. The probe is the
/// single honest gate between "the harness is wired" and "the harness can execute" — when the runner
/// or app is missing the suite reports <see cref="Available"/> = false and a precise
/// <see cref="Reason"/>, and the tests fail with that reason rather than being silently skipped.
/// </summary>
/// <param name="Available">True only when both a driver endpoint and an app identity are present.</param>
/// <param name="DriverReady">True when WinAppDriver is reachable or a local WinAppDriver.exe exists.</param>
/// <param name="AppIdentity">The resolved AUMID / exe path, or null.</param>
/// <param name="DriverUri">The driver endpoint the suite will use.</param>
/// <param name="Reason">Human-readable explanation when <see cref="Available"/> is false.</param>
public sealed record RunnerAvailability(
    bool Available,
    bool DriverReady,
    string? AppIdentity,
    Uri DriverUri,
    string Reason)
{
    /// <summary>The default WinAppDriver endpoint when <c>TESLASYNC_UIA_DRIVER_URL</c> is unset.</summary>
    public const string DefaultDriverUrl = "http://127.0.0.1:4723";

    /// <summary>
    /// Probe the environment: resolve the driver endpoint (env override or default), check whether it is
    /// reachable now or could be started from a local WinAppDriver.exe, and resolve the app identity.
    /// </summary>
    public static RunnerAvailability Probe()
    {
        var driverUri = ResolveDriverUri();
        var app = AppHostLocator.Resolve();

        var endpointReachable = IsEndpointReachable(driverUri, TimeSpan.FromMilliseconds(750));
        using var driver = WinAppDriverProcess.Locate();
        var driverReady = endpointReachable || driver.Found;

        var missing = new List<string>();
        if (!driverReady)
        {
            missing.Add(
                $"WinAppDriver/Appium runner is absent: nothing is listening on {driverUri} and " +
                "WinAppDriver.exe was not found at its standard install paths or on PATH");
        }

        if (string.IsNullOrWhiteSpace(app))
        {
            missing.Add(
                "the packaged TeslaSync app under test could not be resolved " +
                "(set TESLASYNC_UIA_APP to its AUMID, deploy the MSIX, or build TeslaSync.App)");
        }

        var available = missing.Count == 0;
        var reason = available
            ? "WinAppDriver runner and TeslaSync app are both present."
            : string.Join("; ", missing) + ".";

        return new RunnerAvailability(available, driverReady, app, driverUri, reason);
    }

    /// <summary>Resolve the driver endpoint from <c>TESLASYNC_UIA_DRIVER_URL</c> or the default.</summary>
    public static Uri ResolveDriverUri()
    {
        var raw = Environment.GetEnvironmentVariable("TESLASYNC_UIA_DRIVER_URL");
        return Uri.TryCreate(string.IsNullOrWhiteSpace(raw) ? DefaultDriverUrl : raw.Trim(), UriKind.Absolute, out var uri)
            ? uri
            : new Uri(DefaultDriverUrl);
    }

    /// <summary>True when a TCP connection to the driver endpoint succeeds within <paramref name="timeout"/>.</summary>
    public static bool IsDriverReachable(Uri uri, TimeSpan timeout)
    {
        try
        {
            using var client = new TcpClient();
            var connect = client.BeginConnect(uri.Host, uri.Port, null, null);
            var ok = connect.AsyncWaitHandle.WaitOne(timeout);
            if (ok && client.Connected)
            {
                client.EndConnect(connect);
                return true;
            }

            return false;
        }
        catch (Exception ex) when (ex is SocketException or ObjectDisposedException or InvalidOperationException)
        {
            return false;
        }
    }

    private static bool IsEndpointReachable(Uri uri, TimeSpan timeout) => IsDriverReachable(uri, timeout);
}
