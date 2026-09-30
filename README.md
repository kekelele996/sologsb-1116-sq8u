# 野生菌采集鉴定图谱（gbfungiguide）

面向蘑菇野外调查爱好者与地方菌物名录整理者，把「采集点 → 形态描述 → 孢子印 → 菌褶/菌管着生方式 → 鉴定结论」整理成可对照的图谱条目，解决形态特征记不全、描述口径不一、鉴定结论缺乏依据留痕的问题。**纯前端单页应用**，数据全部保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

> 免责声明：本工具仅用于采集记录与形态整理，**内容不可作为食用依据**；鉴定须与权威图鉴和专业人员复核。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21816>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbfungiguide
FRONTEND_PORT=21816
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3（Composition API） |
| 语言 | TypeScript（`vue-tsc` 类型检查零错误） |
| UI 组件库 | Element Plus |
| 状态管理 | Zustand（`zustand/vanilla` createStore + Vue 响应式桥接） |
| 路由 | Vue Router 4（History 模式，nginx `try_files` 回落） |
| 构建 | Vite 6 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21816
npm run build      # 类型检查 + 生产构建
```

## 四、目录结构

```
sologsb-1116/
├── docker-compose.yml          # 顶层 name: gbfungiguide，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # record.ts / spore.ts / point.ts / identify.ts / index.ts
│       ├── stores/             # recordStore / sporeStore / pointStore / identifyStore（Zustand）
│       ├── components/common/  # SporePrintSwatch / TraitsSummary / GillAttachmentTag / GeoPointForm
│       ├── hooks/              # usePersistentStore / useCandidateMatch
│       ├── pages/              # AtlasPage / RecordDetailPage / PointsPage / IdentifyPage / ComparePage
│       ├── router/index.ts
│       └── utils/              # spore.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| FungusRecord 菌物条目 | 采集编号、暂定名、菌盖（直径/形状/边缘/质地）、菌肉厚度与变色反应、着生方式、菌褶密度、菌柄、菌环菌托、气味、关联树种 | `records` |
| SporePrint 孢子印 | 印色、印形、获取时长、观察日期、样本干湿度 | `spores` |
| CollectPoint 采集点 | 地点名、经纬度、海拔、植被类型、基物、伴生树种、日期、采集人 | `points` |
| IdentifyLog 鉴定结论 | 结论学名、依据、参考图鉴与页码、置信度、是否待复核、复核人 | `identifies` |

- 数据库名 `gbfungiguide`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史条目补齐「菌肉变色反应」默认值（不变色）；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/atlas` | 图谱总览：网格卡片展示菌盖形态要点、孢子印色块与鉴定状态，按印色/着生方式筛选并新建条目 |
| `/atlas/:id` | 条目详情：形态描述分区折叠、孢子印观察登记、采集点编辑（含坐标校验）、鉴定留痕 |
| `/points` | 采集点管理：经纬度格式校验、条目数与主要基物统计、删除前校验下级条目 |
| `/identify` | 鉴定工作页：左侧勾选形态特征与印色，右侧实时给出候选名录排序，确认后落鉴定结论 |
| `/sync` | 外业批次合并：导入同伴平板的离线批次，按采集编号并库，冲突逐条认、失败回滚重试、幂等不重复 |
| `/compare` | 条目对比：并排最多 3 条，逐项对照菌盖/菌褶菌管/孢子印差异并高亮 |

## 七、候选排序规则

- 权重：着生方式 26、孢子印 22、菌盖形状 12、表面质地 10、菌褶密度 10、菌盖边缘 8、菌肉反应 8、关联树种 4；
- 印色与条目着生方式若属于该印色的先验组合（如白色↔离生/弯生），计半分；
- 排序先比总分，总分相同则优先展示着生方式一致的条目；
- 候选排序是 Vue `computed` 响应式派生：外业合并或逐条改判写入了新的着生方式后，候选排序即时重算，无需刷新。

## 八、外业离线批次合并

同伴带平板进山离线登记，回驻地把批次 JSON 导入 `/sync` 与图谱库合并（`gbfungiguide-field-batch` v1 格式）。

**字段分组裁决（同一采集编号两边都动过）**

| 分组 | 取哪一侧 | 是否可逐条改判 |
| --- | --- | --- |
| 形态描述（含着生方式、菌盖/菌肉/菌柄等） | **外业那份** | 可（取外业 / 取图谱库） |
| 孢子印 | **外业那份** | 可；两版印都保留在库，改判只切换 `recordId` 指向 |
| 鉴定留痕 | **图谱库那份** | 锁定，外业留痕不并入同号条目 |
| 采集点 | **图谱库那份** | 锁定，外业点信息不覆盖 |

- **两版都留着**：冲突行保存图谱库与外业的完整快照（条目/孢子印/留痕/采集点），在页面上逐条对照、逐条认；
- **失败保护**：合并前先把本地上一版四表快照写入 `mergeBackups`，合并在单个 Dexie 事务内原子完成；中途任何一步失败都整体回滚到本地上一版，批次标记为「失败待重试」；
- **按外业侧重试**：失败批次的外业载荷保存在 `batches` 表，一键按外业批次这一侧重建计划重试；
- **幂等不多条**：批次以 `batchId` 守卫，已合并批次再送直接拒绝；批次内条目/孢子印/采集点/留痕主键由 `batchId + 采集编号/内容` 确定性派生，冲突行主键按 `batchId + code`，同一批次重试运行不产生重复条目；
- **一侧缺孢子印**：外业没做印则保留图谱库那份，图谱库没做印则补登外业那份，均不算冲突。

相关表：`batches`（批次载荷与状态）、`conflicts`（冲突两版快照与裁决）、`mergeBackups`（合并前快照）。

## 九、数据库版本

- v2：为历史条目补「菌肉变色反应」默认值（不变色）；
- v3：新增外业批次合并三表，**旧表结构与数据原样保留**——历史孢子印记录在升级后一条不丢（有 `v1 → v3` 迁移测试守护）。

## 十、测试

```bash
cd frontend
npm test        # vitest run：合并裁决/幂等/回滚重试/候选重算/升级保孢子印
```
