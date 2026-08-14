<#
.synopsis
shoes-admin 一键交叉编译打包脚本：构建前端 -> 内嵌到 Rust -> 输出 Windows + Linux 单文件可执行程序
.parameter WindowsOnly  仅构建 Windows 版本
.parameter LinuxOnly    仅构建 Linux 版本（Windows 宿主需 zig + cargo-zigbuild）
.parameter SkipFrontend 跳过前端构建（复用已有 dist/）
.example
./build.ps1                     # 构建 Windows + Linux 两个版本
./build.ps1 -WindowsOnly        # 仅 Windows
./build.ps1 -LinuxOnly          # 仅 Linux
#>
param(
    [switch]$WindowsOnly,
    [switch]$LinuxOnly,
    [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$OutDir = Join-Path $Root "dist"

$BuildWin = -not $LinuxOnly
$BuildLinux = -not $WindowsOnly

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  shoes-admin 打包脚本" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

function Step($msg) {
    Write-Host ""
    Write-Host ">> $msg" -ForegroundColor Yellow
}

function Ensure-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "[错误] 未找到 $name，$hint" -ForegroundColor Red
        exit 1
    }
}

# ---------- 1. 前端构建 ----------
if (-not $SkipFrontend) {
    Ensure-Command "npm" "请先安装 Node.js (https://nodejs.org)"
    Step "1/4 构建前端 (npm install + vite build)"
    Push-Location $Frontend
    if (-not (Test-Path "node_modules")) {
        npm install --no-audit --no-fund
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
    Pop-Location
} else {
    Write-Host ">> 跳过前端构建（-SkipFrontend）" -ForegroundColor DarkGray
}

# ---------- 2. 工具链检查 ----------
Ensure-Command "cargo" "请先安装 Rust (https://rustup.rs)"
Step "2/4 检查交叉编译工具链"

$needZig = $BuildLinux
$zigbuildInstalled = $false
if ($needZig) {
    if (Get-Command "cargo-zigbuild" -ErrorAction SilentlyContinue) {
        $zigbuildInstalled = $true
    }
    if (-not $zigbuildInstalled) {
        Write-Host ">> 安装 cargo-zigbuild ..." -ForegroundColor DarkYellow
        cargo install cargo-zigbuild --locked
    }
    if (-not (Get-Command "zig" -ErrorAction SilentlyContinue)) {
        # 自动下载 zig（ziglang.org 可能较慢，带断点续传与重试）
        $zigVer = "0.13.0"
        $toolsDir = Join-Path $env:USERPROFILE ".workbuddy\tools"
        New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
        $zigZip = Join-Path $toolsDir "zig-$zigVer.zip"
        $zigDir = Join-Path $toolsDir "zig-windows-x86_64-$zigVer"
        $zigBin = Join-Path $zigDir "zig.exe"
        if (-not (Test-Path $zigBin)) {
            $url = "https://ziglang.org/download/$zigVer/zig-windows-x86_64-$zigVer.zip"
            $ok = $false
            for ($i = 1; $i -le 12; $i++) {
                Write-Host ">> 下载 zig $zigVer (第 $i 次尝试): $url"
                if (Test-Path $zigZip) {
                    # 断点续传
                    & curl.exe -sL -C - --connect-timeout 30 --max-time 240 -o $zigZip $url
                } else {
                    & curl.exe -sL --connect-timeout 30 --max-time 240 -o $zigZip $url
                }
                $len = if (Test-Path $zigZip) { (Get-Item $zigZip).Length } else { 0 }
                if ($len -gt 50000000) {
                    try {
                        Add-Type -AssemblyName System.IO.Compression.FileSystem
                        $zip = [System.IO.Compression.ZipFile]::OpenRead($zigZip)
                        $valid = ($zip.Entries.Count -gt 0)
                        $zip.Dispose()
                        if ($valid) { $ok = $true; break }
                    } catch { }
                }
                Start-Sleep -Seconds 5
            }
            if (-not $ok) { throw "zig 下载失败。请手动从 https://ziglang.org/download 下载 zig-$zigVer 并解压到 $toolsDir 后重试" }
            Expand-Archive -Path $zigZip -DestinationPath $toolsDir -Force
        }
        $env:PATH = "$zigDir;" + $env:PATH
        Write-Host ">> zig 就绪: $zigBin"
    }
    if (-not (Get-Command "zig" -ErrorAction SilentlyContinue)) {
        throw "zig 仍未就绪，请手动添加 zig 到 PATH"
    }
    rustup target add x86_64-unknown-linux-musl
}

# ---------- 3. 编译 ----------
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Push-Location $Backend

if ($BuildWin) {
    Step "3/4 编译 Windows x86_64"
    cargo build --release
    if ($LASTEXITCODE -ne 0) { throw "Windows 编译失败" }
    try {
        Copy-Item "target\release\shoes-admin.exe" (Join-Path $OutDir "shoes-admin-windows-x86_64.exe") -Force
    } catch {
        Write-Host "[警告] 无法覆盖 Windows 产物：dist 中的面板正在运行，请先关闭它（关闭黑窗口）后重新执行脚本" -ForegroundColor Yellow
    }
}

if ($BuildLinux) {
    Step "3/4 交叉编译 Linux x86_64 (musl)"
    cargo zigbuild --release --target x86_64-unknown-linux-musl
    if ($LASTEXITCODE -ne 0) { throw "Linux 交叉编译失败" }
    try {
        Copy-Item "target\x86_64-unknown-linux-musl\release\shoes-admin" (Join-Path $OutDir "shoes-admin-linux-x86_64") -Force
    } catch {
        Write-Host "[警告] 无法覆盖 Linux 产物：目标文件被占用" -ForegroundColor Yellow
    }
}

Pop-Location

# ---------- 4. 输出 ----------
Step "4/4 打包完成"
Get-ChildItem $OutDir | ForEach-Object {
    $mb = [math]::Round($_.Length / 1MB, 2)
    Write-Host ("  - {0}  ({1} MB)" -f $_.Name, $mb) -ForegroundColor Green
}
Write-Host ""
Write-Host "产物位于 dist/ 目录，单个文件即可直接运行：" -ForegroundColor Cyan
Write-Host "  Windows: dist\shoes-admin-windows-x86_64.exe  (双击运行：黑窗口显示日志并自动打开浏览器，关闭黑窗口即退出服务)" -ForegroundColor White
Write-Host "  Linux:   dist/shoes-admin-linux-x86_64        (chmod +x 后 ./shoes-admin-linux-x86_64，Ctrl+C 退出)" -ForegroundColor White
Write-Host "首次启动会在程序同级的 bin/ 目录自动下载 shoes 代理二进制（Linux 平台）。" -ForegroundColor DarkGray
