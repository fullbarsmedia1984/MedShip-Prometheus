$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$configPath = Join-Path $repoRoot ".codex\config.toml"
$failed = $false

function Pass($message) {
    Write-Host "[PASS] $message" -ForegroundColor Green
}

function Fail($message) {
    Write-Host "[FAIL] $message" -ForegroundColor Red
    $script:failed = $true
}

function Info($message) {
    Write-Host "[INFO] $message" -ForegroundColor Cyan
}

if (Test-Path -LiteralPath $configPath) {
    Pass ".codex/config.toml exists"
} else {
    Fail ".codex/config.toml is missing"
    exit 1
}

$config = Get-Content -Raw -LiteralPath $configPath

if ($config -match "salesforce_sandbox_reads") {
    Pass "salesforce_sandbox_reads is configured"
} else {
    Fail "salesforce_sandbox_reads is missing"
}

if ($config -match "salesforce_sandbox_mutations") {
    Pass "salesforce_sandbox_mutations is configured"
} else {
    Fail "salesforce_sandbox_mutations is missing"
}

if ($config -notmatch "sobject-all") {
    Pass "sobject-all is not configured"
} else {
    Fail "sobject-all must not be configured"
}

if ($config -notmatch "sobject-deletes") {
    Pass "sobject-deletes is not configured"
} else {
    Fail "sobject-deletes must not be configured"
}

$productionBlockPattern = '(?ms)^\[mcp_servers\.salesforce_production_zeus_prometheus_ops\]\s*(?:(?!^\[).)*?^enabled\s*=\s*false\s*$'
if ($config -match $productionBlockPattern) {
    Pass "salesforce_production_zeus_prometheus_ops is disabled"
} else {
    Fail "salesforce_production_zeus_prometheus_ops must have enabled = false"
}

if ($config -match [regex]::Escape('http://localhost:5555/callback')) {
    Pass "OAuth callback URL is http://localhost:5555/callback"
} else {
    Fail "OAuth callback URL must be http://localhost:5555/callback"
}

Write-Host ""
Info "Next manual steps:"
Write-Host "1. Create Salesforce External Client Apps for sandbox and later production."
Write-Host "2. Configure callback URL: http://localhost:5555/callback."
Write-Host "3. Configure OAuth scopes: mcp_api and refresh_token."
Write-Host "4. Require PKCE and restrict access with a dedicated permission set."
Write-Host "5. Replace Consumer Key placeholders in .codex/config.toml."
Write-Host "6. Run sandbox OAuth login only after the External Client App is active:"
Write-Host "   codex mcp login salesforce_sandbox_reads"
Write-Host "   codex mcp login salesforce_sandbox_mutations"
Write-Host "7. Start a new Codex session and run /mcp to verify available servers."
Write-Host "8. Do not attempt live Salesforce mutations during configuration verification."

if ($failed) {
    exit 1
}

exit 0
