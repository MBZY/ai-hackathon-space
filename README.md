# AI 黑客松 · 组队空间

华南师范大学人工智能创新协会「2026 秋季 AI 黑客松」官方组队平台。
提供：组队登记、选手名片、私信邀请、队伍进度留痕、作品公开展示。

- **线上地址**：https://ai-hackathon-space.app.workbuddy.host/
- **赛事时间**：2026-10-11 ~ 10-31
  - 组队截止 `10/16 22:00` ｜ 中期检查 `10/24 14:00` ｜ 作品提交 `10/30 22:00` ｜ 展示评审 `10/31`

---

## 一、技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express（`server.js` + `src-server/`），JSON 文件存储（`data/db.json`） |
| 前端 | 原生 JS + 单页 hash 路由（`public/`），**无构建步骤**，直接改直接生效 |
| 样式 | 设计系统 v2「蓝图工作台」深色工业风（`public/css/style.css`） |
| 部署 | 平台「发布」能力，把整个项目目录作为 Node 服务上线 |

## 二、目录结构

```
server.js              # 入口：Express 应用（API + 静态前端 + 错误处理）
src-server/            # 后端模块：auth / teams / users / messages / notifications / admin
  └ config.js          # 活动硬节点、赛道、技能、报名模式等配置
  └ store.js           # JSON 文件存储（读写整个 db.json）
public/                # 前端静态资源（index.html / css / js / fonts）
  └ js/ui.js           # ★ 前端所有接口调用都经 UI.api() 统一封装
scripts/               # 测试与数据管线脚本
data/                  # 运行数据（db.json + uploads 图片）—— 见「数据安全铁律」
```

## 三、本地运行

```bash
npm install
PORT=3100 node server.js        # 打开 http://localhost:3100
```

> 首次启动会自动生成一份空的 `data/db.json`（不含任何真实数据）。

### 不想装环境？用 GitHub 云端开发（Codespaces）

仓库已内置 `.devcontainer/` 配置，浏览器里就能写代码、跑服务：

1. 打开 https://github.com/MBZY/ai-hackathon-space
2. 点绿色 **Code** 按钮 → **Codespaces** 标签 → **Create codespace on main**
3. 首次初始化会自动 `npm install`，随后得到浏览器版 VS Code + 终端
4. 终端执行 `node server.js`，端口 3000 自动转发并弹出预览

> 个人免费账号每月含 120 核时。**用完记得在 Codespaces 页面点 Stop**，否则会持续计费。
> 云端环境里 `data/` 是空的（隐私数据不进仓库），首次启动自动生成空库，适合开发调试。

## 四、⚠️ 数据安全铁律

仓库里**绝对不允许**出现以下内容，`.gitignore` 已作排除，请勿强行 `git add -f`：

| 文件 | 原因 |
|---|---|
| `data/db.json` | 含 61 名学生的姓名 / 学号 / 联系方式 / 密码哈希 |
| `data/backups/` | 线上数据备份 |
| `data/uploads/` | 用户上传的进度配图 |
| `docs/survey-users-*.json` | 报名原始数据（含学号、联系方式） |
| `docs/报名导入报告-*.md` | 含**身份证号、手机号、微信号** |
| `.workbuddy/`、`.wbapp_*.genie` | 本机工具数据、含本机绝对路径 |

**推送前自检**：`git status` 里出现上面任何一项，立即停下。

## 五、🚀 部署流程（重点：先同步数据，否则会丢数据）

发布时平台会把**整个项目目录**上传，`data/` 一并覆盖服务器 —— 如果本地 `data/` 比线上旧，**线上新数据会被冲掉**。所以每次部署前必须先同步：

```bash
# 1) 从线上拉取最新数据，合并回本地 data/db.json（会提示输入管理员密码）
node scripts/pull-online-data.js

# 2) 确认输出末尾出现「✅ 本地数据已与线上对齐」后，再执行发布
```

备份会自动落到两处（均可随时取回）：
- 项目内：`data/backups/online-<时间戳>.json`
- 项目外兜底：`~/.hackathon-space-backups/online-<时间戳>.json`

其他数据管线脚本：

```bash
node scripts/survey-to-users.js <answers.json>    # 问卷答卷 → users.json + 导入报告
node scripts/prepare-online-data.js <users.json>  # users.json → data/db.json
node scripts/merge-online-backup.js <backup.json> # 手动合并线上备份
```

## 六、多人协作规范

```bash
git clone git@github.com:MBZY/ai-hackathon-space.git
cd ai-hackathon-space
git checkout -b feat/你的功能
# …改代码…
git add -A && git commit -m "feat: 描述"
git push -u origin feat/你的功能
# 在 GitHub 发起 Pull Request，由负责人合并
```

- 主分支 `main` 保护，改动一律走分支 + PR。
- 提交信息用 `feat:` / `fix:` / `chore:` / `docs:` 前缀。
- **不要**提交 `data/db.json`（见第四节）。

## 七、开发约定（务必遵守）

1. **改前端静态资源后，必须同步升级 `public/index.html` 里的 `?v=YYYYMMDDx` 版本号**，否则浏览器不会加载新文件（HTML 走 no-cache，JS/CSS 靠版本号失效）。
2. **前端所有接口调用都走 `UI.api(path, {method, body})`**（`public/js/ui.js`）；后端 JSON 响应统一为 `{ data: ... }`，附加字段放在 `data` 内部。
3. **技能选项改动需同步 5 处**：`src-server/config.js` + `public/js/auth.js`(×2) + `players.js` + `teams.js`（队伍分工 `teamRoles` 是另一套，勿混）。
4. **严禁**用 `sed -i` 对含正则元字符（`[ ] ' *`）的模式做批量替换 —— 曾导致三个文件损坏。请用编辑器或 Node `split(old).join(new)`。
5. `user.team_id` 是动态计算的（`store.teamIdOf`），勿依赖静态字段；`user.status` 为 `pending`/`rejected` 时需在统计中过滤。

## 八、账号与权限

- 报名：问卷制（腾讯问卷 sid=28096194）→ 名单导入；或「直接注册申请」待审核。
- 登录：**学号 + 学号后 6 位**（初始密码），登录后可自行修改。
- 管理员：`src-server/config.js` 的 `adminStudentIds` 白名单。
- 测试账号：学号 `900000000001-3`（管理员）、`900000000101`（选手），密码 = 学号后 6 位。
- **联系方式默认不公开**：同学在「我的空间 → 我的名片」勾选后才会在名片广场展示；队友与（申请加入的）队伍队长始终可见。详见 `docs/申请与审批-设计说明.md`。

## 九、回归测试脚本

| 脚本 | 覆盖 | 用法 |
|---|---|---|
| `smoke-test.js` | 全流程冒烟（45 项） | `REG_MODE=open PORT=3100 node server.js` 后 `node scripts/smoke-test.js` |
| `ui-check.js` | 前端 UI 实测（25 项，puppeteer） | 同上服务后 `node scripts/ui-check.js`（需先跑冒烟造数） |
| `test-regmode.js` | 问卷制 + 审核 + 导入（33 项） | 直接运行（自起隔离实例） |
| `test-features.js` | 进度配图 / 作品 / 瀑布流（21 项） | 直接运行 |
| `test-apply-flow.js` | 申请·审批 + 联系方式可见性（53 项） | 直接运行 |
| `test-xss.js` | 姓名白名单（XSS 纵深防御，17 项） | 直接运行 |
| `ui-apply-check.js` | 申请·审批 + 名片卡 UI 全流程（28 项，puppeteer） | 直接运行（真实数据副本隔离） |
| `check-survey-ui.js` / `scan-*.js` | 问卷制 UI / 全站宽度溢出扫描 | 直接运行 |
