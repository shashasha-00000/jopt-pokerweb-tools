# PokerWeb ナショナルチケット批量付与工具

## Part 1: Google Sheet TSV 转换

脚本：`apps-script/NationalTicketTsvBuilder.gs`

1. 将脚本加入运营表的 Apps Script 项目。
2. 手动执行一次 `installNationalTicketTsvMenu()` 并授权。
3. 打开原始运营表页。
4. 执行菜单 `ナショナルチケットTSV` 下对应比赛的 TSV 生成项。
5. 从输出页 `ナショナルチケット付与TSV` 复制 A:B 两列，包括表头。
   也可以直接粘贴带表头的 `Player / Game ID / 付与内容 / 枚数` 表；`Player` 会被忽略，`枚数` 大于 1 时会自动展开成多条付与任务。

脚本只输出 `GameID` 和 `チケット名`。当前菜单入口：

- `Tokyo #02 TSV生成`
- `2026 Fukuoka #01 Main Ticket TSV生成`

### Tokyo #02

规则：

- `D列 対象プロモ = A`：应付与 Millions 和 PPC。
- `D列 対象プロモ = B / C`：只应付与 Millions。
- `I列 Millons1`：Millions 已付与 CHECK。未勾选时才输出 Millions。
- `J列 PPC`：PPC 已付与 CHECK。仅 A 类且未勾选时输出 PPC。
- `K列 WeChat送信`：也是 CHECKBOX，但不参与出票判断。
- `D列` 出现空白或 A/B/C 以外的值时，整批停止，不生成新输出。
- 为避免读取错误列，脚本会严格检查 `C=Game ID / D=対象プロモ / I=Millons1 / J=PPC / K=WeChat送信`。列结构变化时整批停止。

付与成功后，需要回到原运营表手动勾选对应的 `Millons1 / PPC`。PokerWeb 脚本不会直接读写 Google Sheet。

### 2026 Fukuoka #01

规则：

- 严格检查 `C=Game ID / I=Main Event`。
- 每个非空 `Game ID` 输出一条固定 Main Ticket。
- 输出仍写入 `ナショナルチケット付与TSV`，会覆盖上一次输出。
- 正式 ticket 名称未定时不会生成 TSV，会提示先设置 `MAIN_TICKET`。

设置位置：

- 打开 `apps-script/NationalTicketTsvBuilder.gs`。
- 找到 `NTB_FUKUOKA_2026_01.MAIN_TICKET`。
- 将空字符串替换成 PokerWeb 上完全一致的正式 ticket 名称。

维护原则：

- `onOpen()` 只挂当前需要用的比赛入口。
- 规则相同的新比赛可以在现有函数上小修复用；规则差很多时再新增独立函数。
- 活动结束后，菜单入口和对应代码可以直接删除，或移到历史目录；历史追溯优先依赖 git。

## Part 2: PokerWeb 批量付与

脚本：`tampermonkey/pw-national-ticket-batch.user.js`

可在任意已登录的 PokerWeb 后台页面运行。脚本会从当前页面菜单严格取得ナショナルチケット一覧链接，并在后台读取一覧页。

首次使用正式版时，建议在ナショナルチケット一覧页执行一次 DRY RUN。验证成功后，脚本会缓存已确认的一覧 URL，之后可从其他 PokerWeb 后台页运行；缓存失效时会重新从菜单发现并验证。

1. 粘贴 Sheet 输出 TSV。
2. 点击 `读取TSV`。
3. 点击 `验证・预览 / DRY RUN`。
4. 确认所有预览行状态为 `OK`。
5. 点击 `正式付与`。
6. 点击 `ログ出力` 复制日志 TSV。

安全规则：

- チケット名只做完全一致，不做模糊匹配。
- ナショナルチケット一覧链接必须能够从当前页面菜单唯一取得；找不到或出现多个候选时停止。
- 后台读取的页面必须包含 ticket group 链接，否则停止。
- GameID 搜索必须唯一。
- DRY RUN 不调用发券 POST。
- DRY RUN 全部成功后才允许正式付与。
- 每次 POST 前重新读取 group 页面，确认 ticket_id 仍为未発行并取得最新 codbloq。
- POST response 会记录为日志；PokerWeb 返回完整 HTML 时不单独据此判断失败。
- 每次 POST 后重新读取 group 页面；只有该 ticket_id 已离开未発行库存才判断成功。
- ticket_id 离开库存后，还会读取该票号履历；必须确认履历中的接收 GameID 与任务一致。
- 即使 POST 超时或报错，只要严格确认该 ticket_id 已离开未発行库存，并且履历中的接收 GameID 正确，就记录为成功并继续。
- POST 后无法查询 ticket_id 状态时，记录为状态不明并立即停止，禁止自动重试。
- 逐件 POST 间隔为 250–500ms，不并发发券。
- 任意一件失败立即停止。
- 防重键为 `ticket_id` 和 `TSV行号 + GameID + チケット名`。
- POST 一旦开始，即写入当前浏览器标签页的防重账本；即使结果不明也不会自动重试。
