# Wallpaper时光机

一个精美的 Bing 每日壁纸网站项目，**前端站点与壁纸 API 已合并为同一个 Cloudflare Worker 部署单元**：Worker 既负责 Bing 壁纸的抓取入库与接口服务，又在边缘对 WebStudio 生成的静态页面做数据注入（SSR），同时提供 Android / Windows 客户端下载跳转。支持网页版、Android 和 Windows 应用程序。

## 功能特性

### 网站前端

- 🎨 精美的壁纸展示界面，基于 WebStudio SSG 构建
- 📱 响应式设计，支持移动端
- � 首页支持关键词搜索与分页（`search` / `page` / `limit` / `size` 查询参数透传）
- 🖼️ 详情页支持按 `enddate` 浏览任意一天的壁纸，缺省展示当天壁纸
- 🖼️ 集成 Viewer.js 图片查看器（构建时自动安装并本地化到 `/npm/viewerjs`）
- �📦 提供 Android APK、Windows NSIS 安装版与免安装版下载页（307 跳转至 GitCode Releases）
- 🚀 边缘 SSR：Worker 在响应 HTML / 入口 JS 时实时注入 Supabase 数据，静态产物无需重新构建即可展示最新壁纸

### 壁纸 API

- 从 Bing 每日图片接口聚合两个时间窗口（`idx=0` 与 `idx=7`）的数据，自动去重并按日期降序排列
- 使用 Supabase（PostgreSQL）存储壁纸信息，按 `enddate` 增量入库（upsert + 忽略重复）
- 提供搜索、详情、浏览量原子自增、手动更新等接口，均支持 GET / POST
- 提供 `/api/bing-hp` 实时聚合接口（不落库），支持通过 `mkt` 切换市场区域
- 支持 Cron 定时触发自动更新
- 全接口开放跨域（CORS），内置静态资源托管与 404 页面
- 📐 提供 OpenAPI 3.0 架构文件 `wallpaper-api-schema.yaml`，可直接上传 Cloudflare API Shield 进行请求结构校验（详见 [OpenAPI 架构文件](#6-openapi-架构文件wallpaper-api-schemayaml)）

## 项目结构

```
wallpaper/
├── public/                        # 静态资源与 Worker 源文件
│   ├── _worker.js                 # 合并后的 Worker：API + 边缘 SSR + 静态资源缓存
│   ├── _headers                   # 静态资产缓存头配置（仅对不经 Worker 的静态资产生效）
│   ├── 404.html                   # 404 页面
│   ├── wallpaper/404.html         # api 404 页面
│   ├── app.html                   # Android（5+ WebView）客户端壳页面模板
│   ├── android-apk.html           # Android APK 下载页（{{androidVersion}} 占位）
│   ├── windows-nsis-exe.html      # Windows NSIS 安装版下载页（{{windowsVersion}} 占位）
│   └── windows-portable-exe.html  # Windows 免安装版下载页（{{windowsVersion}} 占位）
├── scripts/
│   ├── pages.js                   # 构建编排脚本（版本文件、路由、WebStudio 构建等）
│   └── workers.sh                 # 生成 wrangler.jsonc 并上传 SUPABASE_ANON_KEY 密钥
├── wallpaper-api-schema.yaml      # OpenAPI 3.0 接口契约（上传 Cloudflare API Shield 用）
├── .gitignore
├── package.json
└── LICENSE
```

构建过程中还会生成以下产物（不入库）：`public/version.json`、`public/_routes.json`、`public/_redirects`、`public/npm/viewerjs/`、`.webstudio/`、`dist/`、`wrangler.jsonc`。

## 整体架构与请求路由

部署到 Cloudflare Workers 时，`scripts/workers.sh` 会在生成的 `wrangler.jsonc` 中通过 `assets.run_worker_first` 精确声明以下优先进入 Worker 的路径，其余路径全部由静态资源（ASSETS）直接响应。Cloudflare Pages 部署时则由 `scripts/pages.js` 生成的 `_routes.json` 声明白名单，路径列表与下方完全一致：

```
/                        /detail                  /detail/
/assets/entries/<routing>      /assets/entries/<index>      /assets/entries/<detail>
/api/search      /api/detail      /api/view      /api/update      /api/bing-hp
/wallpaper/search  /wallpaper/detail  /wallpaper/view  /wallpaper/update  /wallpaper/bing-hp
```

其中 `<routing>`、`<index>`、`<detail>` 三个入口文件名由 `workers.sh` 在构建产物 `dist/client/assets/entries/` 中自动探测（`entry-server-routing.*.js`、`pages_index.*.js`、`pages_detail.*.js`）。

Worker（`public/_worker.js`）内部的处理顺序：

1. `OPTIONS` 预检直接返回 `204`；
2. 命中 10 个 API 路径之一 → 走 Bing / Supabase 接口逻辑（见 [API 接口](#api-接口)）；
3. 命中 `/`、`/detail`、入口 JS 等 6 个前端路径 → 从 ASSETS 取静态产物，实时替换/注入数据后返回（见[边缘 SSR 机制](#边缘-ssr-机制)）；
4. 其余请求回退 `env.ASSETS.fetch(request)`，并统一附加静态资源长期缓存头。

## 环境变量

### 构建期环境变量（`scripts/pages.js` 读取）

| 变量名 | 说明 | 是否必需 |
| --- | --- | --- |
| `VERSION` | 版本信息 JSON，格式见[下文](#版本信息格式) | 是 |
| `BACKGROUND_IMAGE` | APP 壳页面背景图片文件名（拼接为 `/assets/<文件名>`） | 是 |
| `WEBSTUDIO_LINK` | WebStudio 项目链接，用于 `webstudio link` | 是 |
| `VIEWERJS_URL` | 构建前 data.json 中需要替换为本地 `/npm/viewerjs` 的 Viewer.js 地址 | 是 |
| `DOMAIN` | 网站域名，写入 APP 壳页面的 WebView 目标地址及数据接口地址 | 是 |
| `FAVICON` | favicon 源文件名（位于 `public/assets/`，复制为 `public/favicon.ico`） | 是 |
| `F404PAGE` | 构建产物中 404 页面的相对路径，默认 `404/index.html` | 是 |
| `ROUTING_JS` / `INDEX_JS` / `DETAIL_JS` | 三个入口 JS 的文件名；缺失时脚本仅告警，实际文件名由 `workers.sh` 自动探测 | 建议配置 |

### 运行期环境变量（写入 `wrangler.jsonc` 的 `vars`）

| 变量名 | 说明 |
| --- | --- |
| `SUPABASE_URL` | Supabase 项目 URL，例如 `https://xxxx.supabase.co` |
| `SUPABASE_TABLE_NAME` | 存储壁纸数据的表名，例如 `bing_wallpaper_data` |
| `ROUTING_JS` / `INDEX_JS` / `DETAIL_JS` | Worker 运行时识别入口 JS 所用的文件名（自动探测写入） |

### 密钥（secret）

| 变量名 | 说明 |
| --- | --- |
| `SUPABASE_ANON_KEY` | Supabase 匿名密钥（anon key）。`workers.sh` 通过 `wrangler versions secret put` 上传，不会写入配置文件 |

### 版本信息格式

`VERSION` 环境变量为 JSON 字符串，用于生成 `version.json`、替换下载页版本号、生成 `_redirects` 下载地址：

```json
{
  "website": { "name": "1.0.0", "code": 1 },
  "android": { "name": "1.0.0", "code": 1 },
  "windows": { "name": "1.0.0", "code": 1 }
}
```

未设置或解析失败时使用默认值 `0.0.0 / code 0`。

## 构建与部署

### 1. Cloudflare Pages 构建

```bash
npm run pages
```

`scripts/pages.js` 依次完成：

1. 生成 `public/version.json`、`public/_routes.json`（Pages Functions 路由白名单，包含 6 个前端路径与 10 个 API 路径，与 Workers 部署的 `run_worker_first` 列表保持一致）；
2. 生成 `public/_redirects`：三个客户端下载路径 307 跳转至 GitCode Releases（地址随 `VERSION` 中的版本号变化）；
3. 替换下载页与 `app.html` 中的版本号、背景图、域名占位符；
4. 安装 Viewer.js 并复制到 `public/npm/viewerjs`；
5. 执行 `webstudio link` / `webstudio sync`，替换 data.json 中的 Viewer.js 地址后执行 `webstudio build --template ssg`；
6. 复制 favicon、处理 `pages/` 下 `+data.ts` 的接口域名、执行项目自身的 `npm run build`；
7. 复制 404 页面，并安装运行期依赖 `@supabase/supabase-js`。

### 2. Cloudflare Workers 构建

先导出 Shell 环境变量，再执行：

```bash
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_ANON_KEY="你的-anon-key"
export SUPABASE_TABLE_NAME="bing_wallpaper_data"
# 以及 pages.js 所需的 VERSION、DOMAIN、WEBSTUDIO_LINK 等构建变量
npm run workers
```

该命令等价于 `node scripts/pages.js && bash scripts/workers.sh`：先完成上述 Pages 构建，再生成 `wrangler.jsonc`、写入 `dist/client/.assetsignore`（内容为 `_worker.js`，使其作为 Worker 入口而非静态资源暴露），并上传 `SUPABASE_ANON_KEY` 密钥。随后执行：

```bash
npx wrangler deploy
```

### 3. 定时任务（可选）

Worker 导出了 `scheduled` 处理器，触发时执行与 `/api/update` 相同的增量更新逻辑。生成的 `wrangler.jsonc` 默认不含 Cron 触发器，需要手动补充，例如每天 UTC 00:07 执行一次：

```jsonc
{
  // ...其余配置
  "triggers": {
    "crons": ["7 0 * * *"]
  }
}
```

## API 接口

所有接口同时提供 `/api/*` 与 `/wallpaper/*` 两套等价路径；GET 参数走 Query String，POST 参数走 JSON Body。未知路径返回 `404` 与 `{ "error": "API不存在" }`。

### 接口总览

| 功能 | 路径（两套等价） | 方法 |
| --- | --- | --- |
| 搜索壁纸 | `/api/search`、`/wallpaper/search` | GET / POST |
| 壁纸详情 | `/api/detail`、`/wallpaper/detail` | GET / POST |
| 更新浏览量 | `/api/view`、`/wallpaper/view` | GET / POST |
| 手动更新数据 | `/api/update`、`/wallpaper/update` | GET / POST |
| 实时聚合图片 | `/api/bing-hp`、`/wallpaper/bing-hp` | GET / POST |

### 1. 搜索壁纸

分页搜索标题、版权信息或日期，结果按 `enddate` 降序返回。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `search` | string | `""` | 关键词，模糊匹配 `title`、`copyright`、`enddate`；为空时返回全部 |
| `page` | number | `1` | 页码，最小为 1 |
| `limit` | number | `30` | 每页数量，范围 1–100 |

```bash
curl "https://你的域名/api/search?search=山&page=1&limit=10"
```

```json
{
  "Previous_Page": 1,
  "Page": 1,
  "Next_Page": 1,
  "output": [
    {
      "enddate": "20261017",
      "url": "https://cn.bing.com/th?id=OHR.xxx_UHD.jpg",
      "copyright": "……",
      "title": "……",
      "views": 0
    }
  ]
}
```

当返回条数不足一页时 `Next_Page` 等于当前页，表示没有下一页。

### 2. 获取壁纸详情

按 `enddate` 精确查询单条记录。

- 参数：`enddate`（必填），8 位日期字符串，如 `20261017`

```bash
curl "https://你的域名/api/detail?enddate=20261017"
```

响应结构同搜索接口，`output` 为最多 1 条的数组；查询失败返回 `400`。

### 3. 更新浏览量

通过数据库函数 `increment_wallpaper_views` 将指定壁纸的 `views` 原子自增 1（单条 `UPDATE ... SET views = views + 1`，无并发竞态），并返回更新后的值。使用前需先在 Supabase 中创建该函数，见[数据库表结构](#数据库表结构)。

- 参数：`enddate`（必填）

```bash
curl -X POST "https://你的域名/api/view" \
  -H "Content-Type: application/json" \
  -d '{"enddate":"20261017"}'
```

```json
{ "output": [{ "views": 1 }] }
```

`enddate` 不存在时返回 `404`：`{ "error": "No data found for the given enddate" }`。

### 4. 手动更新壁纸数据

实时从 Bing 拉取最新壁纸并增量写入 Supabase，无需等待定时任务。无参数。

```json
{
  "inserted": 2,
  "skipped": 13,
  "errors": []
}
```

- `inserted`：新插入条数
- `skipped`：因 `enddate` 已存在而跳过的条数
- `errors`：查重或插入过程中的错误信息数组；抓取异常时返回 `500`

### 5. 实时聚合 Bing 图片（不落库）

直接聚合 Bing 两个时间窗口的图片返回，不读写数据库，适合前端直接展示最新图库。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mkt` | string | `zh-CN` | 市场区域；`zh-CN` 时图片域名为 `cn.bing.com`，其他区域为 `www.bing.com` |

```bash
curl "https://你的域名/api/bing-hp?mkt=en-US"
```

```json
{
  "images": [
    {
      "enddate": "20261017",
      "urlbase": "/th?id=OHR.xxx",
      "copyright": "……",
      "title": "……",
      "uhdurl": "https://cn.bing.com/th?id=OHR.xxx_UHD.jpg",
      "whurl": "https://cn.bing.com/th?id=OHR.xxx_UHD.jpg&w=3840&h=2160&rs=1&c=1"
    }
  ],
  "totalImages": 15,
  "mkt": "zh-CN",
  "sourceUrls": [
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN",
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=7&n=8&mkt=zh-CN"
  ],
  "timestamp": 1789000000000
}
```

每张图片在 Bing 原始字段基础上额外补充：

- `uhdurl`：UHD 高清图地址
- `whurl`：4K（3840×2160）分辨率地址

### 6. OpenAPI 架构文件（`wallpaper-api-schema.yaml`）

仓库根目录的 `wallpaper-api-schema.yaml` 是本 API 的 OpenAPI 3.0 契约文件，可直接上传到 [Cloudflare API Shield Schema Validation](https://developers.cloudflare.com/api-shield/security/schema-validation/)，由边缘按声明的参数与请求体结构校验入站请求：

- **覆盖范围**：10 条路径（`/api/*` 与 `/wallpaper/*` 两套等价路径）× GET / POST，共 20 个 operation，每个 operation 带有唯一 `operationId`；`servers` 声明 `api.mcyin.com`、`wallpaper.mcyin.com` 两个绝对 URL 主机名；
- **校验内容**：Query 参数的类型与取值范围（`page ≥ 1`、`limit` 为 1–100）、`enddate` 必须匹配 `^\d{8}$`、POST JSON body（`application/json`）的字段结构；
- **最小化设计**：Schema Validation 仅校验请求侧、不校验 responses，因此文件只保留参数与请求体定义，所有响应统一为占位的 `200`；全部 `$ref` 均为 `#/components/...` 本地引用（外部引用会导致上传失败），无 `uniqueItems`、参数 `content` / `anyOf` 等不支持的写法；
- **上传方式**：Cloudflare Dashboard → **Web Assets → Schema validation → Add validation**，上传该 YAML 后会自动创建 operation 与校验配置，检测默认仅记录（Log），需另行配置 WAF Custom Rule 才会拦截违规请求；
- **本地校验**：修改文件后可执行 `npx @apidevtools/swagger-cli validate wallpaper-api-schema.yaml` 验证 OpenAPI 合法性。

## 边缘 SSR 机制

合并版 Worker 在纯 API 能力之上，增加了对 WebStudio SSG 产物的边缘数据注入，站点无需客户端二次请求即可获得完整数据：

- **`/`（首页）**：透传完整查询字符串到首页入口 JS 与路由 JS，保证搜索 / 分页参数在资源引用间一致；
- **`/detail`、`/detail/`（详情页）**：缺省 `enddate` 时按 UTC+8 计算当天日期；查询 Supabase 取得壁纸数据后，将 HTML 中的占位内容（`示例标题`、`示例查看次数`、`示例版权文本`、`示例日期`、示例图片 URL）整体替换为真实数据；无参请求缓存 24 小时，带 `enddate` 的请求长期缓存（详见[缓存策略](#缓存策略)）；
- **`pages_index.*.js`（首页入口）**：实时查询搜索结果，将入口 JS 中内置的占位数据结构整体替换为 Supabase 返回值，并同步改写 `search / limit / size` 参数；该响应使用 `no-store` 缓存；
- **`pages_detail.*.js`（详情入口）**：按 `enddate` 注入单条壁纸数据，同样使用 `no-store` 缓存；
- **`entry-server-routing.*.js`（路由入口）**：替换其中首页 / 详情入口的引用地址以透传查询字符串。

## 缓存策略

Worker 通过 `serveTransformedAsset` 的 `cache` 参数统一管理经边缘处理的响应，共三档策略；三档均移除静态资源原有的 `ETag` / `Last-Modified`：

| 策略 | Cache-Control | 适用内容 |
| --- | --- | --- |
| `long`（默认） | `public, max-age=31536000, immutable` | 内容固定不变的静态产物 |
| `daily` | `public, max-age=86400` | 当天有效、次日可能变化的页面 |
| `none` | `private, no-store, max-age=0` | 每次请求实时注入数据的动态响应 |

各路径的实际策略：

| 路径 | 策略 | 说明 |
| --- | --- | --- |
| 普通静态资源（ASSETS 透传兜底） | `long` | 未命中 Worker 专有逻辑的所有静态资源 |
| `/` 首页 HTML | `long` | 页面骨架固定，实时数据由入口 JS 注入 |
| `/assets/entries/<routing>` 路由 JS | `long` | 仅改写入口引用上的查询字符串 |
| `/detail`、`/detail/`（**不带** `enddate`） | `daily` | 缺省展示当天壁纸，内容随日期切换，缓存 24 小时 |
| `/detail?enddate=...`（**带** `enddate`） | `long` | 历史日期的壁纸数据固定不变，可长期强缓存 |
| `/assets/entries/<index>`、`<detail>` 入口 JS | `none` | 响应体中实时注入 Supabase 搜索 / 详情数据 |

判断依据是**原始请求**是否携带 `enddate`：无参请求在服务端补全为当天日期后注入 HTML，因此只给 24 小时缓存，避免跨天后仍展示前一天壁纸；带参请求对应确定的历史记录，故与静态资源同级缓存。

### API 响应

API 路径（`/api/*`、`/wallpaper/*`）的所有 JSON 响应（含 400 / 404 / 500 错误响应）统一经 `addCorsHeaders` 输出，在附加 CORS 头的同时设置 `Cache-Control: private, no-store, max-age=0`，浏览器与 Workers Cache 均不缓存，每次请求都实时执行（搜索查询、浏览量自增、数据更新等）。这些路径全部位于 `run_worker_first` / `_routes.json` 白名单中，该缓存头由 Worker 代码自行给出，`_headers` 规则不会作用于它们。`OPTIONS` 预检响应为无实体的 `204`，仅携带 CORS 头，不设置缓存头。

### `_headers` 的作用范围

`public/_headers` 的规则只对**由平台直接输出的静态资产响应**生效。根据 Cloudflare 官方文档，无论 Workers 部署（配置了 `assets.run_worker_first`）还是 Pages 部署（Pages Functions / advanced mode `_worker.js`），`_headers` 规则均**不会**应用于 Worker 代码生成的响应。因此文件中各规则的实际效果为：

- `/*`（`public, max-age=31536000, immutable`）：作用于不经 Worker 的静态资产（图片、CSS、字体、favicon、`/npm/viewerjs` 等），与 Worker 兜底透传资产时设置的长缓存等价；
- `/assets/entries/pages*`、`/api/*`、`/wallpaper/*`（`private, no-store, max-age=0`）：对已列入白名单的三个入口 JS 与 10 个 API 路径**不生效**——它们的 no-store 头由 Worker 代码自行设置（见上文三档策略与 [API 响应](#api-响应)小节）；该规则仅可能匹配白名单之外的其他 `pages_*` 静态资产。

### Workers Cache（边缘缓存）

生成的 `wrangler.jsonc` 默认开启 Workers Cache（`"cache": { "enabled": true }`）：请求到达后先查边缘缓存，命中时直接返回、不执行 Worker。是否缓存完全由响应的 `Cache-Control` 按 RFC 9111 判定，且仅 GET / HEAD 请求参与：`long` 与 `daily` 响应会被边缘缓存对应时长，`none` 策略的入口 JS 与显式 `no-store` 的 API 响应均不缓存、每次实时执行；带 `Set-Cookie` 或请求带 `Authorization` 时自动绕过。缓存键默认包含 Worker 版本，重新部署后旧缓存自然失效。此外 `wrangler.jsonc` 默认开启完整可观测性日志。

参考文档：[Workers Static Assets — Headers](https://developers.cloudflare.com/workers/static-assets/headers/)、[Pages — Headers](https://developers.cloudflare.com/pages/platform/headers/)、[Workers Cache](https://developers.cloudflare.com/workers/cache/)。

## 数据库表结构

Supabase 表至少包含以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enddate` | text | 8 位日期，主键，非空 |
| `url` | text | UHD 壁纸地址，可为空 |
| `copyright` | text | 版权信息，可为空 |
| `title` | text | 标题，可为空 |
| `views` | bigint | 浏览量，可为空；Worker 写入新记录时默认填 0 |

建表 SQL 示例：

```sql
create table public.bing_wallpaper_data (
  copyright text null,
  enddate text not null,
  title text null,
  url text null,
  views bigint null,
  constraint bing_wallpaper_data_pkey primary key (enddate)
) TABLESPACE pg_default;
```

浏览量原子自增函数（`/api/view` 依赖；函数以调用者权限执行，因此表上仍需配置允许 `anon` 角色 UPDATE 的 RLS 策略）：

```sql
create or replace function public.increment_wallpaper_views(p_enddate text)
returns table(views bigint)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with upd as (
    update public.bing_wallpaper_data
       set views = coalesce(bing_wallpaper_data.views, 0) + 1
     where enddate = p_enddate
    returning bing_wallpaper_data.views
  )
  select upd.views from upd;
end;
$$;
```

## CORS 与错误处理

- 所有 API 响应（含错误响应）均附带：`Access-Control-Allow-Origin: *`，允许方法 `GET, POST, OPTIONS`，预检缓存 86400 秒，并设置 `Cache-Control: private, no-store` 禁止缓存
- `OPTIONS` 预检请求直接返回 `204`
- 参数或数据库错误返回 `400`，记录不存在返回 `404`，上游 Bing 接口异常返回 `500`
- SSR 处理异常返回 `500` 与 `{ error, message, context }`，便于定位出错环节

## 技术栈

- Cloudflare Workers（Fetch 处理器 + Scheduled Cron 处理器 + Static Assets）
- WebStudio（SSG 站点构建）
- Viewer.js（图片查看器）
- Supabase（PostgreSQL）+ @supabase/supabase-js

## 许可证

MIT License

Copyright (c) 2026 mcyin
