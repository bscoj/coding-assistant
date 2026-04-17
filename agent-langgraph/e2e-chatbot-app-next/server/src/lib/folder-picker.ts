import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function trimOutput(value: string | undefined) {
  return value?.trim() || '';
}

async function pickWindowsFolder() {
  const explorerStyleScript = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    '$dialog.Title = "Select repository"',
    '$dialog.Filter = "Folders|*.folder"',
    '$dialog.CheckFileExists = $false',
    '$dialog.CheckPathExists = $true',
    '$dialog.ValidateNames = $false',
    '$dialog.DereferenceLinks = $true',
    '$dialog.Multiselect = $false',
    '$dialog.FileName = "Select this folder"',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  if (Test-Path $dialog.FileName -PathType Container) {',
    '    Write-Output $dialog.FileName',
    '  } else {',
    '    Split-Path -Path $dialog.FileName -Parent | Write-Output',
    '  }',
    '}',
  ].join('; ');

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-Command',
      explorerStyleScript,
    ]);
    return trimOutput(stdout);
  } catch {
    const fallbackScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "Select repository"',
      '$dialog.ShowNewFolderButton = $false',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  Write-Output $dialog.SelectedPath',
      '}',
    ].join('; ');

    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-Command',
      fallbackScript,
    ]);
    return trimOutput(stdout);
  }
}

async function pickMacFolder() {
  const { stdout } = await execFileAsync('osascript', [
    '-e',
    'set chosenFolder to choose folder with prompt "Select repository"',
    '-e',
    'POSIX path of chosenFolder',
  ]);
  return trimOutput(stdout);
}

async function pickLinuxFolder() {
  const attempts: Array<[string, string[]]> = [
    ['zenity', ['--file-selection', '--directory', '--title=Select repository']],
    ['kdialog', ['--getexistingdirectory', process.cwd(), '--title', 'Select repository']],
  ];

  for (const [command, args] of attempts) {
    try {
      const { stdout } = await execFileAsync(command, args);
      const value = trimOutput(stdout);
      if (value) {
        return value;
      }
    } catch {
      // Try the next picker.
    }
  }

  throw new Error('No supported native folder picker is available on this machine');
}

export async function pickFolder() {
  switch (os.platform()) {
    case 'win32':
      return pickWindowsFolder();
    case 'darwin':
      return pickMacFolder();
    default:
      return pickLinuxFolder();
  }
}
