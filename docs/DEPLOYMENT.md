# 兵锋未至静态网页发布

网页版使用 `npm.cmd run build` 生成 `dist/`。将 `dist/` 内的文件按原结构放到静态站点目录。根路径或以 `/` 结尾的子目录都可用，例如 `/releases/nine-kingdoms/`。入口、图像、音效和许可一起发布。静态主机应为 HTML、JavaScript、CSS、WebP、PNG 和 Ogg 提供对应的内容类型。

## 构建交付包

准备 Node.js 20.12 或更新版本、npm 及 Python 3.9 或更新版本。在游戏目录执行以下命令。

```powershell
npm.cmd ci
python tools/package-release.py
```

命令重新构建静态版和单文件试玩版，并把三份 ZIP 与 `release.json` 保存到 `build/releases/` 下。清单记录游戏构建版本、文件数、字节数和各包 SHA-256。

| 文件名末尾 | 用途 |
| --- | --- |
| `offline-playtest.zip` | 解压后直接打开 `Nine Kingdoms.html` |
| `static-release-candidate.zip` | 发布其中的 `dist/`，保留包内两份操作说明供交接 |
| `source.zip` | 从 `before-the-onslaught/` 安装锁定依赖、复现构建、运行测试或继续开发 |

交付目录包含构建版本与清单指纹。相同文件内容会复用已有交付目录。只修改文档时仍保留游戏构建版本，并生成含新说明的交付目录。保留上一份目录可供回滚对照。

## 首次发布与更新

| 请求路径 | 缓存设置 |
| --- | --- |
| 目录首页、`index.html`、`crest.png` 和 `licenses/` | `Cache-Control: no-cache`，需要重新校验的响应应提供内容版本对应的 `ETag` 或 `Last-Modified` |
| `assets/` 中文件名带构建哈希的 JavaScript、样式及媒体 | `Cache-Control: public, max-age=31536000, immutable` |

对 HTML、JavaScript 和 CSS 启用压缩传输。最终地址的首次加载记录应包含响应编码、冷缓存入口时间、菜单图像、战场底图及主图集就绪时间。可先用本机慢网对照脚本复现采样。 [量测方法](PERFORMANCE.md#战场引擎独立加载)

先上传新版本的哈希资源，再替换 `index.html` 并使入口缓存重新校验。保留上一版的哈希资源，让更新时仍开着的旧页面能够加载其引用，包括独立加载的 `assets/phaser-core-*.js`。发布前保存旧包，也为需要跨设备或网址迁移的玩家保留游戏内「进度备份」入口。 [玩家进度迁移说明](PLAYTEST.md#换设备或试玩包时迁移进度)

同一浏览器使用同一协议、主机和端口时，可在更新后从原来的本地检查点继续。迁移到另一来源时，可在支持「进度备份」的版本先从原地址导出进度，再到新地址导入。当前 v14 构建可继续 v13 及更早的受支持存档。计划回退至 v13 时，请保留更新前由 v13 生成的备份。

## 本机排练

准备一个真实的上一版 `dist/` 目录。现存的阵势版压缩包可以直接用作对照。

```powershell
npm.cmd run build
Expand-Archive -LiteralPath 'build/nine-kingdoms-0.1.0-formation-playtest.zip' -DestinationPath 'build/static-release-rehearsal-prior'
npm.cmd run test:browser:release -- build/static-release-rehearsal-prior/dist
```

脚本在本机环回地址以相同子路径先后提供两个构建。它会在旧版完成第一波并停在战利品，切换到新版本后检查入口重新校验、旧资源仍可读取、战利品选择及第二波恢复。后续可用同样支持帧率、阵势和战利品流程的构建目录复测。

## 托管地址验收

首发时，用准备发布的同一份 `dist/` 核对托管地址。替换示例域名，保留目录 URL 的末尾斜线。

```powershell
npm.cmd run test:browser:release -- '--inspect=https://example.com/nine-kingdoms/'
```

检查会请求目录入口、`index.html`、全部图像、脚本、样式、音效与许可文件，核对 MIME 类型和解压后的文件内容。允许 `index.html` 重定向回同一个目录入口。检查还会请求可变文件的 304 条件响应，核对哈希文件的公开长期缓存以及 JS/CSS 的 gzip 或 Brotli 响应。检查只读，发现缺失、文件不匹配或错误响应头时会报出对应 URL。

需要验收真实更新时，先让目标环境提供上一版，准备其实际 `dist/` 目录。用待发布版本在本地生成新的 `dist/`，运行同一脚本的更新模式。

```powershell
npm.cmd run test:browser:release -- build/static-release-rehearsal-prior/dist '--url=https://example.com/nine-kingdoms/'
```

脚本先在独立浏览器中打完旧版第一波。出现等待更新的提示后，由发布方在原地址切换构建。脚本最多等待十分钟，不负责上传或清缓存。检测到新版后会核对原入口验证器能收到新版，所有上一版独有的哈希文件仍可读取，并在同一个浏览器从旧版战利品继续到第二波。已有玩家的浏览器数据不会受此次验收影响。

在最终托管地址记录冷缓存加载时间，并在实际目标设备上验证浏览器运行。 [首次加载量测方法](PERFORMANCE.md#战场引擎独立加载) · [测试与验收计划](../TEST_PLAN.md)
