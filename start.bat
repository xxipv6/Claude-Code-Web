@echo off
REM Claude Code Standalone - Windows 启动脚本

cd /d "%~dp0"

REM 检查配置文件
if not exist "config.json" (
    echo ⚠️  未找到配置文件，从模板创建...
    copy config\config.example.json config.json
    echo ✅ 已创建 config.json，请编辑此文件配置 API Key
    echo.
    echo 配置方法：
    echo 1. 编辑 config.json
    echo 2. 设置 env.ANTHROPIC_AUTH_TOKEN 为你的 API Key
    echo 3. 设置 env.ANTHROPIC_BASE_URL 为你的 API 地址（可选）
    echo.
    pause
)

REM 检查二进制文件
if not exist "bin\claude.exe" (
    if not exist "bin\claude" (
        echo ❌ 错误: 未找到 Claude 二进制文件 (bin/claude)
        pause
        exit /b 1
    )
)

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 错误: 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

echo 🚀 启动 Claude Code Standalone...
echo.

REM 启动服务器
node server/index.js
pause
