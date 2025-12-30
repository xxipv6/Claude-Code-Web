#!/bin/bash
# 验证发布包完整性

echo "🔍 验证 Claude Code Standalone 发布包"
echo "======================================"
echo ""

ERRORS=0

# 检查必需文件
check_file() {
    if [ -f "$1" ]; then
        echo "✅ $1"
    else
        echo "❌ $1 (缺失)"
        ERRORS=$((ERRORS + 1))
    fi
}

# 检查必需目录
check_dir() {
    if [ -d "$1" ]; then
        echo "✅ $1/"
    else
        echo "❌ $1/ (缺失)"
        ERRORS=$((ERRORS + 1))
    fi
}

echo "📁 目录结构:"
check_dir "bin"
check_dir "server"
check_dir "public"
check_dir "config"

echo ""
echo "📄 核心文件:"
check_file "bin/claude"
check_file "server/index.js"
check_file "public/chat.html"
check_file "config/config.example.json"
check_file "start.sh"
check_file "start.bat"
check_file "README.md"
check_file ".gitignore"

echo ""
echo "🔐 文件权限:"
if [ -x "bin/claude" ]; then
    echo "✅ bin/claude (可执行)"
else
    echo "❌ bin/claude (无执行权限)"
    ERRORS=$((ERRORS + 1))
fi

if [ -x "start.sh" ]; then
    echo "✅ start.sh (可执行)"
else
    echo "❌ start.sh (无执行权限)"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "📏 文件大小:"
BIN_SIZE=$(du -h "bin/claude" | cut -f1)
echo "  bin/claude: ${BIN_SIZE}"

echo ""
echo "🎯 Claude 二进制文件:"
if [ -f "bin/claude" ]; then
    BIN_TYPE=$(file "bin/claude" | cut -d: -f2)
    echo "  类型: ${BIN_TYPE}"

    # 检查是否为 ELF 可执行文件
    if file "bin/claude" | grep -q "ELF.*executable"; then
        echo "  ✅ 二进制文件格式正确"
    else
        echo "  ❌ 二进制文件格式错误"
        ERRORS=$((ERRORS + 1))
    fi
fi

echo ""
echo "======================================"
if [ $ERRORS -eq 0 ]; then
    echo "✅ 验证通过！发布包完整"
    exit 0
else
    echo "❌ 验证失败！发现 ${ERRORS} 个错误"
    exit 1
fi
