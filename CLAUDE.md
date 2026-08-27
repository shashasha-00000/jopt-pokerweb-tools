# JOPT / PokerWeb / Tampermonkey / Apps Script 工作与文件管理规则

## 1. 正式代码仓库
所有 PokerWeb、Tampermonkey、Google Apps Script、Web App 及相关开发代码，统一使用本地正式仓库：
`D:\GitHub\jopt-pokerweb-tools`
本地 Git 仓库是代码开发正本。
GitHub 用于版本管理、历史记录和代码共享：
`https://github.com/shashasha-00000/jopt-pokerweb-tools`
如果当前环境不在该目录，应先检查并使用该路径。
不得使用以下位置作为正式代码来源：
- 临时 Codex / Claude 目录
- 下载目录
- Google Drive 副本
- 临时导出目录
- 其他未确认的代码副本

## 2. 普通 JOPT 本地工作区
非代码类 JOPT 日常工作文件，默认使用：
`D:\JOPT work`
该目录属于本地工作区，不是正式共享区，也不整体同步到 Google Drive。
这里可以保存：
- 草稿
- 进行中的报告
- Excel 工作文件
- 从 Google Sheets 临时下载的 Excel
- 临时 CSV
- 截图
- 图片
- 临时 PDF
- 中间导出文件
- 操作用副本
- 测试文件
- 临时下载文件
- 尚未提交的业务资料
- 一次性 HTML 工作稿
- 其他仍在制作中的非代码文件

这些文件即使已经可以正常打开，也不代表已经是最终成果物。

## 3. 执行与代码修改权限
在用户明确要求实际执行之前，只进行分析，不修改代码或正式文件。
明确执行指令包括但不限于：
- 「开始写代码」
- 「输出代码」
- 「直接修改文件」
- 「执行」
- 「按这个方案做」
- 「直接修」
- 「开始修改」
- 其他明显要求实际实施的表达

在方案讨论、需求整理、问题分析阶段，只能：
- 分析现状
- 查找问题
- 提出修改方案
- 列出可能涉及的文件
- 列出可能涉及的函数
- 说明影响范围
- 指出风险
- 指出不明确或互相矛盾的需求

不要为了演示方案输出完整代码。
确有必要时，只能使用极短的伪代码、函数名或数据结构示意。

## 4. 动手修改前的流程
在实际修改前，先说明：
- 对需求的理解
- 准备修改的内容
- 涉及的文件或函数
- 预计修改、新建或保存文件的完整路径
- 可能的风险或副作用

当需要向用户请求执行确认时，必须在请求确认前报告所有预计修改、新建或保存文件的完整路径。多文件可以使用简短列表。路径尚未确定时，应明确说明候选路径和未确定原因，不得先执行。

如果用户已经明确要求立即执行，开始实际操作前仍应简短报告上述文件路径。

用户在获知上述路径后，仅回复「执行」「按这个做」「开始修改」或其他普通执行指令时，视为同意按照最近一次报告的路径保存。如果用户另行指定保存位置，应以用户最新指定的位置为准。

如果用户尚未明确要求执行，说明完后停止，等待用户指令。
如果用户已经明确要求立即执行，则可以在简要说明后直接修改。
如果需求存在矛盾、缺失或可能造成破坏性影响，应先指出问题，不要自行猜测后继续。

## 5. 代码修改原则
实际修改代码时：
- 优先修改现有代码。
- 不无必要重写整个文件。
- 尽量做最小范围修改。
- 不为了顺手优化而修改与当前需求无关的逻辑。
- 不保留多套候选实现。
- 方案确定后只实现最终版本。
- 不重复输出未变化的完整文件。
- 只展示必要的修改摘要、差异和验证结果。
- 不擅自删除现有兼容逻辑、配置、注释或数据结构。
- 如果发现现有实现与需求冲突，先明确说明。

## 6. Git 操作规则
代码修改可以在本地 Git 仓库中进行，但以下操作只有在用户明确要求时才能执行：
- Git commit
- Git push
- 新建远程分支
- 合并分支
- rebase
- reset
- 删除分支
- force push
- 其他会改变 Git 历史或远程仓库的操作

不要因为代码已经修改完成就自动 commit 或 push。

## 7. 日期与时区规则
所有涉及业务日期或时间的逻辑，默认强制使用：
`Asia/Tokyo`
禁止依赖：
- 操作系统默认时区
- 服务器默认时区
- 浏览器默认时区
- Apps Script 项目默认时区
- Google Sheets 默认时区

日期的：
- 计算
- 比较
- 解析
- 格式化
- 工作日判断
- 定时任务
- 写入
- 显示

都必须明确按 `Asia/Tokyo` 处理。
如果外部 API 或协议要求 UTC，可以在传输或保存边界使用 UTC，但进入业务逻辑或面向用户显示前，必须明确转换为 `Asia/Tokyo`。
Google Apps Script 项目必须确认：
- `appsscript.json` 的 `timeZone` 为 `Asia/Tokyo`
- 涉及 Google Sheets 日期时，电子表格时区为 `Asia/Tokyo`

修改时间相关代码时，应检查与当前修改实际相关且当前可访问的：
- 配置文件
- 运行环境
- Apps Script 项目清单
- Google Sheets 时区
- 显示格式

无法确认的项目应明确报告，不得自行假设。

## 8. 日期显示默认规则
新设计的普通业务日期字段，默认只计算、保存和显示日期。
默认不包含：
- 小时
- 分钟
- 秒

只有用户明确要求具体时间时，才计算、保存或显示具体时刻。
例如：
- 比赛开始时间
- 截止时间
- 预约时间
- 发送时间
- 其他指定时刻

不得仅根据业务名称自行推断需要具体时间。
但不得擅自删除以下已有数据中的时间信息：
- API 返回时间
- 日志
- createdAt
- updatedAt
- timestamp
- 审计记录
- 技术追踪字段
- 已存在且有业务意义的时间字段

## 9. 文件分类原则
文件不根据扩展名判断用途，而根据其角色和业务状态判断。
文件分为三类：

### A. 开发源码
需要持续开发、维护、部署或版本管理的文件。
例如：
- `.js` / `.ts` / `.html` / `.css`
- Apps Script 文件
- Web App 源代码
- Tampermonkey 脚本
- PokerWeb 工具代码
- 部署配置
- 自动化脚本
- 可复用 HTML 模板

判断标准：以后还会从这个文件继续开发、修改、部署或维护。
此类文件保存到：`D:\GitHub\jopt-pokerweb-tools`
默认不复制到 Google Drive。

### B. 本地工作文件
用于当前工作的草稿、中间文件、临时操作文件或尚未正式提交的文件。
例如：
- 从 Google Sheets 下载的 Excel
- 临时 CSV
- 工作中的报告
- 草稿 HTML
- 临时 PDF
- 截图
- 中间导出文件
- 测试文件
- 操作用副本
- 下载文件
- 未完成的业务资料

此类文件默认保存到：`D:\JOPT work`
默认不复制到 Google Drive。

### C. 最终业务成果物
已经进入正式提交、共享、交付或存档阶段的文件。
例如：
- 正式 PDF / 最终 Excel / 最终 CSV
- 正式报告
- 最终图片
- 已完成 HTML 报告
- 已完成静态展示页面
- 正式说明书
- 导出后的交付文件
- 其他准备让团队、领导或外部人员查看的文件

此类文件完成后，可以复制到 Google Drive。

## 10. HTML / Web App 特别规则
HTML、CSS、JavaScript 文件不能仅根据扩展名判断是代码还是成果物。

**属于开发源码时**：如果 HTML / Web App 后续还要继续维护、包含持续开发逻辑、需要部署、需要版本管理、会继续复用、属于长期项目，则按开发源码处理，保存到 `D:\GitHub\jopt-pokerweb-tools`，源码默认不复制到 Google Drive。

**属于最终业务成果物时**：如果 HTML 是一次性最终报告、是提交给领导的静态页面、是最终展示文件、是无需继续作为开发源维护的交付页面，则可以按最终业务成果物处理，工作阶段可以保存在 `D:\JOPT work`，确认最终版本后再复制到 Google Drive。

**同时存在源码和交付版时**：源码 → Git 本地仓库 / GitHub；最终导出或交付版 → Google Drive。不要把整个开发项目复制到 Google Drive。

## 11. 最终成果物判断规则
不要因为文件已经生成成功、能正常打开或看起来完整，就自动认为它是最终成果物。

以下情况默认不是最终成果物：
- 仍在修改 / 草稿 / 测试版 / 预览版 / 中间版本
- 临时下载 / 为操作方便生成的文件
- 从 Google Sheets 临时下载的 Excel
- 为导入、转换、检查而生成的文件
- 尚未准备提交给领导或团队
- 用户仍在修改主体内容
- 用户只是要求生成文件，但没有进入提交或共享阶段

以下情况可以视为最终成果物：
- 用户明确表示完成、定稿或最终版
- 用户要求提交 / 共享 / 交付 / 上传
- 用户准备将文件发送给领导、同事或外部人员
- 文件已经进入正式使用或存档阶段

## 12. 用户忘记确认定稿时的处理
不要要求用户每次都必须主动说"定稿"。
当文件明显已经接近完成，例如：
- 主要内容已经完成
- 后续只剩小范围微调
- 用户开始讨论提交、汇报、分享或发送
- 当前版本已经可以正式使用
- 用户连续确认修改结果且没有新的主要需求

如果用户尚未明确是否同步，应主动询问一次：
"这个版本已经可以作为最终成果物使用，要同步到 Google Drive 吗？"
在得到确认前，不自动上传。
如果用户明确表示仍在修改、只是预览或暂时不提交，则继续作为本地工作文件处理，不上传。
如果用户已经明确要求提交、共享、交付或上传，则无需再次确认。

## 13. Google Drive 正式共享目录
最终业务成果物使用以下 Google Drive 目录：
`G:\共享云端硬盘\JOPT\01_イベント管理\02_セクション\03_カスタマー\ShaShaSha`
Google Drive 的角色是：团队共享、正式交付、正式存档、最终成果物副本。
Google Drive 不是：代码开发目录、本地工作目录、临时文件目录、自动备份目录、中间文件仓库。

## 14. Google Drive 同步规则
不要无条件同步整个文件夹。尤其不得整体同步：
- `D:\JOPT work`
- 本地 Git 仓库
- 临时目录
- 下载目录

只有已经确认的最终业务成果物才复制到 Google Drive。
复制时：
- 优先通过 `G:` 路径直接复制。
- 如果 `G:` 路径不可用，再使用 Google Drive 连接器或 API。
- 不使用 Windows 资源管理器手动复制。
- 不重新生成文件。不重新编辑文件。不改变文件内容。
- 不覆盖已有同名文件。如发生重名，保留原文件并使用新的不冲突文件名。
- 不删除现有文件。不移动现有文件。不修改共享权限。

完成后报告：本地保存位置、Google Drive 保存位置。

## 15. 简单判断流程
遇到任何新文件时，按以下顺序判断：
1. 以后还要继续开发、维护、部署或版本管理吗？
   - 是 → 保存到 Git 本地仓库。
   - 不是 → 继续判断。
2. 只是草稿、临时文件、中间文件、下载件或操作文件吗？
   - 是 → 保存到 `D:\JOPT work`。
   - 不是 → 继续判断。
3. 已经准备给领导、同事、团队或外部人员查看、提交、共享或交付吗？
   - 是 → 视为最终成果物，可复制到 Google Drive。
   - 不确定 → 默认不上传，并询问用户。

## 16. 总体优先级
处理 JOPT 相关任务时，优先遵守以下顺序：
1. 本地 Git 仓库是代码开发正本。
2. `D:\JOPT work` 是普通业务本地工作区。
3. Google Drive 是最终共享和交付区。
4. 未明确要求执行时，只分析，不修改。
5. 明确执行后，优先做最小范围修改。
6. 代码不自动同步到 Google Drive。
7. 临时文件和中间文件不自动同步到 Google Drive。
8. 只有最终业务成果物才进入 Google Drive。
9. 用户可能忘记说"定稿"，接近完成时应主动询问是否同步。
10. 无法判断时，宁可先不上传，也不要自行把工作文件发布到共享盘。

## Customer-Facing Copy Safety

When working with customer-facing text such as emails, announcements, contracts, customer notices, support replies, or any content that may be sent outside the team:

1. Use user-provided original text exactly as the source of truth. Do not silently rewrite, summarize, polish, or supplement it.
2. Do not silently invent customer-facing copy.
3. If any customer-facing text is AI-written, explicitly label it before implementation and in the final response:
   `AI作成草案・原文未確認。使用前に確認してください。`
4. If a complete original text has not been provided for a message type, do not present it as a confirmed template.
5. For generated tools that create drafts, send emails, or prepare customer notifications, default to allowing only user-provided original text.
6. If AI-written draft text must be used, get explicit user confirmation first.
7. In the final response for customer-facing copy work, list each message/template source as one of:
   - `ユーザー提供原文`
   - `AI作成草案`
   - `原文未提供`
