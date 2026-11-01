[CmdletBinding()]
param(
    [string]$EnvFile = ".env",

    [string]$RoutingUrl = "",

    [switch]$SkipLive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PreviousLocation = Get-Location
$PreviousTestUrl = [Environment]::GetEnvironmentVariable(
    "ROUTING_TEST_URL",
    "Process"
)

try {
    Set-Location -LiteralPath $ProjectRoot

    if (!(Get-Command go -ErrorAction SilentlyContinue)) {
        throw "Go is missing from PATH."
    }

    if (!(Test-Path -LiteralPath "pkg/handlers/routes_test.go")) {
        throw "Missing pkg/handlers/routes_test.go."
    }

    if ($SkipLive) {
        $env:ROUTING_TEST_URL = ""
    }
    else {
        if ([string]::IsNullOrWhiteSpace($RoutingUrl)) {
            if (![System.IO.Path]::IsPathRooted($EnvFile)) {
                $EnvFile = Join-Path $ProjectRoot $EnvFile
            }

            if (!(Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
                throw "Environment file not found: $EnvFile"
            }

            Get-Content -LiteralPath $EnvFile | ForEach-Object {
                if (
                    $_ -match
                    '^\s*(?:export\s+)?ROUTING_SERVICE_URL\s*=(.*)$'
                ) {
                    $Value = $Matches[1].Trim()

                    if ($Value.Length -ge 2) {
                        $First = $Value.Substring(0, 1)
                        $Last = $Value.Substring($Value.Length - 1, 1)

                        if (
                            ($First -eq '"' -and $Last -eq '"') -or
                            ($First -eq "'" -and $Last -eq "'")
                        ) {
                            $Value = $Value.Substring(
                                1,
                                $Value.Length - 2
                            )
                        }
                    }

                    $RoutingUrl = $Value.Trim()
                }
            }
        }

        if ([string]::IsNullOrWhiteSpace($RoutingUrl)) {
            throw (
                "ROUTING_SERVICE_URL is missing. " +
                "Set it in .env or pass -RoutingUrl."
            )
        }

        $ParsedUri = $null

        if (
            ![Uri]::TryCreate(
                $RoutingUrl,
                [UriKind]::Absolute,
                [ref]$ParsedUri
            )
        ) {
            throw "Routing URL must be absolute."
        }

        if (
            $ParsedUri.Scheme -notin @("http", "https") -or
            ![string]::IsNullOrEmpty($ParsedUri.UserInfo) -or
            ![string]::IsNullOrEmpty($ParsedUri.Query) -or
            ![string]::IsNullOrEmpty($ParsedUri.Fragment)
        ) {
            throw "Routing URL must be an HTTP/HTTPS base URL."
        }

        $env:ROUTING_TEST_URL = $RoutingUrl.TrimEnd("/")
    }

    Write-Host "Running Go routing tests..." -ForegroundColor Cyan

    if (!$SkipLive) {
        Write-Host (
            "Live tests will execute real VROOM/OSRM optimization."
        ) -ForegroundColor Cyan
    }

    & go test `
        -tags cloud `
        ./pkg/handlers `
        -run "^(TestRequestOptimization|TestRoutingLive)" `
        -count=1 `
        -timeout 8m `
        -v

    if ($LASTEXITCODE -ne 0) {
        throw "Routing checks failed. Do not deploy the backend yet."
    }

    Write-Host ""

    if ($SkipLive) {
        Write-Host (
            "Local client tests passed. Live routing was not tested."
        ) -ForegroundColor Yellow
    }
    else {
        Write-Host (
            "Client tests and live FastAPI/VROOM/OSRM checks passed."
        ) -ForegroundColor Green
    }
}
finally {
    [Environment]::SetEnvironmentVariable(
        "ROUTING_TEST_URL",
        $PreviousTestUrl,
        "Process"
    )

    Set-Location -LiteralPath $PreviousLocation.Path
}