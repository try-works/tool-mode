$ErrorActionPreference = 'Continue'
$root = 'E:\tmp\adoption-run'
$tmp = 'E:\tmp\dsh-exp-f838ffd2a4d64f09b3c0da1d97fad8a1'
$line = Select-String -Path 'C:\Users\erikb\.dsh\.credentials.yaml' -Pattern '^\s*DEEPSEEK_API_KEY:\s*(\S+)' | Select-Object -First 1
$env:DEEPSEEK_API_KEY = $line.Matches[0].Groups[1].Value
$env:DSH_HOME = $tmp
$env:DSH_PERMISSION_MODE = 'danger-full-access'
$tasks = @(
  'Use the available tools to compute an invoice total. Subtotal: 100. Tax rate: 0.10. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 250. Tax rate: 0.20. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 99.95. Tax rate: 0.05. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 1200. Tax rate: 0.0825. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 45.50. Tax rate: 0.15. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 700. Tax rate: 0.10. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 310.25. Tax rate: 0.20. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 88.80. Tax rate: 0.05. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 5000. Tax rate: 0.0825. Reply with only the numeric total.',
  'Use the available tools to compute an invoice total. Subtotal: 64.99. Tax rate: 0.15. Reply with only the numeric total.'
)
foreach ($arm in @('D','G','O')) {
  $dir = Join-Path $root ("arm-$arm")
  Get-ChildItem $dir -File | Where-Object { $_.Name -ne 'agent-authoring.json' } | Remove-Item -Force
  $i = 0
  foreach ($task in $tasks) {
    $i += 1
    $log = Join-Path $root ("arm-$arm\task-$i.log")
    $out = & node D:\deepseek-harness\apps\cli\lib\bin.js --profile headless --patch (Join-Path $root "arm-$arm.yml") $task 2>&1
    $code = $LASTEXITCODE
    $out | Set-Content -Path $log -Encoding utf8
    Add-Content -Path $log -Value ("EXIT=" + $code) -Encoding utf8
    Write-Output ("$arm $i exit=$code")
  }
}
