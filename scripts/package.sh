#!/usr/bin/env bash
# 本地打包 .bobplugin，用于开发自测。
# 版本号自动读自 info.json。产物在项目根目录，已被 .gitignore 忽略。
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' info.json | head -1)
if [ -z "$VERSION" ]; then
  echo "无法从 info.json 读取 version" >&2
  exit 1
fi

FILE="ai-dict-${VERSION}.bobplugin"
rm -f "$FILE"
FILES=(info.json main.js)
[ -f icon.png ] && FILES+=(icon.png)
zip -j -q "$FILE" "${FILES[@]}"

echo "已生成 $FILE"
echo "sha256: $(shasum -a 256 "$FILE" | cut -d' ' -f1)"
echo "双击安装：open \"$FILE\""
