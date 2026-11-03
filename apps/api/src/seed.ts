import type {
  Appointment,
  CarModel,
  Fault,
  MaintenanceRule,
  Offer,
  Project,
  Slot,
  Store,
  User,
  Vehicle,
} from "@autovoyage/shared";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { get, put } from "./db.js";
import { hashPassword, now, shanghaiDay } from "./domain.js";
export interface StoredUser extends User {
  passwordHash: string;
  active: boolean;
}
export async function seed(db: Database, config: Config) {
  if (!config.seedDemo) return;
  if (await get(db, "users", "owner-demo")) {
    await seedDiagnosis(db);
    return;
  }
  const passwordHash = await hashPassword(config.demoPassword);
  await db.transaction(async (sql) => {
    const users: StoredUser[] = [
      {
        id: "owner-demo",
        name: "云程体验官",
        email: "owner@autovoyage.demo",
        role: "owner",
        storeId: null,
        passwordHash,
        active: true,
      },
      {
        id: "store-demo",
        name: "王店长",
        email: "store@autovoyage.demo",
        role: "store_admin",
        storeId: "store-coast",
        passwordHash,
        active: true,
      },
      {
        id: "expert-demo",
        name: "陈工",
        email: "expert@autovoyage.demo",
        role: "expert",
        storeId: "store-coast",
        passwordHash,
        active: true,
      },
      {
        id: "admin-demo",
        name: "平台管理员",
        email: "admin@autovoyage.demo",
        role: "platform_admin",
        storeId: null,
        passwordHash,
        active: true,
      },
    ];
    for (const user of users) await put(sql, "users", user);
    const models: CarModel[] = [
      {
        id: "model-sedan",
        brand: "大众",
        name: "迈腾 · 课程演示车型",
        year: 2024,
        power: "燃油 · 2.0T",
        applicableProjectIds: ["project-oil", "project-cabin", "project-brake"],
        isDemo: true,
      },
      {
        id: "model-electric",
        brand: "比亚迪",
        name: "海豹 · 课程演示车型",
        year: 2024,
        power: "纯电动",
        applicableProjectIds: ["project-cabin", "project-brake"],
        isDemo: true,
      },
    ];
    for (const model of models) await put(sql, "models", model);
    const projects: Project[] = [
      {
        id: "project-oil",
        code: "OIL_FILTER",
        name: "机油与机滤",
        category: "基础保养",
        description: "更换发动机机油与机油滤清器；以适配材料方案为准",
        unit: "次",
        active: true,
      },
      {
        id: "project-cabin",
        code: "CABIN_FILTER",
        name: "空调滤清器",
        category: "舒适养护",
        description: "更换空调滤芯并检查安装密封",
        unit: "次",
        active: true,
      },
      {
        id: "project-brake",
        code: "BRAKE_CHECK",
        name: "制动系统检查",
        category: "安全检查",
        description: "检查制动片、制动盘及相关管路；更换零件另行确认",
        unit: "次",
        active: true,
      },
      {
        id: "project-diagnosis",
        code: "FAULT_DIAGNOSIS",
        name: "故障到店诊断",
        category: "diagnosis",
        description:
          "到店检查故障并出具建议；不包含维修材料、工时或后续维修总价",
        unit: "次",
        active: true,
      },
    ];
    for (const project of projects) await put(sql, "projects", project);
    for (const model of models)
      for (const project of projects.filter(
        (p) =>
          p.category !== "diagnosis" &&
          (model.id === "model-sedan" || p.id !== "project-oil"),
      )) {
        const rule: MaintenanceRule = {
          id: `rule-${model.id}-${project.id}`,
          modelId: model.id,
          projectId: project.id,
          intervalMonths: project.id === "project-cabin" ? 12 : 6,
          intervalKm: project.id === "project-cabin" ? 10000 : 5000,
          firstMonths: 6,
          firstKm: 5000,
          mileageType: "total_km",
          sourceTitle: "课程演示规则（非官方手册，不作为真实车辆保养依据）",
          sourceUrl: "",
          version: 1,
          verified: true,
          isDemo: true,
        };
        await put(sql, "rules", rule);
      }
    const stores: Store[] = [
      {
        id: "store-coast",
        name: "云程养车 · 海岸店",
        type: "chain",
        address: "青岛市崂山区松岭路（课程演示位置）",
        phone: "0532-00000001",
        lat: 36.158,
        lng: 120.491,
        coordinateSystem: "WGS84",
        hours: "09:00—18:00",
        approved: true,
        isDemo: true,
        description:
          "海风为伴，安心养车。提供基础保养、故障检查与车辆养护服务。",
      },
      {
        id: "store-city",
        name: "匠心汽车服务 · 城阳店",
        type: "independent",
        address: "青岛市崂山区辽阳东路（课程演示位置）",
        phone: "0532-00000002",
        lat: 36.111,
        lng: 120.466,
        coordinateSystem: "WGS84",
        hours: "08:30—18:30",
        approved: true,
        isDemo: true,
        description: "专注车辆基础养护，所有费用明细透明展示。",
      },
      {
        id: "store-mountain",
        name: "山海汽车养护 · 金家岭店",
        type: "independent",
        address: "青岛市崂山区仙霞岭路（课程演示位置）",
        phone: "0532-00000003",
        lat: 36.099,
        lng: 120.479,
        coordinateSystem: "WGS84",
        hours: "09:00—19:00",
        approved: true,
        isDemo: true,
        description: "预约到店，逐项确认，陪伴每一次出发。",
      },
    ];
    for (const store of stores) await put(sql, "stores", store);
    const day = shanghaiDay();
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() - 10);
    const startDate = shanghaiDay(date);
    const vehicles: Vehicle[] = [
      {
        id: "vehicle-sedan",
        ownerId: "owner-demo",
        modelId: "model-sedan",
        plate: "鲁B·YC001",
        name: "我的迈腾",
        startDate,
        initialKm: 0,
        totalKm: 28640,
        observedAt: now(),
        isDemo: true,
      },
      {
        id: "vehicle-electric",
        ownerId: "owner-demo",
        modelId: "model-electric",
        plate: "鲁B·YC002",
        name: "海边的海豹",
        startDate: day,
        initialKm: 0,
        totalKm: 1680,
        observedAt: now(),
        isDemo: true,
      },
    ];
    for (const vehicle of vehicles) await put(sql, "vehicles", vehicle);
    for (const [storeIndex, store] of stores.entries())
      for (const model of models)
        for (const project of projects.filter(
          (p) => model.id === "model-sedan" || p.id !== "project-oil",
        )) {
          const oil = project.id === "project-oil";
          const cabin = project.id === "project-cabin";
          const materialCents = oil
            ? 26800 + storeIndex * 2000
            : cabin
              ? 9800 + storeIndex * 1000
              : 0;
          const laborCents = oil ? 8000 : cabin ? 3000 : 8000;
          const offer: Offer = {
            id: `offer-${store.id}-${model.id}-${project.id}`,
            storeId: store.id,
            modelId: model.id,
            projectId: project.id,
            title: project.name,
            materialSpec: oil
              ? "演示方案 S1：5W-30 全合成 4L + 适配机滤"
              : cabin
                ? "演示方案 S2：适配活性炭滤芯 1件"
                : project.category === "diagnosis"
                  ? "演示方案 D1：到店基础故障诊断 1次"
                  : "演示方案 S3：制动系统检查 1次",
            includes: project.description,
            excludes: "额外材料与维修项目需单独确认",
            taxIncluded: true,
            priceType: "fixed",
            materialCents,
            laborCents,
            otherCents: 0,
            totalCents: materialCents + laborCents,
            lowCents: null,
            highCents: null,
            version: 1,
            validFrom: day,
            validTo: `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`,
            active: true,
            isDemo: true,
          };
          await put(sql, "offers", offer);
          await put(sql, "offer_versions", {
            ...offer,
            id: `${offer.id}:1`,
            offerId: offer.id,
          });
        }
    for (const store of stores)
      for (let days = 1; days <= 7; days++)
        for (const hour of [9, 11, 14, 16]) {
          const d = new Date(`${day}T00:00:00+08:00`);
          d.setUTCDate(d.getUTCDate() + days);
          d.setUTCHours(hour - 8);
          const ends = new Date(d.getTime() + 3600000);
          const slot: Slot = {
            id: `slot-${store.id}-${days}-${hour}`,
            storeId: store.id,
            startsAt: d.toISOString(),
            endsAt: ends.toISOString(),
            capacity: 3,
            reserved: 0,
            active: true,
          };
          await put(sql, "slots", slot);
        }
    const oldDate = new Date();
    oldDate.setUTCMonth(oldDate.getUTCMonth() - 5);
    await put(sql, "records", {
      id: "record-demo-oil",
      vehicleId: "vehicle-sedan",
      appointmentId: "history-demo",
      projectId: "project-oil",
      completedAt: oldDate.toISOString(),
      totalKm: 24000,
      source: "课程合成历史数据（非实车服务）",
      totalCents: 34800,
    });
    await put(sql, "messages", {
      id: "message-welcome",
      userId: "owner-demo",
      title: "你好，欢迎来到云程",
      body: "让每一程都有照应。当前车型、门店、里程和价格均为课程演示数据。",
      type: "system",
      readAt: null,
      createdAt: now(),
      link: "/",
    });
    const fault: Fault = {
      id: "fault-demo",
      ownerId: "owner-demo",
      vehicleId: "vehicle-sedan",
      storeId: "store-coast",
      assignedExpertId: "expert-demo",
      title: "空调有轻微异味",
      description: "课程演示：打开空调前两分钟有轻微异味，制冷正常。",
      conditions: "车辆停放一晚后首次开空调",
      occurredAt: now(),
      imageUrls: [],
      status: "replied",
      reply:
        "建议到店检查空调滤清器和蒸发箱。仅凭描述不能确定故障原因，实际项目与费用须现场确认。",
      estimateLowCents: 12800,
      estimateHighCents: 28000,
      diagnosisCents: 0,
      uncertainty: "是否需要清洗蒸发箱需现场检查；本记录为课程演示。",
      confirmed: false,
      createdAt: now(),
    };
    await put(sql, "faults", fault);
  });
}
// Additive upgrade for an earlier local demo seed; never replaces existing user, quote, or booking data.
async function seedDiagnosis(db: Database) {
  await db.transaction(async (sql) => {
    for (const [modelId, applicableProjectIds] of Object.entries({
      "model-sedan": ["project-oil", "project-cabin", "project-brake"],
      "model-electric": ["project-cabin", "project-brake"],
    })) {
      const model = await get<CarModel>(sql, "models", modelId, true);
      if (model?.isDemo && model.applicableProjectIds === undefined)
        await put(sql, "models", { ...model, applicableProjectIds });
    }
    if (!(await get(sql, "projects", "project-diagnosis")))
      await put(sql, "projects", {
        id: "project-diagnosis",
        code: "FAULT_DIAGNOSIS",
        name: "故障到店诊断",
        category: "diagnosis",
        description:
          "到店检查故障并出具建议；不包含维修材料、工时或后续维修总价",
        unit: "次",
        active: true,
      });
    const day = shanghaiDay();
    for (const storeId of ["store-coast", "store-city", "store-mountain"])
      for (const modelId of ["model-sedan", "model-electric"]) {
        if (
          !(await get(sql, "stores", storeId)) ||
          !(await get(sql, "models", modelId))
        )
          continue;
        const offerId = `offer-${storeId}-${modelId}-project-diagnosis`;
        if (await get(sql, "offers", offerId)) continue;
        const offer: Offer = {
          id: offerId,
          storeId,
          modelId,
          projectId: "project-diagnosis",
          title: "故障到店诊断",
          materialSpec: "演示方案 D1：到店基础故障诊断 1次",
          includes: "到店检查故障并出具建议",
          excludes: "不包含维修材料、工时或后续维修总价",
          taxIncluded: true,
          priceType: "fixed",
          materialCents: 0,
          laborCents: 8000,
          otherCents: 0,
          totalCents: 8000,
          lowCents: null,
          highCents: null,
          version: 1,
          validFrom: day,
          validTo: `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`,
          active: true,
          isDemo: true,
        };
        await put(sql, "offers", offer);
        await put(sql, "offer_versions", {
          ...offer,
          id: `${offer.id}:1`,
          offerId: offer.id,
        });
      }
  });
}
