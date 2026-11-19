$ErrorActionPreference = 'Continue'
$root = 'E:\tmp\adoption-run-v4'
$tmp = 'E:\tmp\dsh-exp-f838ffd2a4d64f09b3c0da1d97fad8a1'
$line = Select-String -Path 'C:\Users\erikb\.dsh\.credentials.yaml' -Pattern '^\s*DEEPSEEK_API_KEY:\s*(\S+)' | Select-Object -First 1
$env:DEEPSEEK_API_KEY = $line.Matches[0].Groups[1].Value
$env:DSH_HOME = $tmp
$env:DSH_PERMISSION_MODE = 'danger-full-access'
$tasks = @(
  'A customer invoice has a subtotal of 100 and a tax rate of 0.10. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 250 and a tax rate of 0.20. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 99.95 and a tax rate of 0.05. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 1200 and a tax rate of 0.0825. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 45.50 and a tax rate of 0.15. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 700 and a tax rate of 0.10. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 310.25 and a tax rate of 0.20. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 88.80 and a tax rate of 0.05. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 5000 and a tax rate of 0.0825. What is the total? Use the available tools if useful. Reply with only the numeric total.',
  'A customer invoice has a subtotal of 64.99 and a tax rate of 0.15. What is the total? Use the available tools if useful. Reply with only the numeric total.'
)
foreach ($arm in @('D','G','O')) {
  $dir = Join-Path $root ("arm-$arm")
  Get-ChildItem $dir -File | Where-Object { $_.Name -ne 'agent-authoring.json' } | Remove-Item -Force
  Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
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
