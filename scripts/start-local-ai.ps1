param(
  [string]$RuntimeDirectory = 'D:\GPT 2\diskoko-ai',
  [string]$SiteUrl = 'https://diskoko.com'
)

$ErrorActionPreference = 'Stop'
$model = Join-Path $RuntimeDirectory 'Qwen3-4B-Q4_K_M.gguf'
$server = Join-Path $RuntimeDirectory 'ollama\lib\ollama\llama-server.exe'
$node = Join-Path $RuntimeDirectory 'node.exe'
$tokenFile = Join-Path $RuntimeDirectory 'worker-token.txt'
$worker = Join-Path $PSScriptRoot 'local-ai-worker.mjs'
foreach ($file in @($model, $server, $node, $tokenFile, $worker)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Missing local AI file: $file" }
}

$env:AI_WORKER_TOKEN = (Get-Content -LiteralPath $tokenFile -Raw -Encoding ascii).Trim()
$env:AI_MODEL = 'Qwen3-4B-Q4_K_M.gguf'
$env:LOCAL_AI_PROVIDER = 'llama'
$env:LOCAL_AI_URL = 'http://127.0.0.1:11434'
$env:DISKOKO_URL = $SiteUrl

if (-not (Test-NetConnection 127.0.0.1 -Port 11434 -InformationLevel Quiet)) {
  Start-Process -FilePath $server -WorkingDirectory (Split-Path $server) -ArgumentList @('-m', "`"$model`"", '-ngl', '99', '--host', '127.0.0.1', '--port', '11434', '-c', '8192', '-np', '1', '--jinja') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeDirectory 'model.out.log') -RedirectStandardError (Join-Path $RuntimeDirectory 'model.err.log')
}

for ($attempt = 0; $attempt -lt 90; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/health' -TimeoutSec 2
    if ($health.status -eq 'ok') { break }
  } catch { }
  Start-Sleep -Seconds 2
}
if ($attempt -ge 90) { throw 'Local model did not become healthy within 3 minutes.' }

$pidFile = Join-Path $RuntimeDirectory 'worker.pid'
$workerPid = if (Test-Path -LiteralPath $pidFile) { (Get-Content -LiteralPath $pidFile -Raw).Trim() } else { '' }
if (-not $workerPid -or -not (Get-Process -Id ([int]$workerPid) -ErrorAction SilentlyContinue)) {
  $process = Start-Process -FilePath $node -ArgumentList @("`"$worker`"") -WorkingDirectory $RuntimeDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RuntimeDirectory 'worker.out.log') -RedirectStandardError (Join-Path $RuntimeDirectory 'worker.err.log')
  Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
}
Write-Output 'AI Diskoko local model and worker started.'


