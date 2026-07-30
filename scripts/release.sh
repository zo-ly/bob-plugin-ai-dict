#!/usr/bin/env bash
# 一键发版：bump info.json 版本 → 质量门禁 → 提交 → 打注释标签 → push。
#   scripts/release.sh 0.1.3 "发版说明"
# push 后 GitHub Actions（release.yml）接手：构建 .bobplugin、创建 Release、回填 appcast.json。
# 标签 message 会成为 Release notes 和 Bob 更新弹窗里的描述；省略时默认 "Release vX.Y.Z"。
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
DESC="${2:-}"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "用法：scripts/release.sh <x.y.z> [发版说明]" >&2
  exit 1
fi

TAG="v${VERSION}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "当前在 ${BRANCH}，发版必须在 main" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区不干净，先提交或 stash" >&2
  exit 1
fi

CURRENT=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' info.json | head -1)
if [ "$(printf '%s\n' "$CURRENT" "$VERSION" | sort -V | tail -1)" != "$VERSION" ] || [ "$CURRENT" = "$VERSION" ]; then
  echo "新版本 ${VERSION} 必须大于当前版本 ${CURRENT}" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  echo "标签 ${TAG} 已存在" >&2
  exit 1
fi

# 先与远端同步，避免 push 时才发现落后
git pull --ff-only origin main

npm run lint
npm run typecheck
npm test
npm run build

sed -E "s/(\"version\"[[:space:]]*:[[:space:]]*\")[^\"]*/\1${VERSION}/" info.json > info.json.tmp
mv info.json.tmp info.json

git add info.json
git commit -m "🔖 chore: release ${VERSION}"
git tag -a "$TAG" -m "${DESC:-Release ${TAG}}"
git push origin main "$TAG"

echo "已发布 ${TAG}（${CURRENT} → ${VERSION}），Actions 会构建 Release 并回填 appcast.json："
echo "https://github.com/zo-ly/bob-plugin-ai-dict/actions"
