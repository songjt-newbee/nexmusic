# NexMusic 开发机清理：删除可再生的编译/构建产物
# 用法: powershell -File scripts/clean-dev.ps1
# 可选: -IncludeNodeModules  同时删除 node_modules（需重新 npm install）

param(
    [switch]$IncludeNodeModules
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Remove-DirIfExists([string]$path, [string]$label) {
    if (-not (Test-Path $path)) {
        Write-Host "跳过（不存在）: $label"
        return
    }
    $size = (Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum
    $sizeGb = [math]::Round($size / 1GB, 2)
    Write-Host "删除 $label ($sizeGb GB): $path"
    Remove-Item -Recurse -Force $path
}

Remove-DirIfExists (Join-Path $root "src-tauri\target") "Rust 编译缓存"
Remove-DirIfExists (Join-Path $root "dist") "前端构建产物"

if ($IncludeNodeModules) {
    Remove-DirIfExists (Join-Path $root "node_modules") "npm 依赖"
    Write-Host "请运行: npm install"
}

Write-Host "完成。下次 tauri dev / build 会重新编译 Rust。"
