# 公开车型与服务项目参考目录

V0.8.5 目录版本：`2026-11-05.1`；车型来源沿用2026-11-04快照，新增服务来源核对日期为2026-11-05。

本次在历史基础目录上补充现代资料。配置来源导航：

- [历史配置与首批官方参数](vehicle-variants-sources.md)：保留原有 MIT 历史数据及初始官方配置说明。
- [现代车型与历史归档补充](vehicle-variants-modern.md)：PyLab.me CC BY 4.0 数据中的多品牌近年配置。
- [比亚迪近期年款](vehicle-variants-byd-recent.md)：2024—2026 款公开逐车型事实及官网同列参数，包含海狮06。
- [最新车型配置补充](vehicle-variants-latest.md)：其他近期车型的来源、核对方式与限制。

系统预置的是可搜索、可选择的参考目录。管理员选择车系与有依据的实际年款／动力／配置，或人工补充未覆盖的配置后，可导入正式车型档案，保养适用范围可先保持待手册核对；服务项目可以选择后导入平台的标准服务项目目录。每个候选保留来源 ID，来源记录包含 URL、版本、核对日期和使用说明。

基础车系快照包含 **3220 个车系候选、287 个品牌名称**，由 3129 条历史数据与 91 条官网补充数据组成；服务目录在原53个模板上新增67个，现为 **120 个服务项目参考模板、13分类**。V0.8.1 另合并有有效配置依据的现代车系与近期补充，基础快照的数量不代表合并后总量。“品牌数量”包括进口、历史和部分商用品牌，不是当前中国在售品牌统计。实际配置包括 29,169 条严格筛选的历史年款／动力／配置，以及各自标注来源的现代公开数据和官网事实；当前车系、年款、配置总量及来源记录数量以目录和对应补充说明为准。车系名称不能独立证明精确配置，配置候选也不能代替 VIN 核验或当前在售状态查询。

年代需要区分：基础 MIT 数据导出于 **2018-05-06**，明确年款为 1999—2019；现代补充从其固定 CSV 与归档记录中读取明确的 2019—2026 款，近期公开页面另按明确年款核对。仓库提交时间、归档月份、官网更新日期、查阅日期与手册文件名均不能替代车型年款。部分车系仍有年份或配置断档，未收录不等于车型或年款不存在。

## 车型来源与覆盖范围

### MIT 历史数据

- 仓库：[utf6/Cars_Data](https://github.com/utf6/Cars_Data)。
- 固定提交：[`6ef6168838cf0ec9ebfb9442b4203e7706edbad8`](https://github.com/utf6/Cars_Data/tree/6ef6168838cf0ec9ebfb9442b4203e7706edbad8)，提交时间 2020-10-15。
- 实际数据时间：两个 SQL 文件头均标注 **2018-05-06**；不能将仓库提交日期当作车型更新时间。
- 输入：`sql/品牌表.sql`（284 个品牌）及 `sql/车系表.sql`（3180 行车系）。只解析字符串数据，未执行来源 SQL。
- 输出：仅保留品牌、车系名称、稳定来源 ID；不带图片、Logo、报价、销售状态和参数表。
- 清洗：去掉名称前重复的品牌；剔除名称明确含“概念”“原型”“Concept”“Prototype”“BETA版”的 46 行；按品牌、名称的 NFKC、忽略空格和大小写去重，官网补充条目优先，去掉 5 行重复项，得到 3129 条历史候选。
- 限制：包含停产、历史及名称发生变化的车系；简单名称清洗不构成量产、当前在售或适用配置的核验。仍需对照车辆与官方资料确认。
- 授权：来源仓库标注 MIT，本仓库保留[原始版权与许可文本](licenses/Cars_Data-LICENSE.txt)。部署镜像应一并保留该文本。没有采集或复用其第三方图片。

两个输入文件 UTF-8 文本的 SHA-256：

```text
品牌表.sql  3e1fd124aca6d9c7f688aed6da9598428ae336e2c4ab66f2476ae05821dbe1ba
车系表.sql  870a3a4b6d2289b25496176814365c9c833fd7a74f5e151f2e613a9afd7ecb34
```

### 基础快照中官网补充的 91 个车系

2026-11-04 人工核对以下公开官网的车型导航或公开车型入口，仅摘录短名称事实；未批量抓取商业汽车目录、图片或参数库。为保持车系层级一致，对同车系的年款、动力及营销版本进行了归并，例如“2026款秦L DM-i”“秦L EV”作为“秦L”候选，具体动力由管理员按车辆确认。归并名称是本系统的候选名称，不声明为厂家的配置编码。

| 来源 | 数量 | 本版候选名称 |
|---|---:|---|
| [比亚迪](https://www.byd.com/cn) | 22 | 汉、汉L、唐、唐L、秦PLUS、秦L、秦MAX、宋Pro、宋L、宋Ultra、元UP、元PLUS、夏、海豹、海豹06、海豹07、海豹08、海狮05、海狮06、海狮08、海鸥、海豚 |
| [腾势](https://www.tengshiauto.com/) | 7 | N8、N8L、N9、Z9S、Z9GT、Z、D9 |
| [方程豹](https://www.fangchengbao.com/) | 4 | 豹5、豹8、钛3、钛7 |
| [仰望](https://www.yangwangauto.com/) | 4 | U7、U8、U8L、U9 |
| [特斯拉中国](https://www.tesla.cn/) | 4 | Model 3、Model Y、Model S、Model X |
| [理想](https://www.lixiang.com/) | 7 | L6、L7、L8、L9、MEGA、i6、i8 |
| [蔚来](https://www.nio.cn/) | 9 | ET5、ET5T、ET7、ET9、EC6、EC7、ES6、ES8、ES9 |
| [小鹏](https://www.xiaopeng.com/) | 11 | MONA L05、G9L、MONA L03、GX、MONA M03、P7、G6、X9、P7+、G7、G9 |
| [小米汽车](https://www.xiaomiev.com/) | 3 | SU7、YU7、SU7 Ultra |
| [问界 AITO](https://aito.auto/) | 5 | M5、M6、M7、M8、M9 |
| [极氪](https://www.zeekrlife.com/) | 9 | MIX、7X、007、007GT、001、009、9X、X、8X |
| [零跑](https://www.leapmotor.com/) | 6 | C01、C11、C16、C10、T03、B10 |

极氪依据官网公开导航资源 `app.4b09d485.js`，零跑依据官网公开车型入口资源 `main.3480088c.js`。其余来源从 HTML、公开导航配置或页面车型入口核对。仅保存选定的名称事实；页面版权仍归原权利人，来源字段中“官方公开网页”不是对整站内容的开源许可声明。目录不代表这些品牌全部车型，也不保证列示车型在中国当前可订购、在售或交付。

## 实际年款、动力与配置来源

配置记录与车系候选分开保存，通过 `modelCatalogId` 关联。每条记录将 `year`、`power`、`trim`、来源 ID 与 `sourceEvidence` 绑定，必要时保存来源明确的厂商名称。导入时按所选配置 ID 派生档案字段，不将不同页面或不同记录的字段任意拼接。

历史配置来自同一 MIT 仓库、同一固定提交的 [`sql/车型表.sql`](https://github.com/utf6/Cars_Data/blob/6ef6168838cf0ec9ebfb9442b4203e7706edbad8/sql/%E8%BD%A6%E5%9E%8B%E8%A1%A8.sql)，数据导出日期为 2018-05-06。源码构建脚本将来源 SQL 当作文本解析，校验固定 SHA-256，不执行来源 SQL，也不导入原库结构。筛选条件包括车系及品牌可匹配、明确的年代款与车型名称年款相符、动力字段可用、具体配置非空、没有显式概念／原型标记，并按显示身份去重。保留 29,169 条，明确年款范围为 1999–2019；2018 年快照出现 2019 款不等于数据库在 2019 年更新。

```text
车型表.sql  4207ba72d832f8ce2fe446e0a90f0c91ed6be26b8a55fee173dd927513801ad3
```

历史燃油配置使用同一行的燃料、发动机与可用变速箱信息，纯电配置要求同一行明确电机总功率；原文依据记录这些字段与配置名称。没有明确年款、动力或存在冲突的记录不根据登记日期、下载日期、价格或手册文件名补值。历史库包含停产、进口和商用配置，完整参数表、照片与价格未作为本次候选分发。

V0.8.1 的较新车型还使用有明确数据许可的结构化公开快照、近期公开逐车型记录及官网配置表；每条仍须明确支持年款、动力和具体版本组合。导航中的车系短名、孤立功率数字或文件发布日期不足以形成配置记录。基础官方配置见 [车型配置来源说明](vehicle-variants-sources.md)，新增输入、署名许可、清洗与来源优先级分别见 [现代车型](vehicle-variants-modern.md)、[比亚迪近期年款](vehicle-variants-byd-recent.md) 及 [最新车型配置](vehicle-variants-latest.md)。历史、现代和官网事实使用不同来源记录、版本、查阅日期及许可说明，后续继续增量核对，不宣称覆盖全市场。

## 服务项目的实际依据

“标准服务项目”是本系统内部统一项目名称的目录。预置项目属于参考模板，不声称是国家标准全文、厂家认证套餐或所有车型必做项目。检查、更换、清洁和润滑使用不同条目，避免将一次检查自动变成更换或收费项目。

| 来源 | 实际核对内容 | 归纳范围 |
|---|---|---|
| [比亚迪官方第二代海鸥用户手册](https://www.byd.com/material/__CN/domestic-official/user-manual/ocean/第二代海鸥用户手册260120.pdf) | PDF 物理页318–322，保养表与相邻条件说明 | 制动、转向悬架、轮胎、冷却液、齿轮油、高压系统外观、充电接口、车灯、雨刮紧固、车门限位器等短项目事实 |
| [比亚迪官方2026款秦L DM-i用户手册](https://www.byd.com/material/domestic-official/user-manual/dynasty/2026款秦L%20DM-i用户手册20260417.pdf) | PDF 物理页354–359；物理358页已实际渲染核对 | 发动机机油及机滤、空气滤芯、火花塞、燃油滤清器、PCV、怠速、碳罐灰尘过滤器等 |
| [特斯拉中国：车辆保养](https://www.tesla.cn/support/vehicle-maintenance) | 2026-11-04 公开页面 | 空调滤清器、HEPA、轮胎换位、动平衡、定位、制动钳清洁与润滑、制动液检测、散热器清洁等 |
| [大众美国：Service Xpress](https://www.vw.com/en/owners-and-services/service-and-maintenance/express-service.html) | 2026-11-04 公开页面 | 机油机滤、空气滤芯、座舱滤芯、雨刮、低压电池检测/更换、外部灯泡等短项目事实 |
| [大众美国：Genuine Volkswagen Service](https://www.vw.com/en/owners-and-services/service-and-maintenance/genuine-volkswagen-service.html) | 2026-11-04 公开页面 | 轮胎、制动检查等通用服务名称参考 |
| [博世汽车专业维修英国：常规服务](https://www.boschcarservice.com/gb/en/services/inspection-and-checks/car-servicing/)及相关服务页 | 2026-11-05 核对13个页面，独立来源ID以 `bosch-service-` 开头 | 机油机滤、制动片与盘、轮胎、空调、变速器及油液、正时皮带、减振器、离合器、新能源检查、车辆诊断和ADAS标定 |
| [Jiffy Lube 美国：服务目录](https://www.jiffylube.com/auto-services)、[油液补充](https://www.jiffylube.com/auto-services/fluids/fluid-top-off)、[制动检查](https://www.jiffylube.com/auto-services/brakes/brake-inspection)、[胎压监测](https://www.jiffylube.com/auto-services/tires/tire-pressure-monitoring-system-services) | 2026-11-05 核对4个来源及目录链接的公开服务范围 | 附件皮带、燃油清洁、冷却液、变速器滤清器、差速器／分动箱油、蓄电池端子、灯具、风挡、柴油尾气处理液等短服务事实 |
| [Firestone 美国：蓄电池服务](https://www.firestonecompleteautocare.com/maintain/batteries/) | 2026-11-05 公开页面 | 低压蓄电池连接、充电性能及启动相关检测范围 |
| 特斯拉中国Model 3手册：[雨刮与清洗液](https://www.tesla.cn/ownersmanual/model3/zh_cn/GUID-197C481B-B4D4-4973-9772-2AF488442CE1.html)、[安全带](https://www.tesla.cn/ownersmanual/model3/zh_cn/GUID-3319C55D-F148-4D9C-98A6-AD09BA7EED61.html)、[清洁](https://www.tesla.cn/ownersmanual/model3/zh_cn/GUID-65384C1F-86F2-44E8-A8BC-8A12E7E00A40.html)、[轮胎养护](https://www.tesla.cn/ownersmanual/model3/zh_cn/GUID-94F63B13-EA2C-45D9-83AB-5DCA6295D587.html) | 2026-11-05 核对4个中文手册页面 | 雨刮、喷嘴、清洗液、安全带、车身内外与底盘清洁、胎压传感器等短项目事实 |

秦L 文件通过[比亚迪官方手册页面](https://www.byd.com/cn/user-manual)对应的公开搜索接口，以“秦L DM”为关键词、仅查询前5项找到；实际 PDF 为 25,906,432 字节、410页。海鸥 PDF 为 22,178,816 字节、364页，其文件名的 `260120` 不能独立证明车型年款或配置适用性。

条目描述由本项目自行转述，只保存简短的部件、动作与用途事实；不在参考目录中分发手册原文、保养表图片或全文副本。英国、美国官网仅用于服务名称参考，未迁移其价格、周期、法规阈值、促销政策或质保承诺，也未迁移为中国车型的官方保养规则。V0.8.5新增22条来源记录，每个项目通过 `sourceIds` 引用依据；完整URL、版本、日期和使用边界见 [来源数据](../apps/api/src/data/catalog-sources.json)，逐项目对应关系见 [项目数据](../apps/api/src/data/catalog-projects.json)。

120个模板的分类数量为：发动机13、滤清器7、制动系统12、轮胎车轮12、底盘转向9、冷却系统6、新能源系统10、传动系统10、电气系统9、车身附件19、空调系统5、故障诊断7、排放系统1。故障诊断内部分类值为 `diagnosis`，用于与周期保养匹配区分。项目单位默认“次”是系统管理单位，管理员应按实际服务调整；它不表示配件数量、工时或价格。

## 导入与规则之间的边界

- 选择车系后，优先核对并选择有明确来源的实际配置；没有匹配候选时由管理员依据车辆资料人工填写年款与动力，不能把未知值伪装成公开配置事实。
- 新建车型可先保留“适用项目待核实”；未知范围不能被当作“已核实没有保养项目”。
- 选择服务项目模板只创建项目名称、描述、分类、单位和来源，不创建门店报价或车型适用关系。
- 参考服务项目不含保养周期、首次周期、价格、统一配件用量或车型适用关系。保养提醒仍通过对应车型的手册导入、证据审核和规则发布产生。
- 同名车型不能只凭车系名称共用手册；同名服务项目也不能覆盖既有人工编辑内容。

## 文件与后续维护

```text
apps/api/src/data/catalog-models.json    车系候选数组
apps/api/src/data/catalog-variants.json  有来源的实际年款、动力与配置数组
apps/api/src/data/catalog-projects.json  服务项目参考数组
apps/api/src/data/catalog-sources.json   来源与版本数组
scripts/build-vehicle-variant-catalog.mjs  固定历史来源的校验与筛选脚本
docs/licenses/Cars_Data-LICENSE.txt      历史库原始 MIT 许可
```

所有 ID 保持稳定：历史车系使用 `utf6-series-原车系ID`，历史配置使用 `utf6-model-原车型ID`；官网名称使用来源命名空间及名称哈希；服务项目使用语义 ID。更新来源时需提高目录版本，重新核验短名称、来源 URL、日期、去重与引用完整性；不得把新来源覆盖为既有车型已经核实的配置或规则。历史重建脚本会重写历史配置输出，维护者追加官网配置时须一并保留并校验增量来源，不能直接用历史输出覆盖现有官网补充。

本版数据一致性核验：四个数组的 ID 均唯一；所有 `sourceId`/`sourceIds` 及配置的 `modelCatalogId` 引用存在；配置的明确年款、动力、名称与证据非空；项目动作属于允许枚举。车系候选仍不携带推测年款／动力，项目未含周期、价格或车型适配字段。使用流程及配置导入契约见 [公开目录](public-catalog.md) 与 [API](api.md#公开车型与参考服务项目)。
