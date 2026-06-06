using System.Diagnostics;

namespace TeslaSync.App.UITests.Drivers;

/// <summary>
/// Resolves the application identity WinAppDriver should launch for the suite. Resolution order:
/// <list type="number">
///   <item>the <c>TESLASYNC_UIA_APP</c> environment variable (an explicit packaged AUMID or an
///   absolute path to <c>TeslaSync.App.exe</c>), set by run-ui-automation.ps1 after it deploys the
///   MSIX;</item>
///   <item>a registered packaged AUMID derived from the manifest family name
///   <c>EvDevLabs.TeslaSync</c> via <c>Get-AppxPackage</c>;</item>
///   <item>a built, unpackaged <c>TeslaSync.App.exe</c> located under the app project's bin output —
///   WinAppDriver can launch an unpackaged binary by full path.</item>
/// </list>
/// When nothing resolves, <see cref="Resolve"/> returns null and the session fixture blocks with an
/// explicit reason instead of guessing.
/// </summary>
public static class AppHostLocator
{
    /// <summary>The MSIX package family name from <c>Package.appxmanifest</c> (Name + publisher hash).</summary>
    public const string PackageName = "EvDevLabs.TeslaSync";

    /// <summary>Resolve the app identity (AUMID or exe path), or null when it cannot be determined.</summary>
    public static string? Resolve()
    {
        var explicitId = Environment.GetEnvironmentVariable("TESLASYNC_UIA_APP");
        if (!string.IsNullOrWhiteSpace(explicitId))
        {
            return explicitId.Trim();
        }

        var aumid = TryResolvePackagedAumid();
        if (aumid is not null)
        {
            return aumid;
        }

        return TryLocateBuiltExecutable();
    }

    /// <summary>True when the app identity resolves to a packaged AUMID (vs. an unpackaged exe path).</summary>
    public static bool IsPackaged(string identity) =>
        !identity.Contains(Path.DirectorySeparatorChar) && identity.Contains('!');

    private static string? TryResolvePackagedAumid()
    {
        try
        {
            var psi = new ProcessStartInfo("powershell.exe")
            {
                Arguments =
                    "-NoProfile -NonInteractive -Command " +
                    $"\"$p = Get-AppxPackage -Name {PackageName} | Select-Object -First 1; " +
                    "if ($null -ne $p) { (Get-AppxPackageManifest $p).Package.Applications.Application.Id | " +
                    "ForEach-Object { $p.PackageFamilyName + '!' + $_ } | Select-Object -First 1 }\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            using var process = Process.Start(psi);
            if (process is null)
            {
                return null;
            }

            var output = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit(15000);
            return string.IsNullOrWhiteSpace(output) ? null : output.Split('\n')[0].Trim();
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return null;
        }
    }

    private static string? TryLocateBuiltExecutable()
    {
        var appProject = FindAppProjectDirectory();
        if (appProject is null)
        {
            return null;
        }

        var bin = Path.Combine(appProject, "bin");
        if (!Directory.Exists(bin))
        {
            return null;
        }

        return Directory
            .EnumerateFiles(bin, "TeslaSync.App.exe", SearchOption.AllDirectories)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }

    private static string? FindAppProjectDirectory()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "TeslaSync.App");
            if (File.Exists(Path.Combine(candidate, "TeslaSync.App.csproj")))
            {
                return candidate;
            }

            dir = dir.Parent;
        }

        return null;
    }
}
