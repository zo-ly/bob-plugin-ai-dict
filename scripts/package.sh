#!/usr/bin/env bash
# 本地打包 .bobplugin：类型检查 + 构建 dist/main.js，再打包。
#   scripts/package.sh        正式包：版本号读自 info.json
#   scripts/package.sh dev    调试包：版本号覆盖成 0.0.<时间戳>（单调递增、每次唯一），
#                             这样每次装进 Bob 都被当成更新、必定生效；且 0.0.x 恒低于正式版，
#                             调试完 push 出的正式版能被 Bob 正常更新覆盖。真实 info.json 不改动。
set -euo pipefail

cd "$(dirname "$0")/.."

npm run typecheck
npm run build

MODE="${1:-release}"

if [ "$MODE" = "dev" ]; then
  # 减去一个基准 epoch，让 patch 号保持在较小范围（避免个别 semver 解析器对超大整数敏感）
  VERSION="0.0.$(( $(date +%s) - 1700000000 ))"
  # 临时 info.json 只改 version 字段；放进子目录，zip -j 压平后归档内仍叫 info.json
  mkdir -p dist/.pkg-dev
  INFO="dist/.pkg-dev/info.json"
  sed -E "s/(\"version\"[[:space:]]*:[[:space:]]*\")[^\"]*/\1${VERSION}/" info.json > "$INFO"
  FILE="dist/ai-dict-dev.bobplugin"
else
  VERSION=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' info.json | head -1)
  INFO="info.json"
  FILE="dist/ai-dict-${VERSION}.bobplugin"
fi

if [ -z "$VERSION" ]; then
  echo "无法确定 version" >&2
  exit 1
fi

rm -f "$FILE"
FILES=("$INFO" dist/main.js)
[ -f icon.png ] && FILES+=(icon.png)
zip -j -q "$FILE" "${FILES[@]}"

echo "已生成 ${FILE} (version=${VERSION})"
echo "sha256: $(shasum -a 256 "$FILE" | cut -d' ' -f1)"
echo "双击安装：open \"$FILE\""
