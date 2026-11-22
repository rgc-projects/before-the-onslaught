# Nine Kingdoms 验收报告

基线日期为 2026-11-20。交付包含可重玩的六波「灰旗远征」、三波教学「鸦渡防线」、本地源码与资产。目标环境是 Windows 桌面浏览器。初次安装使用锁文件，已在独立空目录用 Node.js 20.12.0 和 npm 10.9.3 从本机缓存安装、构建、启动开发服务器，并收到游戏入口 HTTP 200。

## 对照原始任务书

| 原始范围 | 游戏实现与验收证据 |
| --- | --- |
| 一、游戏定位 | 实际通过部署军令、资源取舍、自动防守、掉落选择与 Boss 战完成远征。新版走过短局正负结算和五个王国的六波胜利。 |
| 二、技术要求 | TypeScript、Phaser 3、Vite、HTML/CSS、本地 JSON、Vitest。`src/core/` 与 `src/systems/` 独立于表现层。Windows 上启动与构建，HTTP 运行不请求远端资源。备战与奖励可存取，选项和功勋独立保存。 |
| 3.1 王国地图 | 网格、城堡、路线、桥梁、占地及拆墙。粮栈占两格，跨波解锁两个外营，祭坛限灵脉。规则测试和 Edge 检查了非法重叠、封锁绕行及解锁续玩。 |
| 3.2 卡牌构筑 | 40 张军令，六类与四级稀有度。战术牌抽取、洗牌、消耗和整理，事件、采购、强化、移除及传承由数据和规则驱动。战后有三选一奖励。 |
| 3.3 建筑 | 16 种建筑均可获取、部署和升级。仓库扩储、市场邻接收益、科技、英雄厅、月环祭坛占卜与法塔协同均参与真实结算。 |
| 3.4 兵种 | 12 种友军，涵盖破甲、先手远射、突击、范围、维持恢复、召唤和重装护卫。招募受占地、相邻设施、军粮限制。相同目标的受控测试比较出阵成本与作用。 |
| 3.5 自动战斗 | 目标、路径、射程与冷却、投射物、溅射、护甲、拦截、反击及伤亡由固定步长规则结算。断桥元帅半血能力经过单次触发测试。移动、受击、伤亡和法术的视听反馈已检查。 |
| 3.6 敌人与波次 | 8 种敌人，从步兵与弓手进攻过渡到骑兵、法师、巨兽、精锐与 Boss。三种桥位同时对应敌军换阵。五国实跑末波均击退整局 74 名敌军。 |
| 3.7 经济 | 金币、食物、木材、魔力都参与产出、消费和上限。用相同金币部署农圃或卫士的规则测试覆盖早期战力与长期军粮的取舍。 |
| 3.8 Roguelike | 种子决定桥位、敌军换阵、战利品、沿途事件和第 4 波的备选遗物。局内可升级建筑、强化与移除战术牌、获得遗物及研究科技。远征胜负发放功勋，解锁开局卡牌、带远射能力的潮汐王国和可重选战利品的占卜传承。 |
| 四、王国流派 | 钢铁壁垒还击、奥术法塔、自然供给、战争机动、潮汐远射均有独有军令和效果。五国通关可重放，潮汐回归从已解锁的功勋记录开始。 |
| 五、卡牌协同 | 栅墙与工事火力、临水农圃与市场仓库、灵脉祭坛、营地和英雄厅、神殿加成与辅助部队。对照种子、逐波记录和规则测试见 [远征数值抽样](BALANCE_BASELINE.md)。 |
| 六、视觉美术 | 原创 47 枚像素精灵统一建筑、单位、卡牌和图鉴。UI 分辨王国、稀有度和范围，地形渲染含桥梁、路径和灵脉。本地音效及许可见 [素材清单](../assets/manifest.json) 和 [第三方声明](../THIRD_PARTY_NOTICES.md)。 |
| 七、UI 与交互 | 主菜单、继续、图鉴、设置、退出；资源栏、左侧波次与敌军编成、中央网格、底部建造快捷入口、右侧单位和建筑详情、商店、事件、战利品、暂停与胜负。鼠标、热键和奖励焦点已验证。 |
| 八、音效与动画 | 点击、选牌、放置、升级、攻击、死亡、开战、胜利和 Boss 提示接入音频。建筑、单位、投射物、法术与卡牌动效可随三档设置调整。 |
| 九、平衡性 | 24 种子、五国、六策略、720 局；可输出逐波清波、军粮及城堡损伤。主要数值和特殊能力参数使用 [本地配置](../src/data/tuning.json)。开发沙盒隔离正式存档、功勋和设置。 |
| 十、测试 | 9 个文件、51 项规则测试覆盖军令与经济、战斗、内容与存档。Edge 另验收主流程、全部王国、占卜读档、局外解锁、坏档恢复、生产包资源、暂停与分辨率。 |
| 十一、分工与接口 | 模块职责与数据边界记录在 [系统接口](SYSTEM_INTERFACES.md) 和 [技术设计](../TECH_DESIGN.md)。阶段进度、决策、规则实现和最终集成由本次 Codex 会话维护。 |
| 十二、分阶段验收 | 见 [路线图](../ROADMAP.md)、[教学验收](PHASE_1_REPORT.md)、[远征验收](PHASE_2_REPORT.md) 及 [美术验收](PHASE_4_REPORT.md)。 |
| 十四、执行原则 | 源码包含实际规则与接口，可走完整循环。资源采用本地原创或明确许可，全部阶段保留验收记录，可按固定种子复现。 |

## 实测命令与战局

| 命令 | 验收项 |
| --- | --- |
| `npm.cmd ci` | 以锁文件安装依赖。独立空目录复测使用 `--offline --cache` 读取现有缓存。 |
| `npm.cmd run dev` | 本地服务器可启动并返回游戏入口。 |
| `npm.cmd run build` | 类型检查与生产构建。 |
| `npm.cmd test` | 51 / 51 通过。 |
| `npm.cmd run test:browser` | 三波教学胜负、暂停恢复、音效与动效、图鉴、战术、检查点和本地资源。 |
| `npm.cmd run test:browser:march` | 正常界面的远征成长、商店、事件、遗物、整理牌组、Boss 与功勋。交付版记录约 90.4 秒战斗，各波帧间隔 P95 为 6.3 毫秒。 |
| `npm.cmd run test:browser:kingdoms` | 五个王国的实时六波胜局、三列界面和窄屏祭坛占卜。 |
| `npm.cmd run test:browser:sandbox` | 调试隔离、主副档恢复、生产包入口和静止画布失效条件。 |
| `npm.cmd run balance` | 两组 12 个种子执行六种策略，每种策略覆盖五国。详细复现参数见 [远征数值抽样](BALANCE_BASELINE.md)。 |
| `npm.cmd run docs:content` | 生成 [40 张军令、16 种建筑和 20 种单位的数据表](CONTENT_TABLES.md)。 |

| 王国 | 种子 | 构筑 | 城堡生命 | 击退敌人 |
| --- | ---: | --- | ---: | ---: |
| 钢铁 | 119 | 反击阵列 | 30 / 30 | 74 |
| 奥术 | 0 | 祭坛法塔 | 30 / 30 | 74 |
| 自然 | 109 | 军队扩编 | 30 / 30 | 74 |
| 战争 | 197 | 军队扩编 | 16 / 30 | 74 |
| 潮汐 | 322 | 军队扩编 | 3 / 30 | 74 |

## 最终交付物

| 任务书条目 | 项目内位置 |
| --- | --- |
| 1. 完整游戏源代码 | `src/`、`index.html`、`vite.config.ts`、`package.json`、`package-lock.json` |
| 2. 可启动项目 | 项目根目录，静态构建生成至 `dist/` |
| 3. 本地素材 | [素材清单](../assets/manifest.json)，含图集、音效及授权 |
| 4. README | [README.md](../README.md) |
| 5. 游戏启动说明 | [启动与检查](../README.md#启动与检查) |
| 6. 游戏操作说明 | [操作与种子示例](../README.md#启动与检查) |
| 7. 卡牌和建筑数据表 | [内容数据表](CONTENT_TABLES.md) |
| 8. 自动化测试 | `tests/` 及本报告复验命令 |
| 9. 测试报告 | 本文件及 [性能采样](PERFORMANCE.md) |
| 10. 已知问题 | 见下节 |
| 11. 游戏截图 | [栅墙反击编成](screenshots/release-rampart.png)、[祭坛战利品](screenshots/release-divination.png)、[Boss 战](screenshots/release-marshal.png)、[潮汐压线胜利](screenshots/release-tide.png) |
| 12. 后续开发建议 | 见末节 |

## 已知问题与验证范围

- 原驻军和邻接驻军在当前固定策略中胜局很少。战争与潮汐的军队路线对种子较敏感。抽样结论来自可复现的固定操作，尚无外部玩家样本。
- 键盘领奖构建的静态入口脚本为 185.43 kB，gzip 后为 74.50 kB。Phaser 独立文件为 657.48 kB，gzip 后为 157.96 kB，仍触发 Vite 的 500 kB 压缩前提示。此前拆分引擎的慢网对照中主菜单更早出现，战场底图首次绘制推迟。 [首次加载对照](PERFORMANCE.md#战场引擎独立加载)
- Windows 台式机上的 Edge、Firefox、Chrome 均已通过生产包六波胜局。Chrome 另通过六波失守流程与窄屏战报检查。Edge 独立窗口已验证切标签和最小化恢复。其他实际硬件尚未验证。Safari 和触屏需与最终支持范围一并评估。台式机帧与 JS 堆记录见 [性能采样](PERFORMANCE.md)。
- 存档跟随当前浏览器来源。战斗中刷新或退出会回到本波备战检查点；跨浏览器同步与战斗中间帧快照未提供。

## 后续开发建议

1. 邀请首次接触游戏的玩家盲测第二、五、六波。分别记录玩家选牌、军粮短缺、对战败原因的理解及流派尝试，优先改善驻军与战争机动路线。
2. 在实际低配 Windows 设备上检查完整远征和切后台，针对最终首发环境复查缓存与首开体积。如果扩大首发范围，再验证 Safari 与触控设备。
3. 扩展敌军路线、事件遗物和高难挑战时，用现有数据表和种子回归报告对照现有构筑强度。

## 本地试玩包

0.1.0 试玩包为 `build/nine-kingdoms-0.1.0-playtest.zip`，917,922 字节，SHA-256 为 `4ECE84019C71F6D3C9C530BEFA9313BF7D55A03432E0EF9440A168420D8C59A5`。包含生产构建、随包许可证及 [试玩说明](PLAYTEST.md)。13 个文件的压缩完整性和内容均已验证，Windows 上从解压目录按说明启动后，入口、脚本、样式、图标和许可均可通过本机 HTTP 访问。

```powershell
npm.cmd run build
New-Item -ItemType Directory -Path build -Force | Out-Null
Compress-Archive -LiteralPath @('dist', 'docs/PLAYTEST.md') -DestinationPath 'build/nine-kingdoms-0.1.0-playtest.zip'
```

重新打包时使用新的归档文件名，并记录对应校验值与本轮验收结果。

备战调整版为 `build/nine-kingdoms-0.1.0-layout-playtest.zip`，919,444 字节，SHA-256 为 `D0166DD64125227B6FC182F09159B0238D3EE060B9A83634DFB9F111D0AFE1C7`。13 个文件的压缩完整性及与生产构建、试玩说明的内容一致性均已验证。Edge 从同一生产构建完成放置、迁移、刷新和拆除操作。

元帅动作版为 `build/nine-kingdoms-0.1.0-marshal-playtest.zip`，976,989 字节，SHA-256 为 `405C7DBDD43FF1F60993EC217DF0FA34263C3600A3A47E73B6E585913BC382C8`。已校验全部 14 个文件及压缩包完整性。实战生产包验证覆盖十二帧元帅动作、新半血提示和六波结算。[反击实战截图](screenshots/marshal-counter.png)

军粮分配版为 `build/nine-kingdoms-0.1.0-supply-playtest.zip`，978,120 字节，SHA-256 为 `902F9AF2FA92173257E97DDB5C53B7750D3D418AB7C89DC2DD091EC7392873CC`。已校验全部 14 个文件及压缩包完整性。新版包含军粮分配、跨波次优先设置和 v11 检查点。

前后台修正版为 `build/nine-kingdoms-0.1.0-focus-playtest.zip`，978,294 字节，SHA-256 为 `796AF9CA5F01857ED983C4F33121B9AF04355C833917047D21882FA33F6DF6DC`。已校验全部 14 个文件及压缩包完整性。Edge 独立窗口验证，战斗在切标签和最小化时停住，恢复从下一步开始。

绘制优化版为 `build/nine-kingdoms-0.1.0-performance-playtest.zip`，978,380 字节，SHA-256 为 `59D991C864FA77DB3D170D2BADBE43062388543F1715A836419DB8D5AC54B6DE`。14 个文件已逐字节校验。包含直接画布绘制和战况增量更新。[第五波优化采样](PERFORMANCE.md#第五波绘制与界面优化)

渡口布防版为 `build/nine-kingdoms-0.1.0-bridge-playtest.zip`，978,758 字节，SHA-256 为 `3B94150568C53542D33A6DE533F15C4C64B2D2B6244B4456BC50714091524600`。14 个文件的压缩完整性及与构建、试玩说明的内容一致性均已校验。Edge 157 通过作战简报、布阵预览、教学和生产包六波复测。钢铁王国种子 119 保留 30 点城堡生命并击退 74 名敌军。[窄窗简报](screenshots/bridge-coverage-narrow.png)

后期补给版为 `build/nine-kingdoms-0.1.0-provisions-playtest.zip`，978,966 字节，SHA-256 为 `1784969ABFB1EEF4F109723313F32EAF918E2585C4BE5FA1F8040260DEBB9A2A`。14 个文件均已核对内容和压缩完整性。Edge 的窄窗商店采购、刷新和战争王国种子 42 的六波通关已实测。[窄窗商店](screenshots/farm-order-narrow.png) · [后期补给对照](BALANCE_BASELINE.md#驻军后期补给对照)

阵势版为 `build/nine-kingdoms-0.1.0-formation-playtest.zip`，979,640 字节，SHA-256 为 `E146680AA0EC1E9D77628BDD6908EA5B9A549912B3EC2E9EE2D8BD575202CFC3`。14 个文件均已核对内容和压缩完整性。Edge 通过部署漏点修复和阵势实测。战争王国种子 119 从第 5 波起收缩内线，六波通关时剩 24 城堡生命。[内线截图](screenshots/formation-inner.png) · [阵势对照](BALANCE_BASELINE.md#第五波守军阵势对照)

双击离线版为 `build/nine-kingdoms-0.1.0-offline-playtest.zip`，982,532 字节，SHA-256 为 `7DC8B580E4BF47B8179828CBCC4F296970CBBF86D759056F495B049C895CD23F`。包内只有 2,409,817 字节的 `Nine Kingdoms.html` 和试玩说明，两份文件均校验压缩完整性及与原文件的内容一致性。HTML 内置 Phaser、EventEmitter3 和 Kenney 音效的许可证文本。Edge 与 Firefox 断网完成六波通关、播放两种音效，并从解压路径重启恢复存档。[试玩说明](PLAYTEST.md) · [离线验收](../TEST_PLAN.md#当前执行记录)

黑旗精锐动作版为 `build/nine-kingdoms-0.1.0-captain-offline-playtest.zip`，995,946 字节，SHA-256 为 `BF3B38CEC51EB810C2122FCB11C7D737D6A1ED1CF223C1ACDB76EB6E74210F71`。两份文件均已检查压缩完整性和内容。离线 HTML 内置新动作图集，Edge 在 120 FPS 档完成第 5 波动画验收和六波通关。[实战截图](screenshots/captain-strike.png)

绘制优化离线版为 `build/nine-kingdoms-0.1.0-render-offline-playtest.zip`，996,249 字节，SHA-256 为 `A2152F7D95534AA5101B6D46E66A1EB3C165186F519C9604137FDBB8EFBA117A`。HTML 和试玩说明已逐字节核验。离线 Edge 在 120 FPS 档完成六波胜局与战斗数字显示检查。[采样记录](PERFORMANCE.md#战斗数字绘制缓存)

进度备份离线版为 `build/nine-kingdoms-0.1.0-progress-offline-playtest.zip`，997,884 字节，SHA-256 为 `B224316DD5A022CAA0ED132420C0F18C2D4FC37C51E7B3465D4A14209F99D9A2`。HTML 和试玩说明均已核对内容和压缩完整性。Edge 与 Firefox 通过迁移进度、刷新和窄窗验收。[迁移步骤](PLAYTEST.md#换设备或试玩包时迁移进度)

城堡损伤战报离线版为 `build/nine-kingdoms-0.1.0-wave-review-offline-playtest.zip`，998,506 字节，SHA-256 为 `B9DCCC6AE764C277F763F9DF6F716C66A95A4CF83DBE3A6A3F454C5719C25B8E`。两份文件已确认压缩完整性和内容一致。Edge 断网验证窄窗失守明细，Firefox 断网验证含分项的战利品检查点刷新及六波通关。[失守战报截图](screenshots/wave-review-damage-narrow.png)

敌军简报离线版为 `build/nine-kingdoms-0.1.0-enemy-briefing-offline-playtest.zip`，999,214 字节，SHA-256 为 `1313669C21F46B5ECF020CD0672B6FC56C2ED90004CC0D3EE8B2A7D761DF6B8C`。压缩包内的 HTML 和试玩说明均通过 CRC 校验，与原文件逐字节一致。Edge 断网验证换阵后的敌军数量和首次入场时间，以及第 5、6 波简报和失守结算。Firefox 断网验证第 5、6 波简报和通关。[窄窗简报截图](screenshots/enemy-briefing-narrow.png)

出阵位预览离线版为 `build/nine-kingdoms-0.1.0-muster-preview-offline-playtest.zip`，999,969 字节，SHA-256 为 `77D906DF43CF36E222B895D44800B47B705474B8BF287E77A2B91237C613B199`。包内 HTML 和试玩说明通过 CRC 与逐字节校验。Edge 断网验证受阻营地定位、迁移预览、刷新和六波通关。[窄窗营地列表](screenshots/muster-blocked-narrow.png)

## 静态发布候选包

`build/nine-kingdoms-0.1.0-static-release-candidate.zip` 含当前静态构建、部署说明和试玩说明，共 16 个文件，均通过压缩包 CRC 和逐字节比对。压缩包为 998,419 字节，SHA-256 为 `F7A9A056691868BC66C774B8E9AFDCA03A018DA0874352C66EA65AB4EE16E300`。

在本机相同 URL 上从阵势版替换成当前构建，Edge、Chrome 和 Firefox 验证了入口重新校验、旧哈希资源保留、旧战利品恢复、第二波续玩以及 v12 到 v13 的存档升级。首发托管环境的部署和缓存验收待执行。[部署与复现步骤](DEPLOYMENT.md) · [更新后截图](screenshots/release-update.png)

## Canvas 生产包

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-canvas-static-release-candidate.zip` | 16 | 816,431 | `439D28300C9750B7D74832C3F4C38A2B81AFF8C16B4EA571F14E44385CAE97E2` |
| `build/nine-kingdoms-0.1.0-canvas-offline-playtest.zip` | 2 | 817,768 | `DEE3CBFFF8D18FEFC2A02E04CBB00535710D4B34DA79BA005E2DF72F96D66400` |

两包通过 CRC 校验，全部文件与当前构建和说明逐字节一致。部署步骤沿用静态发布说明。 [体积及运行对照](PERFORMANCE.md#phaser-canvas-生产包)

## 占卜传承构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-charter-static-release-candidate.zip` | 16 | 816,775 | `47FDD9E5F0E6E4AD6CF2075E434581F13AF7B85163FEC5BDEC8F72F305A5BD14` |
| `build/nine-kingdoms-0.1.0-charter-offline-playtest.zip` | 2 | 818,120 | `C1EE3DB459A26052CA5BE1DB0DBF5A09FD4A691A8610774EA976516E62F771FD` |

两包通过 CRC 和逐字节核验。Edge、Firefox 完成从 8 功勋到 9 功勋、解锁传承、实际重选战利品及刷新续玩。占卜传承的检查点需由支持该传承的版本读取。[远征纪事截图](screenshots/chronicle-charter.png)

## 遗物交易构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-relic-trade-static-release-candidate.zip` | 16 | 817,027 | `6A4EE043910E994EFE55207DBB4D40013E5D8371951FC6ABC7B202F43567F6A3` |
| `build/nine-kingdoms-0.1.0-relic-trade-offline-playtest.zip` | 2 | 818,373 | `7EE3BADBAB552E6C2C58F8407E58731AC61A91D9D1650440D8199F9B707BF6E4` |

两包通过 CRC 和逐字节核验。Edge 和 Firefox 验证离线遗物交易后刷新，并从原战局完成远征。 [备选遗物截图](screenshots/relic-trade-narrow.png) · [两组模拟对照](BALANCE_BASELINE.md#第四波遗物交易对照)

## 支援动作构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-support-motion-static-release-candidate.zip` | 16 | 817,403 | `4E3759C2931B9E1873D31029D000C8CF5EFCE964560D9EBAE97EBA4AB2EF73E5` |
| `build/nine-kingdoms-0.1.0-support-motion-offline-playtest.zip` | 2 | 818,801 | `272F28E2112FDD44EC476EA3A13683428B227D9A5B946D0F03C9A4846A5E22E7` |

两包通过 CRC 和逐字节核验。89 项单元与集成测试、静态与离线构建、720 局固定策略对照通过。Edge 与 Firefox 实测不同帧率和动效档的支援动作及相同结算。Edge 从此离线版本重放战争王国种子 119，六波告捷，城堡剩 24 生命并击退 74 名敌军。[施法截图](screenshots/support-cast.png) · [浏览器测试记录](../TEST_PLAN.md#当前执行记录)

## 教学与远征引导构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-onboarding-static-release-candidate.zip` | 16 | 814,473 | `92E7B9AA6239C4FF3CFF4444FC31AF2E9AA5F545D72D16446224613D0CBE2715` |
| `build/nine-kingdoms-0.1.0-onboarding-offline-playtest.zip` | 2 | 819,247 | `2769C783F4CF73AB8630F916A18AD77633C8AC84E33324B7F1F24F2364372F2D` |

两个压缩包通过 CRC 和逐字节核验。Edge 实测教学胜负、远征选国和渡口提示，Firefox 断网通关教学后进入远征并保存新战局。Edge 静态同址更新通过旧资源校验和 v12 至 v13 存档迁移，保留设置并继续至第 2 波。[教学结算](screenshots/tutorial-victory-narrow.png) · [远征选国](screenshots/tutorial-expedition-narrow.png) · [实战渡口提示](screenshots/expedition-crossing-hint.png)

## 教学入场节奏构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-tutorial-pacing-static-release-candidate.zip` | 16 | 814,521 | `8D50146B97DE2D493D330D791FFF7EA0E4DEFFAE1188A25E02C11B6557380F7A` |
| `build/nine-kingdoms-0.1.0-tutorial-pacing-offline-playtest.zip` | 2 | 819,292 | `D2A5E5B75A382CC6EB6CF5514FAFB216172801153674854A4E2CB71A2D525570` |

两个压缩包通过 CRC 和逐字节核验。Edge 实测双桥方案满生命通关、空防失守和重开。Firefox 从断网 HTML 实玩城堡附近方案，验证损伤、修复与三波通关。90 项规则测试与 720 局固定策略远征回归通过。[教学数值对照](BALANCE_BASELINE.md#三波教学入场节奏) · [修复提示](screenshots/tutorial-repair.png)

## 矛兵拦截构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-spearman-reach-static-release-candidate.zip` | 16 | 814,551 | `3649973B94BA0B77E66EB7FBC70972E843A17E0D017CF577957D0255CEAC28C2` |
| `build/nine-kingdoms-0.1.0-spearman-reach-offline-playtest.zip` | 2 | 819,319 | `7D2311D208EF11501D45E71865847871B43028F739E65DD33CAED39583FF8972` |

两个压缩包通过 CRC 和逐字节核验。91 项规则测试和两类构建通过。Edge、Firefox 离线重放自然王国种子 109 的驻军六波，均击退 74 名敌军并剩 15 城堡生命。Edge 另复验战争 119 的兵营优先分粮胜局。[固定种子对照](BALANCE_BASELINE.md#矛兵斜向拦截对照) · [驻军胜局](screenshots/spearman-garrison-victory.png)

## 存档替换保护构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-checkpoint-guard-static-release-candidate.zip` | 16 | 815,154 | `EE05AFD6EC6F4BEA381D27214B7E696C38F53BF4A501FD2E70E43EDC9E6BE3AD` |
| `build/nine-kingdoms-0.1.0-checkpoint-guard-offline-playtest.zip` | 2 | 819,914 | `FEC002DB2FBFECB6B85F8637CECD005684D46B27E1B250EE9D77230B903E8A87` |

两个压缩包通过 CRC 和逐字节核验。Edge 和 Firefox 在离线包实测取消、多标签页存档变更重新确认、写入失败重试及刷新续玩。Edge 还重跑三波教学、六波远征和沙盒隔离。静态包同址更新回归保留旧设置和检查点，迁移至 v13 后继续第 2 波。[替换战局截图](screenshots/replace-run.png)

## 共享军令图集构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-shared-atlas-static-release-candidate.zip` | 16 | 815,195 | `53AC52D0EA1DCE95B74E1963C380D351485FBF3CD593C7B8D5FA82145EC359DD` |
| `build/nine-kingdoms-0.1.0-shared-atlas-offline-playtest.zip` | 2 | 819,967 | `8C5C09692D81EFF91D6EBB14E0929D7A253A71D57CF85420E16D1C7ECF6A4D81` |

两个压缩包通过 CRC 和逐字节核验。Edge 断网对照 13 张军令的截图像素一致，开局同步处理耗时中位数由 453 降到 91 毫秒。模拟 CPU 降速 8 倍时完成钢铁王国六波。Edge 和 Firefox 通过离线手牌与存档回归，静态包同址更新回归验证旧档和旧资源。[实测记录](PERFORMANCE.md#军令图集共享样式)

## 远征种子构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-expedition-seeds-static-release-candidate.zip` | 16 | 815,702 | `31AFBD2EF6FBD62090C231C6E05994E714FE5715B02B59988A364662F144B36B` |
| `build/nine-kingdoms-0.1.0-expedition-seeds-offline-playtest.zip` | 2 | 820,487 | `81C2DDBEA9D20F93929C95E713D45C6AE042C353B5C1A5A6FB8F07E7CF02B9FD` |

两个压缩包通过 CRC 和逐字节核验。91 项规则测试与两类构建通过。Edge 与 Firefox 核对离线随机开局、战局地图与预览对应、失守后带着原王国进入新种子设置。Edge 完成六波胜利再出征、潮汐与占卜保留、三波教学和静态同址旧档续玩。[随机种子与路线截图](screenshots/random-expedition.png)

## 战术牌分布构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-tactic-piles-static-release-candidate.zip` | 16 | 816,174 | `9C80223B2FEB637CAE246F67CAB0681BA8CAC36FF9A11DE9AAF7630D34D878BE` |
| `build/nine-kingdoms-0.1.0-tactic-piles-offline-playtest.zip` | 2 | 820,964 | `9925D2382F6D692F7F1B6F7BB914AFF4EEAC8FE3846EED93D47772DD68596C01` |

两个压缩包通过 CRC 和逐字节核验。92 项规则测试及两类构建通过。Edge 和 Firefox 断网验证对实际弃牌强化、移除和读档，窄窗保留返回部署入口。Edge 在六波完整远征中验证首波只读查看、第 5 波整理和最终通关。720 局回归和静态旧档更新通过。[战术牌分布截图](screenshots/tactic-piles.png)

## 行军路线预览构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-approach-preview-static-release-candidate.zip` | 16 | 816,787 | `D0A74669B38A46CE29BC7DFB87700E2D3BE3FF7238AE5CB082F361ED6B6AA113` |
| `build/nine-kingdoms-0.1.0-approach-preview-offline-playtest.zip` | 2 | 821,598 | `B427CB5C59438CD2F2214D4BA16C21E56738CBAF8F3CBBC5D49DD6874C1C4AF7` |

两个压缩包通过 CRC 和逐字节核验。93 项规则测试及两类构建通过。Edge 和 Firefox 断网验证改道、破障、键盘迁移、取消和刷新，实际战斗中的首次建筑伤害符合预览。Edge 三波教学及静态旧档更新通过，720 局固定策略的全部汇总与基线一致。[破障预览截图](screenshots/route-breach-preview.png)

## 功勋保存重试构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-merit-retry-static-release-candidate.zip` | 16 | 816,555 | `A92725B3235FE8A29C66048150E4223C62AB9EB300F49F62FF0DBBA053B94130` |
| `build/nine-kingdoms-0.1.0-merit-retry-offline-playtest.zip` | 2 | 821,389 | `86681475684B224DFAD069C5882FF02BFD9BAD46F6A4C5120F1AF6C93F9FB191` |

旧离线包在浏览器拒写功勋时会删除主、备用检查点。修复后的 Edge 158 和 Firefox 142 断网回归验证两份原档保留、同地址续玩、恢复写入后只发放一次功勋，以及旧局结算保留另一标签页新开的战局。93 项规则测试、两类构建和 Edge 本机 v12 至 v13 同址更新通过。两个压缩包通过 CRC 和逐字节核验。[重试截图](screenshots/merit-retry.png)

Edge 158 使用最终离线构建，以钢铁王国种子 119 完成六波远征。结算击退 74 名敌军，城堡保留 30 生命，已结算战局的检查点清除。`npm.cmd run test:browser:march` 同时核对六波胜利发放 3 功勋、解锁仓储许可，并在返回主菜单后读取远征纪事。

## 多标签页存档保护构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-checkpoint-guard-static-release-candidate.zip` | 16 | 816,852 | `4FEC3E57A4491103F7A6B150111DDEB9AF47469C3C640A548777BBAE79190809` |
| `build/nine-kingdoms-0.1.0-checkpoint-guard-offline-playtest.zip` | 2 | 821,620 | `94FB741B2E2CCD09AA49EFB74E97B82700664DEAF637550CAD47BDB471C9873D` |

旧离线包在两页续玩同一远征时，旧页改阵势会覆盖另一页已部署的松岗箭塔及扣费。新版的 Edge 158 与 Firefox 142 离线回归验证由旧布阵命令或战后战利品触发的写入均保留较新的两份检查点，重新继续后可再次保存。93 项规则测试、两类构建、Edge 坏档恢复和同址 v12 至 v13 更新通过。两个压缩包通过 CRC 和逐字节核验。[提示截图](screenshots/stale-checkpoint.png)

Edge 使用该离线构建通过钢铁王国种子 119 的六波远征，击退 74 名敌军，城堡保留 30 生命。逐波保存、战利品选择及最终检查点清理通过。

## 出阵人数预览构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-supply-preview-static-release-candidate.zip` | 16 | 816,935 | `6436BA70F7059EB8554BD6A1DF60550CD67131255450C4AE68E0C6E0F5A01312` |
| `build/nine-kingdoms-0.1.0-supply-preview-offline-playtest.zip` | 2 | 821,682 | `2839F684B6517F1F91851B0F04E598415E2AE789A3B8201CC09AD118AB169265` |

96 项测试和静态、离线两类构建通过。Edge 和 Firefox 断网验证 390 像素宽窗口下悬停、键盘迁移、扣费和刷新，奥术种子 23 的第 6 波预览与确认后的备战人数均从 9 增至 10 支。两者六波通关时保留 30 城堡生命、击退 74 名敌军。Edge 教学与同址旧档更新通过，720 局固定策略的两张表共 38 行与基线一致。两个压缩包通过 CRC 和逐字节核验。[窄窗预览](screenshots/supply-preview-narrow.png)

## 掉帧反馈修复构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-animation-stall-static-release-candidate.zip` | 16 | 816,954 | `4A4A5F97DB4F17E4482228BEE7E63165D40D10F23CB362CCE60497262A288931` |
| `build/nine-kingdoms-0.1.0-animation-stall-offline-playtest.zip` | 2 | 821,685 | `565BED2C4C0240896B043A290BCE885EA5895A300BE525F31906AD8D86D47958` |

96 项自动化测试、两类构建及 Edge 教学回归通过。Edge 与 Firefox 的离线慢帧测试均绘制攻击开场，并保持相同战报和战利品。Edge 正常 120 FPS 档通过钢铁种子 119 六波远征及元帅十二张动作帧检查。压缩包通过 CRC 和逐字节核验。[性能记录](PERFORMANCE.md#掉帧后的战斗反馈) · [实际画布](screenshots/stalled-attack.png)

## 落点预览性能构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-placement-performance-static-release-candidate.zip` | 16 | 817,077 | `9DEC0272EAA443F7BCA67CAAAC3DDB67755B88EEF0FEEBBB209267F51B3B8462` |
| `build/nine-kingdoms-0.1.0-placement-performance-offline-playtest.zip` | 2 | 821,810 | `6E90771D9068C7BF639038851FD32FE0921D1CA069A0DD9CB7043912E0741ADA` |

96 项自动化测试和两类构建通过。Edge 用正常游戏界面验证同一落点部署前、被占用后、撤销后的三次预览，并通过教学与同址 v12 至 v13 更新。Firefox 断网核对键盘迁移、扣费、刷新和奥术种子 23 的六波胜利，击退 74 名敌军并保留 30 城堡生命。两版在模拟降速下逐格输出一致，耗时见性能记录。两个压缩包通过 CRC 和逐字节核验。[量测记录](PERFORMANCE.md#备战落点预览开销)

## 建筑实际产量构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-building-income-static-release-candidate.zip` | 16 | 817,147 | `43F5BA697E002F5A9FE0DD810F17AAD4883415D566C2FA5B041811501E73011D` |
| `build/nine-kingdoms-0.1.0-building-income-offline-playtest.zip` | 2 | 821,866 | `D22D5AB5A85ABDAFF0AE078AF83599E265E24C4F05BBB24C623B44E21D07B960` |

97 项自动化测试和两类构建通过。Edge 验证添加相邻法塔后，祭坛详情与总预报同步显示 3 魔力，并对照自然王国农圃迁移前后、升级和刷新。Edge 六波流程、静态同址升级和 Firefox 离线六波通关通过。720 局固定策略的两张表共 38 行与基线一致。两个包通过 CRC 和逐字节核验。[建筑详情截图](screenshots/farm-production.png)

## 开战修墙预览构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-wall-repair-route-static-release-candidate.zip` | 16 | 817,230 | `5218B0A37BFD258D9D1498769D145578A8ABAE7FC50CA6EF97BD549418F8CFCE` |
| `build/nine-kingdoms-0.1.0-wall-repair-route-offline-playtest.zip` | 2 | 821,959 | `BB6418803B0A10A7AF87248BC94C457F5FB5F9D722039FE160603E7AEF677F07` |

100 项自动化测试和两类构建通过。Edge 用有效检查点核对 8 耐久栅墙预告修至 16，放置农圃后标记南桥农圃为破障目标，实际第一次建筑损伤与预告一致。Edge 六波及同址旧档升级、Firefox 离线钢铁种子 119 六波胜利通过。720 局固定策略的 38 行汇总与基线一致。两个包通过 CRC 和逐字节核验。[备战截图](screenshots/repaired-breach.png)

## 战报下载构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-wave-report-static-release-candidate.zip` | 16 | 818,003 | `4A3A8E24E749913DB37EFCC6FB850827D7903E81C8812B5B7983469E6FBE7569` |
| `build/nine-kingdoms-0.1.0-wave-report-offline-playtest.zip` | 2 | 822,739 | `8BDA0C4C11E606EA845F6D614C1E54F19703A9649BCAE15164A64636C65B5B0F` |

100 项自动化测试和两类构建通过。Edge 和 Firefox 离线下载了失守和战利品战报，刷新后导出文本字节一致，主副档保持一致。Edge 钢铁种子 119 通关后实际下载第 6 波战报，并验证其中记录击退 74 名敌军。Edge 同址旧档升级通过，两个包通过 CRC 和逐字节核验。[窄窗下载入口](screenshots/wave-report-download.png) · [试玩反馈说明](PLAYTEST.md#反馈)

## 慢网菜单构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-menu-crest-static-release-candidate.zip` | 16 | 830,969 | `9223543A41EE7664F5590A7696D09303AAFAFFA5921A8CCAD49C9357B253670F` |
| `build/nine-kingdoms-0.1.0-menu-crest-offline-playtest.zip` | 2 | 835,639 | `41B474E9D971ACD630D6514A4F08572C7D83B8CC8E86616917AF46E93D21CCB7` |

100 项自动化测试和两类构建通过。Edge、Chrome、Firefox 在等待主图集时显示菜单城堡，完成同址缓存与 v13 奖励存档续玩。Firefox 单文件离线通关钢铁种子 119，击退 74 名敌军，城堡保留 30 生命。两个包通过 CRC 和逐字节核验。[慢网实测](PERFORMANCE.md#慢网下的主菜单显示)

## 战斗帧率采样构建

| 包 | 文件数 | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `build/nine-kingdoms-0.1.0-frame-sampling-static-release-candidate.zip` | 16 | 832,130 | `7415A78CCBE24407180A98B298D4DAA4BB66F2FB266ABC61B629F5B84F835506` |
| `build/nine-kingdoms-0.1.0-frame-sampling-offline-playtest.zip` | 2 | 836,790 | `64A7A411D50466ABEF6CF4DC6720370526E0E726861F2BB85328E7A3BBC0EFE0` |

102 项自动化测试和两类构建通过。Edge 和 Firefox 离线验证采样写入战报、排除手动暂停及设置保存，30 FPS 上限的实际绘制均为 30.0 FPS。Edge 通过 v13 同址续玩。Edge 离线 120 FPS 档完成钢铁种子 119 六波，平均绘制 119.8–120.1 FPS，保留 30 城堡生命，绘制元帅全部十二张动作帧。两个包通过 CRC 和逐字节核验。[设置截图](screenshots/frame-sampling.png) · [实机采样说明](PLAYTEST.md#实机性能采样)

## 远征阵势提示构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-formation-advice-offline-playtest.zip` | 836,957 | `C6DE3BEC93E4C158D33A4F06769D8A1550BC7F0232BA6CA460F476F257B22FA9` |
| `build/nine-kingdoms-0.1.0-formation-advice-static-release-candidate.zip` | 832,300 | `EC5FD6334567C120062FD3C164FEC0DB6B23F3BDC914EDC33029D181948010D1` |

102 项自动化测试、静态和离线构建通过。Edge 158 和 Firefox 142 在断网的 390 像素宽窗口检查第 2 至 5 波临战建议，用方向键切换阵势，检查阵线及切换后的提示，刷新恢复第 2 波的选择。两者随后完成钢铁种子 0 的六波驻军战局，城堡余 12 生命，累计击退 74 名敌军。Edge 同址 v13 更新后继续第 2 波。720 局默认策略的汇总表与基线逐行一致。两个包通过 CRC 和逐字节核验。[备战截图](screenshots/formation-advice-narrow.png) · [阵势对照](BALANCE_BASELINE.md#第二至第五波的守军阵势对照)

## 共享出阵格修复构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-muster-reassign-offline-playtest.zip` | 837,133 | `45A917EAA2DD35950668C48C01736084D1135274A95AE8D9199E66CEE421DC29` |
| `build/nine-kingdoms-0.1.0-muster-reassign-static-release-candidate.zip` | 832,466 | `5D3072E8B9D1B3D0453A10563EDF25F875891AFA73907CD52AE1E5D49D9A97DB` |

103 项自动化测试和两类构建通过。Edge 158 用旧离线包复现两支部队出阵和弓营受阻，用新版验证增加到三支。Firefox 142 用新版验证相同结果。两浏览器都在 390 像素宽窗口核对地图高亮、刷新续玩和战报。Edge 另通过六波远征与静态同址 v13 更新。两个压缩包通过 CRC 与逐字节核验。720 局各默认策略的通关数保持一致，两批逐波切换阵势的驻军样本也保留相同的通关局。[复现布局与样本](BALANCE_BASELINE.md#最终波出阵格分配) · [地图截图](screenshots/muster-reassign.png)

## 最终波入场节奏构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-boss-pacing-offline-playtest.zip` | 837,133 | `C7EC960506526A77DA4D10559933576AF7F13C6641E750B270839EF3C80223E4` |
| `build/nine-kingdoms-0.1.0-boss-pacing-static-release-candidate.zip` | 832,468 | `1877A5252FCC675060F80B78E1B7CF25E387F1F1E5A3BE21BCE0D2ED5AA56A6E` |

104 项自动化测试、离线和静态构建通过。Edge 158 与 Firefox 142 断网执行自然王国种子 11532。第 6 波在 390 像素窗口查看巨兽 11.5 秒入场，刷新恢复后核对元帅 3.3 秒入场，再以 16 城堡生命击退全局 74 名敌军。Edge 以钢铁种子 119 通关并绘制元帅的全部十二张动作，静态同址 v13 更新通过。两个包通过 CRC 和逐字节核验。[巨兽简报](screenshots/boss-ogre-pacing.png) · [固定策略对照](BALANCE_BASELINE.md#最终波巨兽入场节奏)

## 网页托管验收工具

现有最终波入场节奏构建用于此次验收。脚本核对入口及每个构建文件的解压内容、MIME、缓存和条件响应。新版上线时浏览器先在正常缓存下刷新，然后从原检查点继续。Edge 158、Firefox 142 的本机演练逐字节通过前后各 14 个文件和两个旧哈希资源的检查，并恢复到第 2 波。独立环回服务通过实际 URL 模式的 Last-Modified、gzip、目录入口重定向和续玩测试。它返回错误 MIME、缺少压缩或少一个旧资源时，脚本能定位失败文件。104 项规则测试通过。首发托管地址的实测仍待执行。 [部署与验收](DEPLOYMENT.md#托管地址验收)

## 整局战报构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-run-report-offline-playtest.zip` | 837,790 | `1B9CF3C24F098988D377DF9C9F64800DB33F831C208F01593E4AB8C7BBD1588B` |
| `build/nine-kingdoms-0.1.0-run-report-static-release-candidate.zip` | 833,730 | `B794ABE7AE245E3E07CC45AE5FBBFEF49E9A5514D08EEE5832E71E8409D009F8` |

105 项自动化测试、离线和静态构建通过。Edge 158、Firefox 142 用自然种子 11532 到达第 6 波，刷新后核对前五波的战报一致。结算在 390 像素宽下用键盘下载 UTF-8 整局文本，包含 1 至 6 波、五张领取的军令以及 16 城堡生命通关。Edge 另验证第一波失守导出、进度备份、单波帧率采样及同址更新 v13 至 v14 后续玩。720 局固定策略的 38 个汇总行与上一构建相同。两个包通过 CRC 和逐字节核验。 [结算截图](screenshots/run-report-download.png) · [反馈说明](PLAYTEST.md#反馈)

## 敌军寻路复用构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-route-cache-offline-playtest.zip` | 837,943 | `17C939DCCE3740CE9B46D01138CD8D6AF77EF1E25CA4883BB16B08B2889DF4E6` |
| `build/nine-kingdoms-0.1.0-route-cache-static-release-candidate.zip` | 833,886 | `7A3C77C18FD3A7B41017D89FF389223CB120E8A1A103DCFC331C6E556A3D00AB` |

106 项测试、离线和静态构建通过。五场回放的 4,561 个模拟步逐步比对完整战局与事件，720 局固定策略的汇总一致。Edge 158 在 8 倍 CPU 降速仿真中以 60 FPS 档满生命通关，绘制元帅十二张动作帧。Edge 用上一版整局战报静态包通过同址 v14 更新，核对一个旧哈希资源和以原战利品进入第二波。两个压缩包通过 CRC 与逐字节核验。 [模拟和帧率对照](PERFORMANCE.md#敌军寻路计算复用)

## 实时战况构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-live-battle-offline-playtest.zip` | 838,767 | `38E3234A2623C3418C025F2E2C3DBFCDCBFD39BE986A49E6780AA8B7C864A1EC` |
| `build/nine-kingdoms-0.1.0-live-battle-static-release-candidate.zip` | 834,738 | `0238AA677BB80DB694E3670910C404995001A60530A2E566A988273BFB5B7BA4` |

106 项自动化测试及两类构建通过。Edge 158、Firefox 142 断网重放自然种子 11532。核对元帅的在场与待入场数量、剩余敌军总数、按键选中的单位跟随移动、焦点和暂停恢复。390 像素宽窗口验证名单和单位详情，六波结算清理标记并成功下载整局战报。Edge 另通过教学正负流程和 v14 同址更新。两个包通过 CRC 和逐字节核验。 [实战截图](screenshots/live-battle-intel.png)

## 鸢尾矛兵动作构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-spear-motion-offline-playtest.zip` | 852,035 | `5F40DD6DA91356741E8405973F233F79D015AE3EF1AB106B1142DB08786BDB7B` |
| `build/nine-kingdoms-0.1.0-spear-motion-static-release-candidate.zip` | 848,233 | `1FB526AC4B39230400E75F78AF23A6B8F350DAEA83D527FD31152877E32237E9` |

106 项自动化测试及离线、静态构建通过。动作图集为 13,264 字节，九帧透明边缘齐全、内容各异，重建后哈希一致。Edge 158 的 120 FPS 档和 Firefox 142 的 30 FPS 档在同一驻军种子 109 第 2 波实际绘制全部动作，两浏览器均以 15 城堡生命、击退 74 名敌军通关。Edge 的六波帧间隔 P95 为 12.4–12.9 毫秒，Firefox 为 37.0 毫秒。Edge 验证召唤矛灵三档动效的波次结算、静态同址 v14 续玩、十五个新版发行文件和一个旧哈希可读取。两个包通过 CRC 和逐字节核验。 [战场截图](screenshots/spearman-thrust.png) · [原稿与提示词](../assets/originals/nine-kingdoms/PROVENANCE.md#鸢尾矛兵动作图集)

## 整局帧率战报构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-frame-history-offline-playtest.zip` | 852,603 | `57174DA12F2087E7F22CB64C98D5C98264D87C10BB5F78B937C4ED7E625EFE39` |
| `build/nine-kingdoms-0.1.0-frame-history-static-release-candidate.zip` | 848,860 | `D5D12EFFCE28C662FC5AE796DF57E34D14A230B394CDB754187A07D704153B26` |

107 项自动化测试、类型检查以及离线和静态构建通过。Edge 158 的 60 FPS 档和 Firefox 142 的 30 FPS 档断网通关自然王国种子 11532，第 6 波前刷新，结算用键盘下载的文件包含六波采样。两浏览器均以 16 城堡生命、击退 74 名敌军告捷。Edge 验证暂停排除、单波报告跨刷新一致、关闭开关隐藏记录，以及静态更新前后各 15 个发行文件、1 个保留哈希与 v14 战利品续玩。两个包通过 CRC 和逐字节核验。 [采样设置](screenshots/frame-history-settings.png) · [试玩说明](PLAYTEST.md#实机性能采样)

## 战场引擎独立加载构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-split-engine-offline-playtest.zip` | 853,838 | `F14FB8A6F92DAA2ADE8FC80092A36BEFC022313369A4C045CCF7986842593F71` |
| `build/nine-kingdoms-0.1.0-split-engine-static-release-candidate.zip` | 849,751 | `935ABB5D48B9E2490281265ECF963833E6ED8CD4B5CEDFCC15FD1072E0AD05D7` |

107 项自动化测试、类型检查和两类构建通过。Edge 158 离线单文件和 Firefox 142 静态包都以自然种子 11532 通关，复验第 6 波前刷新和整局六波采样下载。两浏览器同址更新验证 15 个前版文件、16 个新版文件、1 个保留哈希、战利品续玩与第二波计划。模拟引擎请求延迟时，菜单、读档和备战可用，开战等待首次绘制。主动中断引擎请求时提示重载，恢复请求后从原检查点继续。Edge 另验证开发沙盒和生产包部署操作。两包通过 CRC 和逐字节核验。 [慢网对照数据](PERFORMANCE.md#战场引擎独立加载)

## 进度导入保护构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-progress-import-guard-offline-playtest.zip` | 854,333 | `9A38C4328F52E03276546366B0E05623AA3A20756D5BFCE2D32DFB1603EAC397` |
| `build/nine-kingdoms-0.1.0-progress-import-guard-static-release-candidate.zip` | 850,207 | `06746809A7E632E25DE7F6A135D98DD32A97E8AA97B8477674572E8D3FFAD41B` |

110 项自动化测试、类型检查和两类构建通过。旧版 Edge 复现导入覆盖最近保存的异页战局。新版 Edge 158 与 Firefox 142 断网执行进度迁移测试，旧确认保留种子 41 的两座箭塔、备用档与纪事，展示新的本机摘要。键盘再次确认后成功导入种子 119，刷新续玩。Edge 另通过静态同址 v14 更新，核对前后各 16 个文件、2 个保留哈希与第 2 波备战。两包通过 CRC 和逐字节核验。 [确认提示](screenshots/progress-import-changed.png) · [迁移说明](PLAYTEST.md#换设备或试玩包时迁移进度)

## 战斗反馈构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-battle-clarity-offline-playtest.zip` | 854,755 | `1FCC4E959E6F7393A4C2283521F909BEB771B82703FAA79A963F17852C716A78` |
| `build/nine-kingdoms-0.1.0-battle-clarity-static-release-candidate.zip` | 850,626 | `9AE3A5E9CE235A1B235EFA662DAB52C583D5FA2747B9CC77DB09CB3CE3D8614A` |

111 项自动化测试、类型检查和两类构建通过。Edge 158 和 Firefox 142 的断网回归观察到合计伤害和独立治疗标签，测试样本中没有数字交叠和截断，各动效档结算与奖励一致。Edge 简化动效下的裂光魔法塔范围环与规则的 1.15 格半径一致。Edge 120 FPS 档离线重放钢铁种子 119，六波平均 119.8–120.0 FPS，帧间隔 P95 为 12.6–13.6 毫秒，绘制了元帅的十二帧动作，以 30 城堡生命通关并击退 74 名敌军。Edge 另通过 v14 同址更新及第二波续玩。两包通过 CRC 和逐字节核验。 [伤害数字](screenshots/combined-damage.png) · [简化范围环](screenshots/reduced-arcane-area.png)

## 骑兵冲锋范围构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-war-cavalry-range-offline-playtest.zip` | 854,760 | `082565AC4BF32F13EB22388D5C27DE70FC07416F72B3C685B1CF3D782C418BA2` |
| `build/nine-kingdoms-0.1.0-war-cavalry-range-static-release-candidate.zip` | 850,643 | `167C51EFD6B868FD0CA82D9889D7D6A3AA322FB820FD0A001651A69C933E9DE2` |

111 项自动化测试、类型检查、两类构建和内容表生成通过。战争骑兵冲锋覆盖目标相邻斜格，军队与驻军的 240 局固定策略对照增加 3 个通关，五国六种默认策略的 720 局保持 356 个通关。Edge 158 与 Firefox 142 离线验证图鉴、实际静态范围环及战争种子 48401 六波通关，均以 21 城堡生命结束。Edge 另验证同址更新前后各 16 个文件、1 个保留哈希和 v14 第二波续玩。两个包通过 CRC 和逐字节核验。 [图鉴截图](screenshots/cavalry-charge-briefing.png) · [数值对照](BALANCE_BASELINE.md#战争骑兵冲锋范围)

## 候选包独立复验

- 在不含 `node_modules` 的中文目录用 Node 20.12.0、npm 10.9.3 执行 `npm.cmd ci --no-audit --no-fund --cache .npm-cache`，从锁文件镜像安装 56 个依赖。111 项测试通过，`npm.cmd run dev -- --port 5187 --strictPort` 的游戏入口返回 HTTP 200。两类构建的 16 个静态文件与单个离线 HTML 均和骑兵冲锋范围候选包逐字节一致，锁文件保持原值。
- Chrome 157.0.8103.80 从解压静态包以 60 FPS 上限、1280 × 720 运行自然种子 11532。第 6 波前刷新，结算余 16 城堡生命并击退 74 名敌军。390 像素宽界面通过键盘下载六波采样。该台式机每波平均绘制 60.0 FPS，P95 为 18.3–22.1 毫秒。 [通关截图](screenshots/chrome-candidate-victory.png)
- Chrome 从解压的离线 HTML 通过进度备份、旧确认保护、坏文件处理和战报测试。独立本机试玩入口用同一静态包，验证菜单、首个部署和开战。

## 键盘部署构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-keyboard-deployment-offline-playtest.zip` | 855,111 | `CAF4C75422B1C411A227B60ABFA1D329CAF27981C6F968A009A1FF57978CE22A` |
| `build/nine-kingdoms-0.1.0-keyboard-deployment-static-release-candidate.zip` | 851,019 | `D787B63BAE72D99218C1705BA6155552D2894DD1B25B9BC32B655666082900E7` |

旧候选包用 Enter 选军令后，地图未获得焦点。新版 Edge 158 和 Firefox 142 在三种窗口宽度的离线回归中完成选牌、预览、取消、确认和开战。鼠标离开地图后恢复以键盘所选的格子预览。无效的重复部署保持原存档，战术牌使用后焦点留在手牌。111 项测试、两类构建与 Edge 静态 v14 同址续玩通过。两个包通过 CRC 和逐字节核验。 [窄窗预览](screenshots/keyboard-deployment-preview.png)

## 键盘领奖构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-keyboard-reward-offline-playtest.zip` | 855,211 | `B052FB36EF8B74CF023BEF24D059A246494390F3E042C82AFE534DC16689859A` |
| `build/nine-kingdoms-0.1.0-keyboard-reward-static-release-candidate.zip` | 851,143 | `52003E7400706D8F370BD994562392C677A8AC153DA9A09229234BF13638D732` |

旧离线包复现长按 Enter 领取战利品后立即开战。新版 Edge 158 和 Firefox 142 断网通过三波键盘教学、战利品读档、暂停恢复、胜负重开和重复键确认。两浏览器均击退 27 名敌军取得教学胜利。Edge 静态同址更新通过前后各 16 个文件及 v14 存档续玩。111 项测试、两类构建通过，两个包通过 CRC 和逐字节核验。 [领奖后焦点](screenshots/keyboard-reward-focus.png)

## 本机试玩入口更新

本机入口 `http://127.0.0.1:4173/` 从骑兵冲锋范围构建切换到键盘领奖构建。先加入新版带哈希的脚本和样式，再替换入口文件。更换前逐字节验证旧版 16 个文件。以旧入口的 Last-Modified 发起条件请求，切换前返回 304，切换后返回 200。更换后验证新版 16 个文件和仍可访问的 2 个旧哈希文件。

Chrome 157.0.8103.80 在独立浏览器上下文，以钢铁种子 119 将旧版打到第一波战利品。刷新进入新版后保留原有三个奖励选项、阵势、静音及 60 FPS 上限。长按 Enter 仅领取一次雾林弓手，焦点停在新军令，主档和备用档均保存第 2 波备战。再次刷新可继续，无页面错误。此项使用本机 Python 静态服务。首发托管的缓存与压缩待在发布环境验收。

## 存档重试构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-checkpoint-retry-offline-playtest.zip` | 855,712 | `E49109A297D2BA146445C538C078D1A4288675329D3598CFCFF5D566C089809B` |
| `build/nine-kingdoms-0.1.0-checkpoint-retry-static-release-candidate.zip` | 851,603 | `DFF5F0D5E1558B8E215E09F43E25B15651576EFC78EB580F40D012ACF5A7142F` |

111 项自动化测试及静态、离线构建通过。两包通过 CRC 和逐字节核验。Edge 158 和 Firefox 142 断网验证战利品及备战写入失败后的提示、键盘重试、刷新续玩和同来源较新存档保护。Edge 静态更新排练通过 16 个旧文件、16 个新文件和 2 个保留的旧哈希，读档版本保持 v14。 [复现步骤](../TEST_PLAN.md#战利品和备战保存失败)

原本机试玩地址更新至此构建。Chrome 157 用隔离存档刷新，从键盘领奖构建的第一波战利品继续到第二波，出场阵势和设置保持原值。两版各 16 个文件及两个旧哈希都通过逐字节核验，切换后的条件请求返回 200，浏览器无页面错误。

## 最终波阵势提示构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-final-formation-offline-playtest.zip` | 855,766 | `A91B57A27D06B0F75B9B3F95C555BE336B6E5242C60E38B0680DED97513228F7` |
| `build/nine-kingdoms-0.1.0-final-formation-static-release-candidate.zip` | 851,654 | `508E5F3BA90737C3FC280CF7909E983C066FEE6AE0A2560FF9B28FD14DCCC147` |

三种最终波阵势各跑三批 120 局。三批收缩内线样本均获得更多通关且城堡合计损伤更少。调整限于备战提示，720 局默认策略回归仍通关 356 局。111 项自动化测试、静态和离线构建、两包 CRC 及逐字节核验通过。Edge 和 Firefox 断网重放钢铁种子 119，核对阵势、刷新及满生命通关。Edge 通过静态同址排练。原本机试玩地址已更新，Chrome 验证 16 个新版文件、1 个仍可访问的旧脚本及 v14 从旧战利品继续到第 2 波。 [阵势对照](BALANCE_BASELINE.md#第六波守军阵势对照) · [界面复验](../TEST_PLAN.md#最终波阵势提示)

## 远征结算存档保护构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-settlement-checkpoint-offline-playtest.zip` | 855,945 | `E5D444A41252F238634995908941840186AB4840614ABE053344D6010FCAF1AE` |
| `build/nine-kingdoms-0.1.0-settlement-checkpoint-static-release-candidate.zip` | 851,839 | `75FA771D04B5AF50BBD5AC6A82EAA4770235D2A941AE3A3E53682D0D05C00A53` |

111 项规则测试、静态构建和单文件离线构建通过。两包通过 CRC 及逐字节核验。Edge 和 Firefox 断网复现同局两个标签页结算顺序，较新检查点保留至正确结算，并只写一次功勋。Edge 通过离线进度回归及静态同址排练。钢铁种子 119 通关六波，城堡 30 生命、击退 74 名敌军，胜利结算显示加 3 功勋并解锁仓储许可。Chrome 157 在原本机试玩地址验收更新，核对新版 16 个文件、保留旧脚本并从旧 v14 战利品进入第 2 波。 [跨页结算测试](../TEST_PLAN.md#同一远征的跨标签页结算)

## 已结算检查点恢复构建

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-completed-checkpoint-offline-playtest.zip` | 856,037 | `8AF5042BFFD0BA1575F1BCFDBD5A2FE8DF569946E05D6EB3CD6CE94E8A3A0A2D` |
| `build/nine-kingdoms-0.1.0-completed-checkpoint-static-release-candidate.zip` | 851,964 | `EFB053A5F629A083BC9C3C5B18C3F25104B641185F4E174530200D78D7DA890A` |

114 项自动化测试、静态与离线构建通过。压缩包通过 CRC 和逐字节检查。Edge 和 Firefox 各验证主档清理中断、刷新、新局、导出和旧文件导入。Edge 离线进度和跨标签结算回归通过。Chrome 在原试玩地址核对新版 16 个静态文件、上一版旧脚本，并从尚未完成的旧战利品检查点恢复到第 2 波。 [恢复步骤](../TEST_PLAN.md#远征已完成时恢复存档)

## 源码交付包独立验收

`build/nine-kingdoms-0.1.0-source.zip` 包含 240 个源码、原始素材、生成素材、许可、设计、测试和工具文件，共 38,347,904 字节。SHA-256 为 `D6448B06CBD01935731007CBC0B2D76389682BC55589F351E320FA64CEB631CF`。解压文件逐字节匹配工程快照，压缩包通过 CRC 核验。

独立解压到含中文与空格的工作区日志目录。Node 20.12.0、npm 10.9.3 从现有缓存执行 `npm.cmd ci --offline --no-audit --no-fund --cache <缓存目录>`，在该目录安装 56 个依赖，锁文件未变化。`npm.cmd test` 通过 114 项测试，两类构建完成。重建的 16 个静态文件与单个 HTML 分别逐字节匹配已结算检查点候选包。`npm.cmd run docs:content` 生成的 40 张卡牌、16 种建筑和 20 种单位的数据表也与包内文档逐字节一致。

`npm.cmd run dev -- --port 5189 --strictPort` 在独立目录启动，访问首页和转换后的入口模块均返回 HTTP 200。Edge 158 实玩从该目录重建的离线文件，390 像素宽窗口通过三波键盘教学、战利品读档、胜利与失守后的重开。FFmpeg 7.0 从包内原稿重建基础及各组动作图集，独立目录的 12 个生成素材均与包内文件逐字节一致。首发目标设备、真人首次试玩和实际托管仍待验收。 [试玩与启动](../README.md#启动与检查)

## 试玩版本标识构建

设置、单波战报和整局战报的构建版本为 `0.1.0+6ceae2227419`。

| 构建 | 字节 | SHA-256 |
| --- | ---: | --- |
| `build/nine-kingdoms-0.1.0-6ceae2227419-offline-playtest.zip` | 856,247 | `635B656951F94CD529FB19FF225EA3A89D0CB2171F3651E9F5473A80BAA29DD1` |
| `build/nine-kingdoms-0.1.0-6ceae2227419-static-release-candidate.zip` | 852,174 | `46E8B19AF03EA083254B56AB65CD7EF02E0AABC8EA28EC0FD0B5F6BAD259D5C8` |
| `build/nine-kingdoms-0.1.0-6ceae2227419-source.zip` | 38,350,141 | `505D13022B3039AF2338355C38CAE9C2FA4D423C6AD0779FBE32CD494647E1A2` |

三个包通过 CRC 及逐字节校验。独立解压源码再安装依赖，114 项测试通过，重建的 16 个静态文件和离线 HTML 与上表对应包逐字节相同。Edge 和 Firefox 实际下载的两类战报标明同一构建。Chrome 在原试玩地址验证新版设置、旧哈希文件和 v14 存档更新后的继续。 [验收细节](../TEST_PLAN.md#试玩构建版本)
