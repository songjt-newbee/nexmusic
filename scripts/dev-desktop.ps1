# NexMusic 桌面开发启动（Windows）
# 推荐双击 scripts\dev-desktop.cmd，会打开专用控制台窗口
# 文件请保存为 UTF-8（带 BOM 更兼容旧版 PowerShell）
$ErrorActionPreference = "Stop"

# 从资源管理器 / 其它入口启动时，新开一个专用 PowerShell 窗口（避免占 Cursor 终端）
if (-not $env:NEXMUSIC_DEV_IN_WINDOW) {
    $env:NEXMUSIC_DEV_IN_WINDOW = "1"
    Start-Process powershell.exe -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy", "Bypass",
        "-Command", "`$env:NEXMUSIC_DEV_IN_WINDOW='1'; & '$PSCommandPath'"
    )
    exit 0
}

# 控制台切 UTF-8，避免 Write-Host 中文乱码
try {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
    if ($Host.Name -eq "ConsoleHost") { chcp 65001 | Out-Null }
} catch { }

$Host.UI.RawUI.WindowTitle = "NexMusic Dev"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$NodeDir = "D:\ToolSpace\nvm\v20.11.0"
$CargoDir = Join-Path $env:USERPROFILE ".cargo\bin"

if ($NodeDir -and (Test-Path (Join-Path $NodeDir "node.exe"))) {
    $env:Path = "$NodeDir;$CargoDir;" + $env:Path
} elseif (Test-Path (Join-Path $CargoDir "cargo.exe")) {
    $env:Path = "$CargoDir;" + $env:Path
}

$nodeVer = (node -v 2>$null)
if (-not $nodeVer -or ($nodeVer -replace "v", "" -split "\." | Select-Object -First 1) -lt 20) {
    Write-Host "需要 Node.js 20+，当前: $nodeVer" -ForegroundColor Red
    Write-Host "请安装 Node 20 或修改脚本中的 `$NodeDir"
    exit 1
}

Write-Host "Node: $nodeVer"
Write-Host "Rust: $(rustc -V 2>$null)"
Write-Host "目录: $Root"
Write-Host ""
Write-Host "本窗口用于查看编译日志；NexMusic 应用窗口会在 Rust 编完后自动弹出。" -ForegroundColor Cyan
Write-Host "首次编译可能要几分钟，请稍等。" -ForegroundColor Yellow
Write-Host "登录/播放请在 NexMusic 窗口内测试，勿用浏览器打开 localhost:4173" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path "node_modules")) {
    Write-Host "首次运行，执行 npm install ..."
    npm install
}

npm run tauri dev
