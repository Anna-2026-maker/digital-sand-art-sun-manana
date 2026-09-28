# MAÑANA · 日出沙画画台

为日出明日 mañana 主题活动制作的独立沙画项目。复制自 [digital-sand-art](https://github.com/Anna-2026-maker/digital-sand-art)，基于源提交 `d8b0c23cb87d2bc9ed6a918e6aea6aa2a1d7ab8e`，原仓库不受本项目修改影响。

## 主题效果

沙层由薄到厚映射为奶油金光、金黄、暖橙、朱红、深赤褐；保留细沙颗粒、稀疏散沙和堆积边缘。落砂加深暖色，透光擦出亮色，塑形保留原来的推沙效果。画布、下载 PNG 和工程缩略图使用相同渲染。

原有落砂、塑形、透光、暂停、撤回/重做、画笔大小、画布缩放移动、横竖屏、图片转沙画、辅助线稿与工程保存操作不变。没有自动加入太阳、人物或参考图内容，画面由使用者自由创作。

主题版使用独立的 `manana-sunset-sand-art-projects-v2` 本机存储键，不读取或覆盖原版存档。保存仍属于当前浏览器本地缓存，重要作品请下载图片。

## 正式网页入口

`site/` 是原仓库 GitHub Pages 正在使用的完整网页版本，本次活动也使用该入口。无需安装依赖：

```sh
python3 -m http.server 8000 --directory site
```

打开 http://localhost:8000 。可用于电脑、手机和 iPad。

仓库保留原工程的 Next.js 源码及其他目录；Next.js 原型也已同步主题配色，但完整功能以 `site/` 为准。

## GitHub Pages

保留 `.github/workflows/deploy-pages.yml`，发布目录为 `site/`。新仓库需在 Settings → Pages → Build and deployment 中选择 GitHub Actions，然后运行部署工作流。新项目地址为独立路径，不会替换原沙画台页面。

## License

保留原工程 [MIT License](LICENSE)。

## 麦克风吹沙（1.1）

在工具抽屉点击「开启麦克风吹沙」，允许权限并安静等待约 1 秒；拖动风口，设置风向，然后按住「按住吹沙」对麦克风吹气。画笔大小控制风幅，灵敏度控制触发门槛。每次连续吹沙可以一次撤回。松手或暂停立即停止，关闭功能或离开页面会释放麦克风。

声音只在本机分析，不录音、不上传，不连接扬声器。需要 HTTPS 和支持 getUserMedia / Web Audio 的浏览器。环境声音判断属于启发式检测，不能完全区分吹气、人声与音乐，活动现场应调整灵敏度。真实 iPad 麦克风的识别效果仍需现场试用。

验证：`node --test tests/wind.test.cjs`，覆盖沙量守恒、边界、按住与声音双重触发、撤回快照、权限拒绝、页面离开和暂停释放。

## 主题版 1.2：图片层次与设备入口

底栏增加「吹沙」入口，电脑鼠标和 iPad 触摸都能打开麦克风设置。电脑可在聚焦「按住吹沙」按钮后按住空格键；iPad 可用手指按住。麦克风从系统授权返回后如音频被暂时挂起，在下一次按住时会请求恢复。吹气检测只需声音持续高于现场底噪，不限定某一类麦克风的频率响应。

图片转沙画采用图片亮度分位数和柔和的密度曲线；高光保持亮黄，中间层次过渡到橘红，少量最深的阴影才呈棕色。直接画沙、图片导入、保存工程与下载均使用统一主题色阶。`node --test tests/*.test.cjs` 验证声音触发与色阶渐变。

## 主题版 1.3：明显的扇形吹沙

「灵敏度 · 风力」滑块现在同时控制声音触发门槛、扇形吹动范围与沙粒移动量。高档位能响应更轻的吹气；持续吹气时沙层会被明显推开，低档位保留细微效果。吹沙依然只重新分布已有沙子，松手即停且每次可以撤回。移动设备的计算范围和更新频率设有限制，以兼顾流畅度。


## 活动作品后台（D1 免费版，无需 R2）

`site/admin.html` 是工作人员的后台入口。网页版开始作画后约每 8 秒同步当前画面，松手后约 4 秒再同步；同一次创作持续更新同一记录。后台每 5 秒刷新，支持预览、下载打印图、A6 横向打印、打印操作计数与删除。上传的是最长边不超过 1600 像素的 JPEG（最多 1.8 MB），不包含线稿参考图或麦克风声音；用户自己下载作品仍可得到原始 PNG。画作数量不等于去重后的用户人数。

后端仅使用 Cloudflare Workers 免费计划和 D1 数据库。D1 单条记录上限 2 MB，免费计划包含 5 GB 总存储、每日 10 万行写入和每日 500 万行读取；超过免费限制会暂停服务。画作自动更新覆盖该画的旧快照，数据越多会占用更多存储，适合短期活动而非无限期图库。若需无损大图或长期大量留存，之后可改用对象存储。

后台用独立密码登录，8 小时会话只保存在管理员浏览器的 sessionStorage；作品图片经鉴权接口读取。自动同步使用每幅作品的随机编辑密钥，后续只能更新该幅作品。上线前应告知参与者画作的用途和留存期限；后台可逐条删除。

### 上线步骤（需要 Cloudflare 免费账号授权，无需开通 R2）

进入 `backend/` 目录执行：

```sh
npx wrangler login
npx wrangler d1 create manana-artworks
```

把 D1 返回的 `database_id` 填入 `backend/wrangler.jsonc`，再运行：

```sh
npx wrangler d1 migrations apply manana-artworks --remote
npx wrangler deploy
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ALLOWED_ORIGIN
```

`ADMIN_PASSWORD` 使用独立强密码；`SESSION_SECRET` 使用 32 字节以上随机字符串；`ALLOWED_ORIGIN` 填 `https://anna-2026-maker.github.io`（不加结尾斜线）。把 Worker 的 HTTPS 地址填入 `site/exhibition-config.js`，提交并部署网页。后台入口：`https://anna-2026-maker.github.io/digital-sand-art-sun-manana/admin.html`。确认真实作品同步、后台预览与打印后再用于活动。

没有 Worker 地址时，网站仍可创作、保存与下载，页面会显示“活动作品库尚未上线”；作品不会上传。不要把密码写入 Git 或前端配置。

测试：`node --test tests/*.test.cjs`，其中后台测试覆盖 JPEG 创建、鉴权读取、更新、打印计数、删除与跨来源拒绝。
