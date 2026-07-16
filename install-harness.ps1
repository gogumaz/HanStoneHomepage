[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$TargetPath, [switch]$Force)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSCommandPath
$target = [IO.Path]::GetFullPath($TargetPath)
New-Item -ItemType Directory -Force -Path $target | Out-Null
$items = @('.claude', 'CLAUDE.md', 'distribution')
$existing = @($items | Where-Object { Test-Path -LiteralPath (Join-Path $target $_) })
if ($existing.Count -gt 0 -and -not $Force) { throw "Existing harness files: $($existing -join ', '). Use -Force to back up and replace them." }
if ($existing.Count -gt 0) {
  $backup = Join-Path $target ('.harness-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  foreach ($item in $existing) { Copy-Item (Join-Path $target $item) (Join-Path $backup $item) -Recurse -Force; Remove-Item (Join-Path $target $item) -Recurse -Force }
  Write-Host "Backed up existing harness: $backup"
}
foreach ($item in $items) { Copy-Item (Join-Path $source $item) (Join-Path $target $item) -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $target '_workspace') | Out-Null
Write-Host "Standard Q&A harness installed: $target"
