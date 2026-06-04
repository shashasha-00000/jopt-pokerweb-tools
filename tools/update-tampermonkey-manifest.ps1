param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$Owner = 'shashasha-00000',
  [string]$Repo = 'jopt-pokerweb-tools',
  [string]$Branch = 'main'
)

$tampermonkeyDir = Join-Path $RepoRoot 'tampermonkey'
$manifestPath = Join-Path $tampermonkeyDir 'scripts.json'

if (!(Test-Path -LiteralPath $tampermonkeyDir)) {
  throw "tampermonkey directory not found: $tampermonkeyDir"
}

function Get-MetaValue {
  param(
    [string[]]$Lines,
    [string]$Key
  )

  $pattern = "^\s*//\s+@$([regex]::Escape($Key))\s+(.+?)\s*$"
  foreach ($line in $Lines) {
    if ($line -match $pattern) {
      return $Matches[1].Trim()
    }
  }
  return ''
}

$items = Get-ChildItem -LiteralPath $tampermonkeyDir -Filter '*.user.js' |
  Sort-Object Name |
  ForEach-Object {
    $lines = Get-Content -Encoding UTF8 -LiteralPath $_.FullName -TotalCount 80
    $fileName = $_.Name
    $rawUrl = "https://raw.githubusercontent.com/$Owner/$Repo/$Branch/tampermonkey/$fileName"

    [ordered]@{
      file = $fileName
      name = Get-MetaValue -Lines $lines -Key 'name'
      version = Get-MetaValue -Lines $lines -Key 'version'
      description = Get-MetaValue -Lines $lines -Key 'description'
      updateURL = Get-MetaValue -Lines $lines -Key 'updateURL'
      downloadURL = Get-MetaValue -Lines $lines -Key 'downloadURL'
      rawURL = $rawUrl
    }
  }

$json = $items | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, $utf8NoBom)

Write-Host "Updated $manifestPath"
Write-Host "Scripts: $($items.Count)"
