# 🌐 IP 信息查询系统 / IP Query System

多数据源聚合的 IP 地理位置、网络信息、安全检测查询系统。支持 AbuseIPDB、dklyIPdatabase 双数据源实时对比分析，内嵌 OpenStreetMap 地图定位。

A multi-source IP geolocation, network info, and security detection system with embedded OpenStreetMap positioning.

## ✨ 功能特性 / Features

### 前台查询 / Frontend
- 🔍 **IP 信息查询** — 输入任意 IPv4/IPv6 地址，聚合多源数据
- 📊 **多源对比** — AbuseIPDB、dklyIPdatabase 双数据源并排对比，差异高亮
- 🛡️ **安全检测** — VPN / 代理 / Tor / 威胁检测，AbuseIPDB 滥用评分
- 🗺️ **地图定位** — Leaflet + OpenStreetMap 嵌入式地图，深色/浅色主题自动切换 Tile
- 📍 **街道地址** — Nominatim 反向地理编码，精确到街道级别
- 🌐 **中英双语** — 界面标签同时显示中文和英文
- 💻 **浏览器标识** — 自动检测并展示访客浏览器、操作系统、设备类型
- 🎨 **主题切换** — 深色 / 浅色主题一键切换
- 📱 **响应式** — 完美适配桌面端和移动端

### 管理后台 / Admin (`/admin`)
- 🔐 **密码认证** — Token 鉴权，24h 自动过期
- 📝 **SEO 设置** — 配置网站标题、描述、关键词
- 🔑 **API Key 管理** — 在线管理 AbuseIPDB（多 Key 轮询）、dklyIPdatabase 密钥
- 🗺️ **地图设置** — 配置 Nominatim 联系邮箱
- 🔒 **安全设置** — 修改管理密码
- ⚡ **实时生效** — 所有设置修改即时生效，无需重启服务

## 📦 技术栈 / Tech Stack

| 组件 Component | 技术 Technology |
|------|------|
| 后端 Backend | Node.js + Express |
| 前端 Frontend | 原生 HTML/CSS/JS |
| 数据源 Sources | AbuseIPDB / dklyIPdatabase |
| 地图 Map | Leaflet + OpenStreetMap + CARTO Tiles |
| 地理编码 Geocoding | OpenStreetMap Nominatim |
| CDN | cdn.jsdelivr.net (Inter font, Leaflet) |
| 配置 Config | JSON 文件持久化 |

## 🚀 快速开始 / Quick Start

### 1. 克隆项目

```bash
git clone https://github.com/logdns/ip-query.git
cd ip-query
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 API Key：

```env
# 服务端口
PORT=3000

# AbuseIPDB API Keys (支持多个，逗号分隔)
ABUSEIPDB_KEYS=your_key_1,your_key_2

# dklyIPdatabase API Key
DKLY_API_KEY=your_dkly_key

# 管理后台密码
ADMIN_PASSWORD=your_admin_password

# Nominatim 联系邮箱 (可选)
NOMINATIM_EMAIL=your-email@example.com
```

> **注意**: 首次启动时，系统会自动从 `.env` 迁移配置到 `data/settings.json`。之后可通过管理后台在线修改，无需编辑文件。

### 4. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

服务器启动后访问:
- **前台**: http://localhost:3000
- **管理后台**: http://localhost:3000/admin

---

## 🐧 宝塔面板部署指南 / BT Panel Deployment

### 第一步：环境准备

1. 登录宝塔面板，进入 **软件商店**
2. 安装 **PM2 管理器**（Node.js 进程管理）
3. 安装 **Nginx**（如果尚未安装）
4. 在 PM2 管理器中确认 Node.js 版本 >= 16

### 第二步：上传项目

**方式一：Git 克隆（推荐）**

```bash
cd /www/wwwroot
git clone https://github.com/logdns/ip-query.git
cd ip-query
npm install --production
```

**方式二：宝塔文件管理器上传**

1. 打开宝塔 **文件** 管理器，进入 `/www/wwwroot/`
2. 上传项目压缩包并解压到 `/www/wwwroot/ip-query/`
3. 在终端执行 `cd /www/wwwroot/ip-query && npm install --production`

### 第三步：配置环境变量

```bash
cd /www/wwwroot/ip-query
cp .env.example .env
```

编辑 `.env` 文件，填入你的 API Key 和管理密码。

### 第四步：PM2 启动项目

**方式一：宝塔 PM2 管理器界面**

1. 打开 **PM2 管理器**
2. 点击 **添加项目**
3. 填写信息：
   - **项目名称**: `ip-query`
   - **启动文件**: `/www/wwwroot/ip-query/server.js`
   - **运行目录**: `/www/wwwroot/ip-query`
4. 点击 **提交**

**方式二：命令行**

```bash
cd /www/wwwroot/ip-query
pm2 start server.js --name ip-query
pm2 save
pm2 startup
```

### 第五步：配置 Nginx 反向代理

1. 在宝塔面板 **网站** 中添加站点，填写你的域名
2. 点击 **设置** → **反向代理** → **添加反向代理**
3. 填写：
   - **代理名称**: `ip-query`
   - **目标 URL**: `http://127.0.0.1:3000`
4. 点击 **提交**

#### 或者手动编辑 Nginx 配置

点击 **设置** → **配置文件**，在 `server {}` 块内添加：

```nginx
# 获取真实 IP (重要！)
set_real_ip_from 0.0.0.0/0;
real_ip_header X-Forwarded-For;
real_ip_recursive on;

# 静态文件缓存
location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
    root /www/wwwroot/ip-query/public;
    expires 7d;
    add_header Cache-Control "public, immutable";
}

# 反向代理到 Node.js
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_connect_timeout 60s;
    proxy_read_timeout 60s;
}
```

### 第六步：配置 SSL（可选但推荐）

1. 在宝塔面板 **网站** → **设置** → **SSL**
2. 选择 **Let's Encrypt** 免费证书
3. 点击 **申请**

### 第七步：验证部署

- 访问 `https://你的域名` 查看前台
- 访问 `https://你的域名/admin` 进入管理后台
- 默认管理密码为 `.env` 中设置的 `ADMIN_PASSWORD`

### 常用运维命令

```bash
# 查看运行状态
pm2 status

# 查看日志
pm2 logs ip-query

# 重启
pm2 restart ip-query

# 停止
pm2 stop ip-query

# 更新代码后重启
cd /www/wwwroot/ip-query
git pull
npm install --production
pm2 restart ip-query
```

---

## 📂 项目结构 / Project Structure

```
ip-query/
├── server.js              # Express 后端服务
├── package.json           # 项目依赖
├── .env.example           # 环境变量模板
├── nginx.conf             # Nginx 配置参考
├── lib/
│   └── settings.js        # 设置管理模块
├── data/
│   └── settings.json      # 持久化设置 (自动生成)
└── public/
    ├── index.html          # 前台页面 (中英双语)
    ├── admin.html          # 管理后台页面
    ├── css/
    │   ├── style.css       # 前台样式
    │   └── admin.css       # 管理后台样式
    └── js/
        ├── app.js          # 前台逻辑 (含 Leaflet 地图)
        └── admin.js        # 管理后台逻辑
```

## 🔌 API 接口 / API Endpoints

| 路由 Route | 方法 Method | 说明 Description | 认证 Auth |
|------|------|------|------|
| `/api/myip` | GET | 获取访客公网 IP / Get visitor IP | 否 No |
| `/api/useragent` | GET | 获取浏览器标识 / Get browser info | 否 No |
| `/api/query?ip=x.x.x.x` | GET | 聚合查询 IP 信息 / Query IP info | 否 No |
| `/api/geocode?lat=xx&lon=xx` | GET | 反向地理编码 / Reverse geocode | 否 No |
| `/api/seo` | GET | 获取 SEO 配置 / Get SEO config | 否 No |
| `/api/admin/login` | POST | 管理员登录 / Admin login | 否 No |
| `/api/admin/settings` | GET/PUT | 获取/更新设置 / Get/Update settings | ✅ |
| `/api/admin/logout` | POST | 登出 / Logout | ✅ |

## 🔑 数据源说明 / Data Sources

### AbuseIPDB
- 需要 API Key（免费注册 / Free registration）
- 提供安全威胁评分、举报次数、Tor 检测
- **支持多 Key 轮询**，提升限额
- 注册: https://www.abuseipdb.com/account/plans

### dklyIPdatabase
- 需要 API Key
- 提供最详细信息：VPN/Proxy/Tor/威胁检测、精确经纬度、邮编
- 文档: https://ipinfo.dkly.net/documentation/

### OpenStreetMap Nominatim
- **免费**，无需 API Key
- 反向地理编码，将经纬度转换为街道地址
- 限制: 每秒 1 次请求
- 文档: https://nominatim.org/release-docs/develop/api/Reverse/

## 📄 License

MIT © [logdns](https://github.com/logdns)
