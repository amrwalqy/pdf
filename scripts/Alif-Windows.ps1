<#
.SYNOPSIS
  Alif PDF Reader launcher for Windows 10 and 11.
.DESCRIPTION
  -Mode Run    Installs what is missing, rebuilds the interface only when its sources changed, and opens Alif.
  -Mode Build  Installs what is missing, runs the type-check and the unit tests, then builds the installer
               and the portable EXE into the release folder.
  Every run appends its output to alif-build.log in the project folder.
  Environment: set ELECTRON_MIRROR to a mirror URL only if the official Electron download is blocked.
#>
param(
  [ValidateSet('Run', 'Build')]
  [string]$Mode = 'Run'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$logPath = Join-Path $projectRoot 'alif-build.log'
$minNodeVersion = [version]'22.12.0'

function Get-ProjectPath([string[]]$segments) {
  $path = $projectRoot
  foreach ($segment in $segments) {
    $path = Join-Path $path $segment
  }
  return $path
}

function Write-Step([string]$message) {
  Write-Host ''
  Write-Host ('[ALIF] ' + $message) -ForegroundColor Cyan
}

function Invoke-Tool([string]$tool, [string[]]$arguments) {
  Write-Host ('> ' + $tool + ' ' + ($arguments -join ' ')) -ForegroundColor DarkGray
  & $tool @arguments
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed with exit code $LASTEXITCODE : $tool " + ($arguments -join ' '))
  }
}

function Test-Prerequisites {
  Write-Step 'Checking Node.js and project files'
  if (-not (Test-Path -LiteralPath (Get-ProjectPath @('package.json')))) {
    throw 'package.json was not found. Extract the whole ZIP first, then start the launcher from the extracted folder.'
  }
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not installed. Install the LTS version from https://nodejs.org, restart Windows, then run again.'
  }
  $nodeVersion = [version]((& node.exe -v).TrimStart('v'))
  if ($nodeVersion -lt $minNodeVersion) {
    throw "Node.js $nodeVersion is too old. Install Node.js 22 LTS or newer from https://nodejs.org."
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm is missing. Reinstall Node.js LTS from https://nodejs.org, then run again.'
  }
  Write-Host ('Node.js ' + $nodeVersion + ' and npm were found.')
}

function Assert-AlifNotRunning {
  $running = Get-Process -Name 'Alif', 'Alif PDF', 'electron' -ErrorAction SilentlyContinue
  if ($running) {
    throw 'Alif is still running. Close the Alif window, then run the launcher again.'
  }
}

function Install-Dependencies {
  Write-Step 'Checking dependencies'
  $lockFile = Get-ProjectPath @('package-lock.json')
  $stampFile = Get-ProjectPath @('node_modules', '.alif-lock.sha256')
  $electronExe = Get-ProjectPath @('node_modules', 'electron', 'dist', 'electron.exe')
  $electronInstaller = Get-ProjectPath @('node_modules', 'electron', 'install.js')
  $lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash

  $upToDate = (Test-Path -LiteralPath $stampFile) -and ((Get-Content -LiteralPath $stampFile -Raw).Trim() -eq $lockHash)
  if ($upToDate) {
    Write-Host 'Dependencies already match package-lock.json. Skipping npm ci.'
  } else {
    Assert-AlifNotRunning
    Write-Host 'Installing dependencies from package-lock.json.'
    Write-Host 'The first run takes several minutes. Windows Defender scanning makes it slower.'
    Write-Host 'README.md explains how to exclude the project folder. Later runs skip this step.'
    # Install scripts are skipped so the Electron runtime download below can be retried on its own.
    Invoke-Tool 'npm.cmd' @('ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error')
    Set-Content -LiteralPath $stampFile -Value $lockHash -NoNewline
  }

  if (-not (Test-Path -LiteralPath $electronExe)) {
    Write-Host 'Downloading the Electron runtime...'
    Invoke-Tool 'node.exe' @($electronInstaller)
    if (-not (Test-Path -LiteralPath $electronExe)) {
      throw 'The Electron runtime could not be downloaded. Check the internet connection. If GitHub is blocked or very slow on this network, set ELECTRON_MIRROR to a mirror URL and run the launcher again.'
    }
  }
}

# True when the built interface is newer than every file it is built from.
function Test-UiBuildCurrent {
  $indexHtml = Get-ProjectPath @('dist', 'index.html')
  if (-not (Test-Path -LiteralPath $indexHtml)) { return $false }
  $builtAt = (Get-Item -LiteralPath $indexHtml).LastWriteTime

  $inputs = @()
  foreach ($folder in @('src', 'electron', 'public')) {
    $path = Get-ProjectPath @($folder)
    if (Test-Path -LiteralPath $path) {
      $inputs += Get-ChildItem -LiteralPath $path -Recurse -File
    }
  }
  foreach ($file in @('index.html', 'vite.config.ts', 'package.json')) {
    $inputs += Get-Item -LiteralPath (Get-ProjectPath @($file))
  }
  $newestInput = ($inputs | Measure-Object -Property LastWriteTime -Maximum).Maximum
  return ($newestInput -le $builtAt)
}

function Build-UserInterface {
  Write-Step 'Building the interface'
  Invoke-Tool 'npm.cmd' @('run', 'desktop:build')
}

function Test-Quality {
  Write-Step 'Type-checking and running the unit tests'
  Invoke-Tool 'npm.cmd' @('run', 'check')
}

function Start-Application {
  Write-Step 'Starting Alif'
  Write-Host 'Keep this window open while Alif is running. Closing Alif returns you here.'
  Invoke-Tool 'node.exe' @((Get-ProjectPath @('node_modules', 'electron', 'cli.js')), '.')
}

function Build-Installers {
  Write-Step 'Building the installer and the portable EXE. This takes a few minutes.'
  Invoke-Tool 'npm.cmd' @('run', 'dist:win')

  $version = (Get-Content -LiteralPath (Get-ProjectPath @('package.json')) -Raw | ConvertFrom-Json).version
  $releaseDir = Get-ProjectPath @('release')
  $setup = Join-Path $releaseDir ("Alif-Setup-$($version).exe")
  $portable = Join-Path $releaseDir ("Alif-Portable-$($version).exe")
  if (-not (Test-Path -LiteralPath $setup) -or -not (Test-Path -LiteralPath $portable)) {
    throw 'The build finished, but the installer or the portable EXE is missing from the release folder.'
  }

  Write-Host ''
  Write-Host '[SUCCESS] Both files are ready:' -ForegroundColor Green
  Write-Host ('  ' + $setup)
  Write-Host ('  ' + $portable)
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $releaseDir + '"')
}

# Explains the most common failures from the log, so the user knows what to change.
function Write-FailureHints {
  try {
    $text = Get-Content -LiteralPath $logPath -Raw
  } catch {
    return
  }
  if ($text -match 'symbolic link') {
    Write-Host 'Hint: this build needs Windows Developer Mode. Turn it on in Settings > System > For developers, then run the launcher again.' -ForegroundColor Yellow
  }
  if ($text -match 'ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN') {
    Write-Host 'Hint: a download failed because of the network. Check the connection, or set ELECTRON_MIRROR and run again.' -ForegroundColor Yellow
  }
  if ($text -match 'ENOSPC') {
    Write-Host 'Hint: the disk is full. Free some space and run again.' -ForegroundColor Yellow
  }
  if ($text -match 'EBUSY|EPERM') {
    Write-Host 'Hint: a file is locked, usually by antivirus or by a running copy of Alif. Close Alif and run again.' -ForegroundColor Yellow
  }
}

$exitCode = 0
$isLogging = $false
try {
  Push-Location -LiteralPath $projectRoot
  try {
    Start-Transcript -Path $logPath -Append | Out-Null
    $isLogging = $true
  } catch {
    Write-Host 'Logging to alif-build.log is unavailable. Continuing without it.' -ForegroundColor Yellow
  }

  Write-Host '==================================================='
  if ($Mode -eq 'Build') {
    Write-Host ' Alif PDF Reader - build installer and portable EXE'
  } else {
    Write-Host ' Alif PDF Reader - run the Windows app'
  }
  Write-Host '==================================================='

  Test-Prerequisites
  Install-Dependencies
  if ($Mode -eq 'Build') {
    Test-Quality
    Build-Installers
  } else {
    if (Test-UiBuildCurrent) {
      Write-Step 'The interface is up to date, so the build step is skipped.'
    } else {
      Build-UserInterface
    }
    Start-Application
  }
}
catch {
  $exitCode = 1
  Write-Host ''
  Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
  Write-FailureHints
  Write-Host ('Full output is saved in ' + $logPath + '. If you ask for help, send that file.') -ForegroundColor Yellow
}
finally {
  if ($isLogging) {
    try { Stop-Transcript | Out-Null } catch { }
  }
  Pop-Location
}

exit $exitCode
