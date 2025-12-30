#!/bin/bash
# Claude Code Standalone - 启动脚本

cd "$(dirname "$0")"

# 检查配置文件
if [ ! -f "config.json" ]; then
    echo "⚠️  未找到配置文件，从模板创建..."
    cp config/config.example.json config.json
    echo "✅ 已创建 config.json，请编辑此文件配置 API Key"
    echo ""
    echo "配置方法："
    echo "1. 编辑 config.json"
    echo "2. 设置 env.ANTHROPIC_AUTH_TOKEN 为你的 API Key"
    echo "3. 设置 env.ANTHROPIC_BASE_URL 为你的 API 地址（可选）"
    echo ""
    read -p "配置完成后按回车继续..."
fi

# 检查二进制文件
if [ ! -f "bin/claude" ]; then
    echo "❌ 错误: 未找到 Claude 二进制文件 (bin/claude)"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    exit 1
fi

echo "🚀 启动 Claude Code Standalone..."
echo ""

# 启动服务器
node server/index.js
