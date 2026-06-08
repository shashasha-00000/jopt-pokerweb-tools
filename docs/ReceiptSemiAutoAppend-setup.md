# 領収書半自動追加フロー

使用脚本：

`apps-script/ReceiptSemiAutoAppend.gs`

## 初回设置

1. 将脚本内容添加到现有 Google Spreadsheet 的 Apps Script 项目。
2. 手动执行一次 `setupReceiptSemiAutoAppend`，完成授权。
3. 重新打开 Spreadsheet，确认出现菜单 `領収書半自動`。

初回设置只会准备以下新表：

- `領収書申請入力`
- `CHECK_REPORT`
- `領収書半自動_RUN_LOG`

不会自动创建或改造 `AI_CSV_EXPORT`、`メール送信`。

## 每次操作

1. 将极简 TSV 粘贴到 `PW TSVショウ用`。
2. 在 `領収書申請入力` 填写 `Game ID / 氏名 / メールアドレス / 宛名`。
3. 先执行 `領収書半自動 > 生成前チェック（書き込みなし）`。
4. 查看 `CHECK_REPORT`。
5. 确认无误后执行 `領収書半自動 > CSV・メール送信生成`。
6. 执行 `AI CSV をDrive出力`，将最新一次追加的数据导出为 CSV。
7. Illustrator 导入 CSV，JSX 导出 PNG。
8. 回到表格执行现有 Gmail 下書き和发送脚本。

## 保护规则

- `AI_CSV_EXPORT` 和 `メール送信` 只向最后一行之后追加。
- 不清空、不覆盖、不插入已有行。
- 不修改已有表头、公式、格式、列宽。
- 两张输出表都会先检查；任意一张不符合要求时，两张都不写入。
- 同一批输入重复执行时会停止，防止重复追加。
- `CHECK_REPORT` 是本流程专用，每次检查或生成时会更新。

## 可调整设置

脚本开头的 `RSA_CONFIG`：

- `AI_CSV_SHEET_NAME`：现有 Illustrator CSV 表名
- `MAIL_SHEET_NAME`：现有邮件发送表名
- `CSV_OUTPUT_FOLDER_URL_OR_ID`：CSV 输出 Drive 文件夹。留空时输出到 Spreadsheet 所在文件夹。
