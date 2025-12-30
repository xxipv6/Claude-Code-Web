#!/bin/bash
# 打包脚本 - 创建发布包

VERSION="1.0.0"
PACKAGE_NAME="claude-standalone-${VERSION}"
RELEASE_DIR="/workspace/${PACKAGE_NAME}"

echo "📦 创建发布包: ${PACKAGE_NAME}"

# 创建临时目录
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

# 复制文件
cp -r bin "${RELEASE_DIR}/"
cp -r server "${RELEASE_DIR}/"
cp -r public "${RELEASE_DIR}/"
cp -r config "${RELEASE_DIR}/"
cp README.md "${RELEASE_DIR}/"
cp start.sh "${RELEASE_DIR}/"
cp start.bat "${RELEASE_DIR}/"

# 创建示例配置
mkdir -p "${RELEASE_DIR}"
cat > "${RELEASE_DIR}/config.json.example" << 'EOF'
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key-here",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1
  },
  "server": {
    "port": 3002,
    "host": "0.0.0.0",
    "keepRunningInBackground": true
  }
}
EOF

# 添加执行权限
chmod +x "${RELEASE_DIR}/start.sh"
chmod +x "${RELEASE_DIR}/bin/claude"

# 创建 tar.gz 压缩包
cd /workspace
tar -czf "${PACKAGE_NAME}.tar.gz" "${PACKAGE_NAME}"

# 计算大小和 MD5
SIZE=$(du -h "${PACKAGE_NAME}.tar.gz" | cut -f1)
MD5=$(md5sum "${PACKAGE_NAME}.tar.gz" | cut -d' ' -f1)

echo ""
echo "✅ 打包完成！"
echo ""
echo "📦 包名: ${PACKAGE_NAME}.tar.gz"
echo "📏 大小: ${SIZE}"
echo "🔐 MD5: ${MD5}"
echo ""
echo "位置: /workspace/${PACKAGE_NAME}.tar.gz"
echo ""
echo "解压使用:"
echo "  tar -xzf ${PACKAGE_NAME}.tar.gz"
echo "  cd ${PACKAGE_NAME}"
echo "  ./start.sh"
