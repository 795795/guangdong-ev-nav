# 🚀 广东新能源导航 - 部署指南

## 📋 准备工作

确保你有以下文件：
- `index.html` - 主页面文件
- `package.json` - 项目配置文件

---

## 🌐 部署方案

### 方案一：GitHub Pages（完全免费）

**步骤：**

1. **创建GitHub账号**
   - 访问 https://github.com/
   - 注册账号并登录

2. **创建新仓库**
   - 点击右上角 "New" 按钮
   - 仓库名：`guangdong-ev-nav`（或任意名字）
   - 选择 "Public"（公开）
   - 点击 "Create repository"

3. **上传文件**
   - 进入仓库页面
   - 点击 "Add file" → "Upload files"
   - 上传 `index.html` 和 `package.json`
   - 点击 "Commit changes"

4. **开启GitHub Pages**
   - 点击仓库的 "Settings"
   - 找到 "Pages" 选项（在左侧菜单）
   - 在 "Source" 下选择 `main` 分支和 `/ (root)`
   - 点击 "Save"

5. **等待部署完成**
   - 页面会显示 "Your site is ready at https://你的用户名.github.io/仓库名/"
   - 通常需要几分钟时间

---

### 方案二：Vercel（免费版够用）

**步骤：**

1. **创建Vercel账号**
   - 访问 https://vercel.com/
   - 用GitHub账号登录

2. **创建新项目**
   - 点击 "New Project"
   - 选择 "Import Git Repository"
   - 选择你刚才创建的GitHub仓库
   - 点击 "Import"

3. **配置部署**
   - Framework Preset: 选择 "Other"
   - Build Command: 留空
   - Output Directory: 留空
   - 点击 "Deploy"

4. **完成部署**
   - 部署完成后会显示一个类似 `https://guangdong-ev-nav.vercel.app` 的网址

---

### 方案三：本地临时使用（同一WiFi）

**适合在家或办公室临时使用：**

1. 运行 `启动导航网站.bat`
2. 在命令行输入 `ipconfig` 找到你的内网IP（如 `192.168.1.105`）
3. 在手机浏览器输入：`http://你的IP:8081/index.html`

---

## 📱 手机访问

部署成功后，在手机浏览器中输入你的网址即可使用！

**示例网址：**
- GitHub Pages: `https://用户名.github.io/guangdong-ev-nav/index.html`
- Vercel: `https://guangdong-ev-nav.vercel.app/index.html`

---

## 🔧 常见问题

**Q: 网站打开是空白？**
- 检查网络连接
- 确认部署是否完成
- 检查浏览器控制台是否有错误

**Q: 地图不显示？**
- 确保高德地图API Key有效
- 检查网络是否能访问高德地图服务器

**Q: 定位功能不可用？**
- 需要在HTTPS环境下使用（GitHub Pages和Vercel默认是HTTPS）
- 在浏览器中允许定位权限

---

## 📁 文件结构

```
guangdong-ev-nav/
├── index.html          # 主页面（高德地图导航应用）
├── package.json        # 项目配置
├── 启动导航网站.bat     # 本地开发服务器（Windows）
├── 启动导航网站(Node).bat # 本地开发服务器（Node.js）
└── DEPLOY_GUIDE.md     # 部署指南（本文件）
```

---

## 💡 提示

- GitHub Pages和Vercel都是免费服务，非常稳定
- 部署后手机流量也能访问
- 如果需要自定义域名，可以在设置中配置

如果遇到问题，随时告诉我！
