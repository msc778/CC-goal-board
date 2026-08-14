# 终身目标管理台

单文件离线可用的个人目标管理台（HTML/CSS/JS 全内联、零外链、零 emoji），融合 WorkBuddy 工作台模型与「年→月→日」三层目标对齐。

- 线上地址：https://lifelong-goal-board.netlify.app
- 数据存储：浏览器 localStorage + 可选 Netlify Blobs 云同步（netlify/functions/sync.mjs）
- 自动部署：推送到 GitHub main 分支后，Netlify 自动构建部署（含函数）

## 功能
今日 / 看板 / 周报 / 日历 / 我的 五大模块；打卡成果验证（四种类型自动识别 + 六大主题 + 跨主题分析）、双轨勋章、逾期标红、自动顺延、导出/导入 JSON、云同步。

## 本地使用
直接用浏览器打开 `index.html` 即可（离线可用）。数据存在本机浏览器 localStorage。

## 改代码后如何发布（一键）
双击 `push.cmd`：

1. 首次会提示粘贴 GitHub Token（也可先创建 `secrets.env` 文件，内容为 `GITHUB_TOKEN=你的令牌`，避免每次输入；该文件已被 .gitignore 忽略，不会上传）；
2. 脚本会把项目文件推送到 GitHub main，Netlify 收到 push 后自动构建，约 1 分钟生效。

> 本仓库已连接 Netlify（Build），函数由 Netlify Build 自动打包（package.json 声明 @netlify/blobs）。若本机 git.exe 无法联网，请用 `push.cmd` 发布。

## 数据跨设备同步
在「我的 → 云同步」中开启并设置同步密码，同一密码的设备间自动互通（基于 Netlify Blobs：打开自动拉取、改动自动推送）。

## 安全提醒
GitHub / Netlify Token 属于敏感凭据，请勿提交到仓库或公开分享；用完可在 GitHub Settings → Developer settings → Personal access tokens 中轮换或删除。