# 选基宝

从 `chicangguanliqi` 独立出来的场外基金筛选工具，只保留基金搜索、流式抓取、详情查看、费率补全和比较列表，不包含定投、持仓、资产分类、Excel 导入或备份恢复等原项目数据面。

## 本地开发

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

```bash
cd frontend
npm install
npm run dev
```

前端默认代理 `/api` 到 `http://127.0.0.1:8000`。

## Docker

单架构本地运行：

```bash
docker compose up --build
```

缓存数据写入容器内 `/data/fund_data_cache.json`，`docker-compose.yml` 通过命名 volume `xuanjibao-data` 持久化。也可以改成宿主机目录挂载：

```yaml
volumes:
  - ./runtime-data:/data
```

多架构构建：

```bash
IMAGE=registry.example.com/xuanjibao TAG=0.1.0 PUSH=1 ./scripts/build-multiarch.sh
```

默认平台是 `linux/amd64,linux/arm64`。不设置 `PUSH=1` 且使用多平台时，脚本会导出 `dist/<image>-<tag>.oci.tar`；单平台时使用 `--load` 方便本机调试。

## 数据来源

- AKShare `fund_purchase_em`
- AKShare `fund_overview_em`
- 天天基金 F10 网页
- 东方财富基金接口收益曲线

默认冷启动候选代码在 `data/fund_candidates.json`，运行缓存不写回该文件。
