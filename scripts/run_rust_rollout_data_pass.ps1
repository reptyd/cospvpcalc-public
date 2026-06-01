param(
  [int]$DurationMinutes = 120,
  [int]$BatchSize = 4,
  [int]$Concurrency = 2,
  [string]$PoolMode = "meta80",
  [string]$PoolScope = "withinOneTier",
  [string]$NamesFile = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $repoRoot "logs\rust-rollout-data-pass"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $logRoot $runStamp
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$summaryPath = Join-Path $runDir "summary.json"
$progressPath = Join-Path $runDir "progress.log"
$donePath = Join-Path $runDir "DONE.txt"

$baselineConfirmed = @(
  "Kendyll","Korathos","Shararook","Militrua","Boskurro","Sigmatox","Geoptxina","Iztajuatl","Caldonterrus","Yohsog",
  "Corvurax","Hellion Warden","Aidoneiscus","Umbraxi","Salrahn","Magnarothus","Phantejer","Woodralone","Veludorah","Eigion Warden",
  "Gramoss","Lotremum","Firakai","Vorpalus","Prialoura","Volnoirve","Irizah","Pacedegon","Chamei","Gimon-Ogu",
  "Lactarim","Empiterium","Danténos","Allifu","Aesthyrion","Altulis","Aleicuda","Aesmir","Aereis","Aesho",
  "Adharcaiin","Aholai","Akorbik","Amolis","Angelic Warden","Ani","Anutill","Aolenus"
)

$runtimePath = Join-Path $repoRoot "src\optimizer\rustBestBuildsRuntime.ts"
$runtimeSource = Get-Content $runtimePath -Raw -Encoding UTF8
$confirmedMatches = [regex]::Matches(
  $runtimeSource,
  '(?:PASSIVE_CONTOUR_SOURCE_TS_NO_OP_ACTIVATED_BY_CREATURE|BREATH_DEFENDER_TS_NO_OP_ACTIVATED_BY_SOURCE_CREATURE)\.set\(\s*"([^"]+)"'
)
$confirmedSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($name in $baselineConfirmed) {
  [void]$confirmedSet.Add($name)
}
foreach ($match in $confirmedMatches) {
  [void]$confirmedSet.Add($match.Groups[1].Value)
}

$creaturesJson = Get-Content (Join-Path $repoRoot "data\creatures.runtime.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$allNames = @($creaturesJson.creatures | ForEach-Object { $_.name })
if ($NamesFile -and (Test-Path $NamesFile)) {
  $pendingNames = @(Get-Content $NamesFile -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ })
} else {
  $pendingNames = $allNames | Where-Object { -not $confirmedSet.Contains($_) } | Sort-Object
}

$startedAt = Get-Date
$deadline = $startedAt.AddMinutes($DurationMinutes)
$processed = 0
$batchIndex = 0
$results = @()
$failures = @()

function Write-ProgressLine([string]$Line) {
  $timestamped = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Line
  Write-Host $timestamped
  Add-Content -Path $progressPath -Value $timestamped
}

function Write-Summary([bool]$Finished) {
  $summary = [pscustomobject]@{
    startedAt = $startedAt.ToString("o")
    now = (Get-Date).ToString("o")
    finished = $Finished
    durationMinutes = $DurationMinutes
    batchSize = $BatchSize
    concurrency = $Concurrency
    poolMode = $PoolMode
    poolScope = $PoolScope
    namesFile = $NamesFile
    runDir = $runDir
    confirmedCount = $confirmedSet.Count
    pendingTotal = $pendingNames.Count
    processed = $processed
    remaining = [Math]::Max(0, $pendingNames.Count - $processed)
    completedBatches = $batchIndex
    successes = $results.Count
    failures = $failures
  }
  $summary | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryPath
}

Write-ProgressLine "runDir=$runDir"
Write-ProgressLine "confirmed=$($confirmedSet.Count) pending=$($pendingNames.Count) durationMin=$DurationMinutes batchSize=$BatchSize concurrency=$Concurrency namesFile=$NamesFile"

while ($processed -lt $pendingNames.Count -and (Get-Date) -lt $deadline) {
  $remainingMinutes = ($deadline - (Get-Date)).TotalMinutes
  if ($remainingMinutes -lt 3) {
    Write-ProgressLine "Stopping because remaining budget is under 3 minutes."
    break
  }

  $batch = @($pendingNames | Select-Object -Skip $processed -First $BatchSize)
  if ($batch.Count -eq 0) {
    break
  }

  $batchIndex += 1
  $batchName = "{0:D3}" -f $batchIndex
  $batchLogPath = Join-Path $runDir ("batch-{0}.json" -f $batchName)
  Write-ProgressLine "Batch $batchName start: $($batch -join ', ')"

  try {
    $stdout = & npx.cmd tsx scripts/suggest_rust_rollout_widenings.ts --pool-mode $PoolMode --pool-scope $PoolScope --concurrency $Concurrency @batch 2>&1
    $jsonText = ($stdout -join [Environment]::NewLine)
    Set-Content -Path $batchLogPath -Value $jsonText
    $parsed = $jsonText | ConvertFrom-Json
    foreach ($entry in $parsed.results) {
      $results += $entry
    }
    Write-ProgressLine "Batch $batchName done."
  } catch {
    $message = $_.Exception.Message
    Set-Content -Path $batchLogPath -Value $message
    $failures += [pscustomobject]@{
      batch = $batchName
      creatures = $batch
      error = $message
    }
    Write-ProgressLine "Batch $batchName failed: $message"
  }

  $processed += $batch.Count
  Write-Summary $false
}

Write-ProgressLine "Finished. processed=$processed successes=$($results.Count) failures=$($failures.Count)"
Write-Summary $true
Set-Content -Path $donePath -Value ("completedAt={0}`nprocessed={1}`nsuccesses={2}`nfailures={3}" -f (Get-Date).ToString("o"), $processed, $results.Count, $failures.Count)
