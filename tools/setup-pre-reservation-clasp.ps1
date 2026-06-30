$ErrorActionPreference = 'Stop'

$repoRoot = 'C:\Users\41512\Documents\GitHub\jopt-pokerweb-tools'
$targets = @(
  @{
    Name = 'SPADIE TOKYO 42nd - Open Face Chinese Poker'
    SpreadsheetId = '1xO0PZng81wHKpiFKw27dGfncS9v4WbpRMrOr6URjixM'
    RootDir = 'work\clasp\pre-reservation-ofc'
  },
  @{
    Name = 'SPADIE TOKYO 42nd - NLH Heads-up Championship'
    SpreadsheetId = '1Jin6t32tQJ8e-60cM5w9axiEAfk0erI8ggZy0clMFts'
    RootDir = 'work\clasp\pre-reservation-hu-championship'
  },
  @{
    Name = 'SPADIE TOKYO 42nd - NLH Team Battle 3on3'
    SpreadsheetId = '1QhDHIHoUePMp25Zxxg2d87nmgZZXdOoJcJkXn0Ysf0s'
    RootDir = 'work\clasp\pre-reservation-team-battle-3on3'
  },
  @{
    Name = 'SPADIE TOKYO 42nd - NLH Tag Battle 2on2'
    SpreadsheetId = '165HGd0JwFqn_KTSzI9pT0kivNkES9oaSDov5Fm9DsYA'
    RootDir = 'work\clasp\pre-reservation-tag-battle-2on2'
  },
  @{
    Name = 'SPADIE TOKYO 42nd - NLH Heads-up Knockout 3on3'
    SpreadsheetId = '1iSkl93u8_x3eAWAhjBFyyQ8zO1RanamBqMmgpJsd87g'
    RootDir = 'work\clasp\pre-reservation-hu-knockout-3on3'
  }
)

foreach ($target in $targets) {
  $fullRoot = Join-Path $repoRoot $target.RootDir
  if (-not (Test-Path $fullRoot)) {
    New-Item -ItemType Directory -Path $fullRoot -Force | Out-Null
  }

  Push-Location $fullRoot
  try {
    if (Test-Path '.clasp.json') {
      Write-Host "Skip existing clasp config: $($target.Name)"
      continue
    }

    Write-Host "Creating bound Apps Script project: $($target.Name)"
    clasp create --type sheets --title $target.Name --parentId $target.SpreadsheetId --rootDir .
  }
  finally {
    Pop-Location
  }
}

Write-Host 'Done.'
