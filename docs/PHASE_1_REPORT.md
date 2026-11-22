# Phase 1 验收记录

2026-11-19，Windows、Node.js 20.12、Microsoft Edge。关卡为「鸦渡防线」，使用默认种子 119。

| 验证 | 结果 |
| --- | --- |
| `npm test` | 6 项规则测试通过，覆盖失败不扣费、农圃相邻收益、暂停、绕行/破障、失守和可复现的三波胜利 |
| `npm run build` | TypeScript 与生产构建通过，输出随包音效、图标与许可证 |
| `npm run test:browser` | 通过真实页面交互完成部署、暂停、奖励、三波胜利、重开、窗口缩放、失守和设置持久化 |
| 网络与控制台 | 浏览器流程无页面异常、控制台错误、资源请求错误或第三方 HTTP 请求 |
| 生产预览 | Edge 成功打开 `npm run preview` 服务，进入战场并放置箭塔，金币从 11 降为 8 |

截图见 [主菜单](screenshots/menu.png)、[备战](screenshots/planning.png)、[战斗](screenshots/battle.png)、[胜利](screenshots/victory.png)。浏览器回归还检查了 820 像素宽窗口没有横向溢出。

Phase 1 使用单一开局、三种建筑、一种守军、两类敌人和五种军令。完整牌库与成长、四王国、Boss、局外进度和成品美术按后续阶段扩展。生产 JavaScript 约 1.51 MB（gzip 约 353 KB），Vite 有单块大小提示，性能优化仍列在 Phase 5。
