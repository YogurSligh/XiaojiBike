# 第三方许可说明

本文件汇总项目直接依赖和前端锁文件中出现的主要许可证类别，用于开源发布前的许可告知。完整、精确的依赖版本以 `frontend/package-lock.json`、`frontend/package.json` 和 `backend/pyproject.toml` 为准。

## 项目许可证

小基比可本仓库代码使用 MIT License，详见 `LICENSE`。

## 后端直接依赖

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| AKShare | 财经数据接口封装 | MIT |
| beautifulsoup4 | HTML 解析 | MIT |
| FastAPI | Web API 框架 | MIT |
| pandas | 表格数据处理 | BSD-3-Clause |
| pydantic-settings | 配置读取 | MIT |
| requests | HTTP 请求 | Apache-2.0 |
| uvicorn | ASGI 服务 | BSD-3-Clause |

## 前端直接依赖

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| React | 前端 UI 框架 | MIT |
| React DOM | React DOM 渲染 | MIT |
| Ant Design | UI 组件库 | MIT |
| @ant-design/icons | 图标 | MIT |
| Vite | 构建工具 | MIT |
| TypeScript | 类型系统和编译 | Apache-2.0 |

## 前端锁文件许可证概览

截至本文件创建时，`frontend/package-lock.json` 中记录的依赖许可证类别包括：

| 许可证 | 数量 | 示例 |
| --- | ---: | --- |
| MIT | 180 | `@ant-design/icons`, `react`, `vite` |
| ISC | 5 | `semver`, `picocolors` |
| Apache-2.0 | 2 | `typescript`, `baseline-browser-mapping` |
| BSD-3-Clause | 1 | `source-map-js` |
| CC-BY-4.0 | 1 | `caniuse-lite` |

## 数据源不在开源许可证授权范围内

本文件只说明软件依赖许可证。AKShare、东方财富、天天基金等第三方数据、页面、接口、商标、版权内容和服务协议不属于本仓库 MIT License 的授权范围。使用者应自行确认数据授权、展示边界、缓存边界、访问频率和再分发限制。
