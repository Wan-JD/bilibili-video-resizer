# Greasy Fork 发布用文案

## 名称

B站视频自由缩放

## 简短描述

在 B 站普通网页模式下拖动播放器边框，自由拉伸整块播放区域的画幅比例与页面占位尺寸。

---

## 附加信息 / 完整说明

### 适用网站

- https://www.bilibili.com/video/*
- https://www.bilibili.com/list/*
- https://www.bilibili.com/bangumi/play/*
- https://www.bilibili.com/cheese/play/*

### 主要功能

**1. 边框拖拽缩放**

鼠标移到播放器边缘后，会出现轻量的细线或折角提示：

| 位置 | 效果 |
|------|------|
| 左 / 右边缘 | 调整播放器宽度 |
| 上 / 下边缘 | 调整播放器高度 |
| 四个角落 | 同时调整宽度和高度 |

**2. 自由画幅比例**

不会锁定 16:9。你可以把整块播放区域拉成更宽、更高，适合课程、字幕、竖屏视频、宽屏显示器等场景。

**3. 页面布局同步**

横向缩放时会同步调整 B 站页面左侧播放区，不只改变内部 video 元素，避免视频和页面占位脱节。

**4. 无设置面板**

安装后自动生效，不添加常驻按钮、不占用页面空间。

**5. 自动避让全屏状态**

网页全屏、浏览器全屏、mini 播放等状态下自动停止改动播放器布局。

**6. 本地尺寸记忆**

脚本会按视频保存你调整过的尺寸。再次打开同一视频时自动恢复；双击任意拖拽边缘即可清除当前视频的保存尺寸。

### 安装与更新

1. 先安装 **Tampermonkey** 或兼容的用户脚本管理器。
2. 安装脚本后刷新 B 站视频页面。
3. 鼠标移到播放器边缘，拖动高亮区域即可调整尺寸。

**GitHub 源码：** https://github.com/Wan-JD/bilibili-video-resizer

**支持作者：** [爱发电](https://ifdian.net/a/jd0512)

### 常见问题

**Q：为什么全屏时不能拖？**  
A：这个脚本只处理普通网页模式。全屏状态由 B 站播放器和浏览器接管，脚本会自动避让，避免影响原生播放体验。

**Q：怎么恢复默认大小？**  
A：双击任意一个拖拽边缘即可重置当前视频尺寸。

**Q：会上传我的观看记录吗？**  
A：不会。脚本不请求任何接口，尺寸数据只保存在本地 Tampermonkey 存储中。

### 开源与许可

- 许可证：**MIT**
- 问题反馈：https://github.com/Wan-JD/bilibili-video-resizer/issues

---

## 建议填写的 Greasy Fork 元数据检查清单

- [x] `// @license MIT`
- [x] `// @author Wan-JD`
- [x] `// @namespace https://github.com/Wan-JD/bilibili-video-resizer`
- [x] `// @homepageURL` / `@supportURL` / `@updateURL` / `@downloadURL`
- [x] `// @contributionURL` -> https://ifdian.net/a/jd0512

## 分类建议

- 类别：便捷工具
- 标签：bilibili, 哔哩哔哩, 视频, 播放器, 缩放, 画幅
