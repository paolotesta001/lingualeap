# =====================================================================
#  LinguaLeap — one-command publish to GitHub Pages
#  Run from the learning_language folder AFTER logging in once:
#     gh auth login
#     .\publish.ps1
#  Optional: .\publish.ps1 -Repo my-custom-name
# =====================================================================
param(
    [string]$Repo = "lingualeap"
)

$ErrorActionPreference = "Stop"
$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

Write-Host "==> Checking GitHub login..." -ForegroundColor Cyan
& $gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "You're not logged in yet. Run this once, then re-run me:" -ForegroundColor Yellow
    Write-Host "    gh auth login" -ForegroundColor Yellow
    exit 1
}

$user = (& $gh api user --jq ".login").Trim()
Write-Host "==> Logged in as: $user" -ForegroundColor Green

# Make sure we have a commit
git rev-parse HEAD *> $null
if ($LASTEXITCODE -ne 0) {
    git add -A
    git commit -m "LinguaLeap PWA" | Out-Null
}

# Create the repo (if it doesn't already exist) and wire up the remote
$exists = $false
& $gh repo view "$user/$Repo" *> $null
if ($LASTEXITCODE -eq 0) { $exists = $true }

if (-not $exists) {
    Write-Host "==> Creating public repo $user/$Repo ..." -ForegroundColor Cyan
    & $gh repo create $Repo --public --source=. --remote=origin
} else {
    Write-Host "==> Repo already exists, reusing it." -ForegroundColor Cyan
    git remote remove origin *> $null
    git remote add origin "https://github.com/$user/$Repo.git"
}

# Enable GitHub Pages (GitHub Actions build). Harmless if already enabled.
Write-Host "==> Enabling GitHub Pages..." -ForegroundColor Cyan
try {
    & $gh api -X POST "repos/$user/$Repo/pages" -f "build_type=workflow" *> $null
} catch {
    # 409 = already enabled; the workflow's configure-pages step also enables it.
}

Write-Host "==> Pushing code (this triggers the Pages build)..." -ForegroundColor Cyan
git branch -M main
git push -u origin main

$url = "https://$user.github.io/$Repo/"
Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host " Pushed! GitHub is now building your site." -ForegroundColor Green
Write-Host " It will be live in ~1-2 minutes at:" -ForegroundColor Green
Write-Host ""
Write-Host "   $url" -ForegroundColor White
Write-Host ""
Write-Host " Watch the build:  https://github.com/$user/$Repo/actions" -ForegroundColor DarkGray
Write-Host "=====================================================" -ForegroundColor Green

# Best-effort: wait for the first deployment to finish, then open it.
Write-Host "==> Waiting for the first deployment to go live..." -ForegroundColor Cyan
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 6
    try {
        $code = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop).StatusCode
        if ($code -eq 200) {
            Write-Host "==> Live! Opening $url" -ForegroundColor Green
            Start-Process $url
            break
        }
    } catch { Write-Host "    still building... ($($i+1))" -ForegroundColor DarkGray }
}
