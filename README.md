# 小基比可

小基比可是一个面向个人研究和开源学习的场外基金筛选工具，提供基金搜索、流式抓取、详情查看、费率补全和比较列表。

项目名来自一只叫“小可”的牡丹鹦鹉，外号“小鸡 B 可”。Logo 也以她的白蓝羽色为原型，画成叼着金币、翅膀比 OK 的小鸟。

## 项目定位

小基比可是一个开源学习和个人研究项目，用于演示如何整理公开基金信息、构建筛选界面和比较视图。项目不提供证券、基金、期货或其他金融产品的投资咨询、投资顾问、基金评价、基金销售、代客理财、收益承诺或交易撮合服务。

页面中的收益、回撤、费率、持仓、交易状态、排序、筛选、颜色高亮和比较结果仅供技术演示与个人研究，不构成买入、卖出、持有、转换、定投、赎回或任何其他投资建议。投资决策请以基金合同、招募说明书、定期报告、销售机构公告和监管披露文件等权威资料为准。

## 快速开始

第一次使用请先看 [快速开始文档](docs/QUICK_START.md)。普通用户推荐直接用 Docker 启动：

```bash
docker compose up --build
```

启动后打开：

```text
http://127.0.0.1:8000
```

## 本地开发

一行启动本地调试：

```bash
npm run dev
```

该命令会同时启动后端 FastAPI 服务和前端 Vite 服务，并自动把前端代理指向本次启动的后端端口。

手动启动：

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

缓存数据写入容器内 `/data/fund_data_cache.json`，`docker-compose.yml` 通过命名 volume `xiaojibike-data` 持久化。也可以改成宿主机目录挂载：

```yaml
volumes:
  - ./runtime-data:/data
```

多架构构建：

```bash
IMAGE=registry.example.com/xiaojibike TAG=0.1.0 PUSH=1 ./scripts/build-multiarch.sh
```

默认平台是 `linux/amd64,linux/arm64`。不设置 `PUSH=1` 且使用多平台时，脚本会导出 `dist/<image>-<tag>.oci.tar`；单平台时使用 `--load` 方便本机调试。

## 数据来源

- AKShare `fund_purchase_em`
- AKShare `fund_overview_em`
- 天天基金 F10 网页
- 东方财富基金接口收益曲线

默认冷启动候选代码在 `data/fund_candidates.json`，运行缓存不写回该文件。

开源许可证仅覆盖本仓库代码，不代表第三方数据源授权。部署、公开访问、商业使用、缓存、再分发或批量抓取前，请自行确认 AKShare、东方财富、天天基金等第三方服务协议、版权声明、数据授权、访问频率限制和所在地法律法规。

## 开源与合规文件

- `LICENSE`：本仓库代码的 MIT License。
- `DISCLAIMER.md`：投资建议、基金评价、数据准确性和使用责任免责声明。
- `PRIVACY.md`：默认数据处理和公网部署隐私责任说明。
- `SECURITY.md`：安全报告方式和部署建议。
- `THIRD_PARTY_NOTICES.md`：第三方依赖许可证概览。
- `docs/QUICK_START.md`：面向普通用户的快速开始说明。
- `docs/OPEN_SOURCE_COMPLIANCE.md`：公开仓库和公网部署前的检查清单。

## 公网部署提示

如果把本项目部署为公开网站，建议至少完成：

- 使用合规云资源、域名和备案流程。
- 在首页保留清晰的免责声明和隐私说明入口。
- 为公开 API 加限流、缓存、超时、错误降敏和基础监控。
- 限制匿名 `force_refresh`，避免公开实例被用作批量抓取代理。
- 使用正式授权的数据源，或确认第三方服务协议允许公开展示、缓存和再分发。
- 避免使用“推荐”“优选”“买入”“收益保证”“评级”“排名”等容易被理解为投顾、荐基或基金评价的表达。

## 环境变量

配置前缀为 `XIAOJIBIKE_`。常用变量包括 `XIAOJIBIKE_APP_DATA_DIR`、`XIAOJIBIKE_BACKEND_PORT`、`XIAOJIBIKE_FRONTEND_PORT` 和 `XIAOJIBIKE_BACKEND_URL`。
