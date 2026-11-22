# Phase 4 验收记录

2026-11-19 在 Windows 上使用 Edge 验证美术、反馈、菜单、设置与存档。测试从正式游戏操作入口进行，沙盒单独用开发版入口验证。

| 项目 | 已验证的行为 | 证据 |
| --- | --- | --- |
| 战场、军令和图鉴 | 47 枚精灵覆盖全部当前内容。资源从本地加载。默认画布、820 像素宽战场和较窄图鉴可操作，图集失败时仍能部署和暂停 | [战场](screenshots/phase4-atlas-deployment.png) · [图鉴](screenshots/phase4-atlas-compendium.png) · [测试记录](../TEST_PLAN.md) |
| 音效和动态反馈 | 攻击、阵亡、法术、升级和 Boss 等效果由事件驱动。音量、静音及动态效果档位可保存 | [Boss 登场](screenshots/phase4-atlas-boss.png) · [设置](screenshots/phase4-settings.png) |
| 菜单与可继续战局 | 点击或按 Esc 暂停，进入设置或图鉴后状态保持。由主菜单离开并返回浏览器时仍能继续备战 | [暂停](screenshots/phase4-pause.png) · `npm run test:browser` |
| 主存档和备用存档 | 原版存档可迁移。主记录无效时从已校验副本继续，恢复后重写主记录。两份同时损坏时提示重开，提示本身保留原记录 | [存档恢复](screenshots/phase4-checkpoint-recovery.png) · `npm run test:browser:sandbox` |
| 调试隔离 | 加入军令、生成敌军、单步、调单个单位及模拟结算后，正式存档、备份、功勋和设置字节一致。生产包中没有沙盒入口及状态读取函数 | [调试沙盒](screenshots/phase4-sandbox.png) · `npm run test:browser:sandbox` |

生产构建和 45 项规则与表现测试通过。三波教学与六波远征均已在 Edge 完成实际运行验证。后续继续评估钢铁王国构筑、各王国的完整试玩和最终发布验收。性能采样单列在 [远征运行性能记录](PERFORMANCE.md)。
