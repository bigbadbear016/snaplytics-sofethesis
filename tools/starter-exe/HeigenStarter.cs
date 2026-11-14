// HeigenStarter.exe - backup launcher for starter.ps1 (same as starter.bat).
// Build: tools\starter-exe\build.bat  (uses the C# compiler built into Windows).
//
//   HeigenStarter.exe            -> opens the Starter window (no console flash)
//   HeigenStarter.exe -Status    -> any arguments run in a visible PowerShell window
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

internal static class HeigenStarter
{
    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(root, "starter.ps1");
        if (!File.Exists(script))
        {
            MessageBox.Show(
                "starter.ps1 was not found next to HeigenStarter.exe:\n" + root +
                "\n\nKeep HeigenStarter.exe in the project root folder.",
                "Heigen Studio Starter", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        string psArgs = "-NoProfile -ExecutionPolicy Bypass -File " + Quote(script);
        if (args.Length > 0)
        {
            psArgs += " " + string.Join(" ", args.Select(Quote));
            // Command-line mode: show output and keep the window open to read it.
            var visible = new ProcessStartInfo("powershell.exe", "-NoExit " + psArgs)
            {
                WorkingDirectory = root,
                UseShellExecute = true,
            };
            Process.Start(visible);
            return 0;
        }

        // GUI mode: hide the PowerShell console, but surface any startup error.
        var info = new ProcessStartInfo("powershell.exe", psArgs)
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
        };
        try
        {
            using (Process ps = Process.Start(info))
            {
                string errors = ps.StandardError.ReadToEnd();
                ps.WaitForExit();
                if (ps.ExitCode != 0 || errors.Trim().Length > 0)
                {
                    MessageBox.Show(
                        "The starter stopped with an error (exit code " + ps.ExitCode + "):\n\n" +
                        (errors.Length > 1500 ? errors.Substring(0, 1500) + "..." : errors),
                        "Heigen Studio Starter", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return ps.ExitCode == 0 ? 1 : ps.ExitCode;
                }
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not start PowerShell:\n" + ex.Message,
                "Heigen Studio Starter", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return 0;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
