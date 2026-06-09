# PokerWeb ナショナルチケット批量付与工具

## Part 1: Google Sheet TSV 转换

脚本：`apps-script/NationalTicketTsvBuilder.gs`

1. 将脚本加入运营表的 Apps Script 项目。
2. 手动执行一次 `installNationalTicketTsvMenu()` 并授权。
3. 打开原始运营表页。
4. 执行菜单 `ナショナルチケットTSV > 現在のシートからTSV生成`。
5. 从输出页 `ナショナルチケット付与TSV` 复制 A:B 两列，包括表头。

脚本只输出 `GameID` 和 `チケット名`，规则固定为：

- `D列 対象プロモ = A`：应付与 Millions 和 PPC。
- `D列 対象プロモ = B / C`：只应付与 Millions。
- `I列 Millons1`：Millions 已付与 CHECK。未勾选时才输出 Millions。
- `J列 PPC`：PPC 已付与 CHECK。仅 A 类且未勾选时输出 PPC。
- `K列 WeChat送信`：也是 CHECKBOX，但不参与出票判断。
- `D列` 出现空白或 A/B/C 以外的值时，整批停止，不生成新输出。
- 为避免读取错误列，脚本会严格检查 `C=Game ID / D=対象プロモ / I=Millons1 / J=PPC / K=WeChat送信`。列结构变化时整批停止。

付与成功后，需要回到原运营表手动勾选对应的 `Millons1 / PPC`。PokerWeb 脚本不会直接读写 Google Sheet。

## Part 2: PokerWeb 批量付与

脚本：`tampermonkey/pw-national-ticket-batch.user.js`

在 PokerWeb 的ナショナルチケット一覧页运行：

1. 粘贴 Sheet 输出 TSV。
2. 点击 `读取TSV`。
3. 点击 `验证・预览 / DRY RUN`。
4. 确认所有预览行状态为 `OK`。
5. 点击 `只测试1件`，并在 PokerWeb 确认结果。
6. 点击 `正式付与` 处理剩余任务。
7. 点击 `ログ出力` 复制日志 TSV。

安全规则：

- チケット名只做完全一致，不做模糊匹配。
- GameID 搜索必须唯一。
- DRY RUN 不调用发券 POST。
- 正式付与必须先成功完成 1 件测试。
- 每次 POST 前重新读取 group 页面，确认 ticket_id 仍为未発行并取得最新 codbloq。
- POST response 必须出现可识别的成功信号；无法判断成功时立即停止。
- 每次 POST 后重新读取 group 页面；只有 ticket_id 已离开未発行库存才判断成功。
- 任意一件失败立即停止。
- 防重键为 `ticket_id` 和 `TSV行号 + GameID + チケット名`。
- POST 一旦开始，即写入当前浏览器标签页的防重账本；即使结果不明也不会自动重试。
