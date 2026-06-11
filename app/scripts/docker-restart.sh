#!/usr/bin/env bash
# 代码更新后重建并重启 Docker 服务（生产 profile）
# 用法:
#   bash scripts/docker-restart.sh          # 完整 down + rebuild
#   bash scripts/docker-restart.sh --fast   # 跳过 rebuild，仅 up -d（镜像已存在时）
#   bash scripts/docker-restart.sh --build  # 仅 build，不 down
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"

case "$MODE" in
  --fast)
    echo "快速重启（跳过 rebuild）..."
    docker compose up -d
    ;;
  --build)
    echo "仅构建镜像..."
    docker compose build --build-arg NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
    ;;
  "")
    echo "完整重建并重启..."
    docker compose down
    docker compose build --build-arg NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
    docker compose up -d
    ;;
  *)
    echo "未知参数: $MODE"
    echo "用法: docker-restart.sh [--fast|--build]"
    exit 1
    ;;
esac

echo "data-clean-agent 已启动，访问 http://localhost:29000"
