# dsh-tavern 一键安装脚本
$ErrorActionPreference = 'Stop'

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  dsh-tavern 酒馆插件 安装程序" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 确定源目录（脚本所在目录）
$srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "源目录: $srcDir"

# 2. 确定 DSH profile 目录
$dshDir = Join-Path $env:USERPROFILE ".dsh"
$profileDir = Join-Path $dshDir "profiles\web"
$nodeModulesDir = Join-Path $profileDir "node_modules\@local\dsh-tavern"

if (-not (Test-Path $profileDir)) {
    Write-Host "错误: 未找到 DSH profile 目录: $profileDir" -ForegroundColor Red
    Write-Host "请先安装 DeepSeek Harness 并初始化 web profile。" -ForegroundColor Yellow
    Read-Host "按回车退出"
    exit 1
}

Write-Host "DSH 目录: $dshDir"
Write-Host "目标目录: $nodeModulesDir"
Write-Host ""

# 3. 复制插件文件
Write-Host "[1/3] 复制插件文件..." -ForegroundColor Yellow
if (Test-Path $nodeModulesDir) {
    Remove-Item -Recurse -Force $nodeModulesDir
}
New-Item -ItemType Directory -Path $nodeModulesDir -Force | Out-Null

# 复制需要的文件
$files = @("package.json", "cordis.patch.yml", "LICENSE", "README.md")
foreach ($f in $files) {
    $src = Join-Path $srcDir $f
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $nodeModulesDir $f) -Force
    }
}
# 复制 lib 目录
$libSrc = Join-Path $srcDir "lib"
if (Test-Path $libSrc) {
    Copy-Item $libSrc (Join-Path $nodeModulesDir "lib") -Recurse -Force
}
Write-Host "  完成" -ForegroundColor Green

# 4. 注册到 dsh.profile.bundles
Write-Host "[2/3] 注册到 DSH profile..." -ForegroundColor Yellow
$profilePkg = Join-Path $profileDir "package.json"
if (Test-Path $profilePkg) {
    $pkg = Get-Content $profilePkg -Raw | ConvertFrom-Json
    if (-not $pkg.'dsh.profile.bundles') {
        $pkg | Add-Member -NotePropertyName 'dsh.profile.bundles' -NotePropertyValue @()
    }
    $bundles = @($pkg.'dsh.profile.bundles')
    if ($bundles -notcontains '@local/dsh-tavern') {
        $bundles += '@local/dsh-tavern'
        $pkg.'dsh.profile.bundles' = $bundles
        $pkg | ConvertTo-Json -Depth 10 | Set-Content $profilePkg -Encoding utf8
        Write-Host "  已添加 @local/dsh-tavern 到 bundles" -ForegroundColor Green
    } else {
        Write-Host "  已在 bundles 中，跳过" -ForegroundColor Gray
    }
} else {
    Write-Host "  警告: 未找到 profile package.json，请手动添加 @local/dsh-tavern 到 dsh.profile.bundles" -ForegroundColor Yellow
}

# 5. 完成
Write-Host ""
Write-Host "[3/3] 安装完成！" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  安装成功！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步：" -ForegroundColor Yellow
Write-Host "  1. 完全关闭 DeepSeek Harness（包括后台进程）"
Write-Host "  2. 重新启动 DeepSeek Harness"
Write-Host "  3. 打开 Web UI，侧边栏会出现「🍺 酒馆管理」"
Write-Host "  4. 右上角会出现「🎭 预设」浮动按钮"
Write-Host ""
Write-Host "卸载方法：" -ForegroundColor Yellow
Write-Host "  删除目录: $nodeModulesDir"
Write-Host "  并从 profile package.json 的 dsh.profile.bundles 中移除 '@local/dsh-tavern'"
Write-Host ""
