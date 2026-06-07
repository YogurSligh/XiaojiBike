# 快速开始

这份文档面向第一次使用开源项目的普通用户。你不需要先理解前端、后端、Python、Node.js 的细节，只要按步骤操作，就能在自己的电脑上打开“小基比可”。

## 先确认你想怎么用

推荐优先选择 Docker 方式：

- 你已经在用 Codex、Claude Code、通义灵码、豆包 MarsCode、Trae、CodeBuddy 等 Agent：让 Agent 帮你启动。
- 你只是想马上打开项目试用：用 Docker。
- 你不想分别安装 Python 和 Node.js：用 Docker。
- 你想参与开发、改代码、调试前端页面：用本地开发方式。

## 方式一：让 Agent 帮你启动

如果你不熟悉命令行，可以把下面这段提示词复制给 Codex、Claude Code 或其他代码 Agent。Agent 会帮你检查环境、安装依赖、启动项目，并告诉你应该打开哪个地址。

国内用户常见的代码 Agent 或 AI 编程工具包括但不限于：

- 通义灵码
- 豆包 MarsCode
- 腾讯云 CodeBuddy
- 百度 Comate
- Trae
- CodeGeeX
- CodeFuse
- CodeArts Snap

不必纠结具体工具名称。只要这个工具能打开项目文件夹、阅读项目文件、执行终端命令，就可以按下面的提示词操作。

使用前先准备好：

- 已经下载或克隆了项目代码。
- Agent 可以访问这个项目文件夹。
- 如果你想用最省心的方式，先安装并打开 Docker Desktop。

### 通用提示词

把 `<项目文件夹路径>` 换成你的真实路径，例如 macOS 上可能是 `/Users/你的用户名/Downloads/xiaojibike`，Windows 上可能是 `C:\Users\你的用户名\Downloads\xiaojibike`。

```text
请帮我在本机启动这个开源项目“小基比可”。

项目路径：<项目文件夹路径>

我的目标是尽快在浏览器里打开并试用，不需要改代码。

请按下面顺序处理：
1. 先进入项目目录，确认这是小基比可项目。
2. 优先检查 Docker 是否可用；如果 Docker 可用，请用 docker compose up --build 启动。
3. 如果 Docker 不可用，再检查 Python 3.12+、Node.js 20+ 和 npm 是否可用；如果可用，请用 npm run dev 启动。
4. 启动后告诉我浏览器应该打开的本地地址。
5. 如果启动失败，请用普通用户能看懂的话说明缺什么、怎么安装、下一步该做什么。

注意：
- 不要修改项目代码。
- 不要提交 git。
- 不要把它当成投资建议工具，只需要帮我本地启动试用。
```

### 给 Codex 的提示词

如果你使用 Codex，可以复制这一段：

```text
请在当前工作区启动“小基比可”项目给我试用。先读 README.md 和 docs/QUICK_START.md，优先用 Docker；如果 Docker 不可用，再用 npm run dev。启动成功后告诉我前端访问地址。只做本地启动和必要环境检查，不改代码、不提交。
```

### 给 Claude Code 的提示词

如果你使用 Claude Code，可以复制这一段：

```text
I want to run this open-source project locally for a quick trial. Please inspect README.md and docs/QUICK_START.md, then start the app. Prefer Docker with `docker compose up --build`; if Docker is unavailable, use `npm run dev`. After it starts, tell me the local URL to open. Do not modify files or commit changes.
```

### 给国产代码 Agent 的提示词

如果你使用通义灵码、豆包 MarsCode、腾讯云 CodeBuddy、百度 Comate、Trae、CodeGeeX、CodeFuse、CodeArts Snap 等工具，可以复制这一段：

```text
帮我本地启动“小基比可”这个开源项目。我只是普通用户，想尽快打开网页试用。请先阅读 README.md 和 docs/QUICK_START.md，优先使用 Docker 启动；如果 Docker 不可用，再用本地开发方式启动。启动成功后告诉我浏览器访问地址。不要修改代码，不要提交 git。
```

Agent 启动成功后，通常会给你一个类似下面的地址：

```text
http://127.0.0.1:8000
```

或：

```text
http://127.0.0.1:5173
```

把这个地址复制到浏览器打开即可。

## 方式二：用 Docker 启动

这是最省心的方式。Docker 会把项目需要的运行环境一起准备好。

### 1. 安装 Docker Desktop

到 Docker 官网下载安装 Docker Desktop：

```text
https://www.docker.com/products/docker-desktop/
```

安装完成后打开 Docker Desktop，等它显示正在运行。

### 2. 下载项目代码

如果你会用 Git：

```bash
git clone <你的 GitHub 仓库地址>
cd xiaojibike
```

如果你不会用 Git：

1. 打开 GitHub 仓库页面。
2. 点击绿色的 `Code` 按钮。
3. 点击 `Download ZIP`。
4. 解压 ZIP 文件。
5. 用终端进入解压后的项目文件夹。

macOS 可以在项目文件夹里右键选择“新建位于文件夹位置的终端窗口”。Windows 可以在文件夹地址栏输入 `cmd` 后回车。

### 3. 启动项目

在项目根目录运行：

```bash
docker compose up --build
```

第一次启动会下载依赖和构建镜像，可能需要几分钟。看到类似下面的输出后，表示服务已经启动：

```text
Uvicorn running on http://0.0.0.0:8000
```

### 4. 打开网页

浏览器访问：

```text
http://127.0.0.1:8000
```

看到“小基比可”页面后，就可以搜索基金代码、简称或关键词了。

### 5. 停止项目

在刚才运行 Docker 命令的终端里按：

```text
Ctrl + C
```

如果想彻底停止后台容器，也可以运行：

```bash
docker compose down
```

## 方式三：本地开发启动

如果你想改代码或调试页面，可以用这种方式。

### 1. 安装基础工具

需要安装：

- Python 3.12 或更高版本。
- Node.js 20 或更高版本。
- npm。

检查是否安装成功：

```bash
python3 --version
node --version
npm --version
```

### 2. 下载项目代码

```bash
git clone <你的 GitHub 仓库地址>
cd xiaojibike
```

### 3. 一行启动

在项目根目录运行：

```bash
npm run dev
```

脚本会自动：

- 创建后端 Python 虚拟环境。
- 安装后端依赖。
- 安装前端依赖。
- 找可用端口。
- 同时启动后端和前端。

启动成功后，终端会显示类似：

```text
Backend:  http://127.0.0.1:8765
Frontend: http://127.0.0.1:5173
Data:     ./runtime-data
```

浏览器打开 `Frontend` 后面的地址即可。

### 4. 停止本地开发服务

在运行服务的终端里按：

```text
Ctrl + C
```

## 基本使用方法

打开网页后可以这样用：

1. 在搜索框输入基金代码，例如 `006327`。
2. 也可以输入基金简称或关键词，例如 `纳斯达克`、`QDII`。
3. 用逗号分隔多个关键词，例如 `纳斯达克,QDII`。
4. 点击“搜索”。
5. 点击表格里的基金名称查看详情。
6. 点击“加入比较”后，可以在比较列表里横向查看多个基金的指标。

页面里的排序、颜色、图表和比较结果只用于展示数据，不代表投资建议。

## 常见问题

### 端口被占用怎么办？

Docker 方式默认使用 `8000` 端口。如果端口被占用，可以改 `docker-compose.yml` 里的端口映射，例如：

```yaml
ports:
  - "8010:8000"
```

然后访问：

```text
http://127.0.0.1:8010
```

本地开发方式会自动寻找可用端口，通常不需要手动处理。

### 第一次启动很慢正常吗？

正常。第一次启动需要下载依赖、构建前端和安装 Python 包。后续启动会快很多。

### 搜索结果为空怎么办？

可能原因包括：

- 关键词太模糊。
- 第三方数据源暂时不可用。
- 网络无法访问数据源。
- 基金代码或名称输入错误。

可以先尝试输入明确的 6 位基金代码。

### 页面提示加载失败怎么办？

先检查：

- 电脑是否能正常联网。
- Docker Desktop 是否正在运行。
- 终端里是否有明显报错。
- 是否频繁刷新导致第三方数据源临时拒绝访问。

如果只是部分字段为空，不一定是程序错误，也可能是数据源没有披露或接口暂时返回不完整。

### 缓存数据在哪里？

Docker 方式默认把缓存写到容器的 `/data/fund_data_cache.json`，并通过 Docker volume 保存。

本地开发方式默认写到项目根目录的：

```text
runtime-data/fund_data_cache.json
```

这个文件是运行缓存，不需要提交到 GitHub。

## 公开部署前先看这里

如果你准备把“小基比可”部署成公开网站，请先阅读：

- `DISCLAIMER.md`
- `PRIVACY.md`
- `SECURITY.md`
- `docs/OPEN_SOURCE_COMPLIANCE.md`

重点确认：

- 不要把它包装成投资建议、荐基、基金评价或基金销售服务。
- 公开 API 要做限流和错误降敏。
- 数据源展示、缓存和再分发需要确认授权边界。
- 使用中国大陆服务器或域名时，要按要求处理备案和隐私政策。
