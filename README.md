# MAÑANA · 落日沙画画台

为落日明日 mañana 主题活动制作的独立沙画项目。复制自 [digital-sand-art](https://github.com/Anna-2026-maker/digital-sand-art)，基于源提交 `d8b0c23cb87d2bc9ed6a918e6aea6aa2a1d7ab8e`，原仓库不受本项目修改影响。

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
