import { useEffect, useState } from "react";
import {
  Camera,
  CheckCircle2,
  FileImage,
  ImagePlus,
  RefreshCw,
  ScanLine,
  Upload,
  ArrowLeft,
  ArrowRight,
  PencilLine,
  ShieldCheck,
} from "lucide-react";
import type {
  Bootstrap,
  CarModel,
  ImportJob,
  Vehicle,
} from "@autovoyage/shared";
import { api, post } from "../lib/api";
import {
  Modal,
  ErrorBox,
  dateInput,
  localTimeInput,
  asDateTime,
  dateText,
  messageOf,
  Loading,
} from "./UI";
import RegistrationCertificate from "./RegistrationCertificate";

export function VehicleEditor({
  models,
  onClose,
  onSaved,
}: {
  models: CarModel[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [method, setMethod] = useState<"choose" | "registration" | "manual">(
    "choose",
  );
  if (method === "registration")
    return (
      <RegistrationCertificate
        models={models}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  if (method === "manual")
    return (
      <ManualVehicleEditor
        models={models}
        onClose={onClose}
        onSaved={onSaved}
        onBack={() => setMethod("choose")}
      />
    );
  return (
    <Modal
      title="添加我的爱车"
      subtitle="从一张行驶证开始，为爱车建立完整档案。"
      onClose={onClose}
    >
      <div className="vehicle-entry-options">
        <button
          className="vehicle-entry-option"
          onClick={() => setMethod("registration")}
        >
          <ScanLine size={26} aria-hidden="true" />
          <span>
            <strong>行驶证识别建档</strong>
            <small>
              上传正页，自动读取车辆信息
              <br />
              核对后再保存，省去逐项输入
            </small>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <button
          className="vehicle-entry-option"
          onClick={() => setMethod("manual")}
        >
          <PencilLine size={26} aria-hidden="true" />
          <span>
            <strong>手动填写车辆信息</strong>
            <small>
              选择车型，填写车牌与车辆启用信息
              <br />
              行驶证资料可以稍后补充
            </small>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="vehicle-entry-privacy">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          行驶证照片和证件档案仅本人可查看。识别内容需经你核对确认，不会直接成为有效里程。
        </span>
      </p>
    </Modal>
  );
}

function ManualVehicleEditor({
  models,
  onClose,
  onSaved,
  onBack,
}: {
  models: CarModel[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="手动建立车辆档案"
      subtitle="建立车辆档案，让每一次服务都有据可查。"
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await post("/vehicles", {
              modelId: values.get("modelId"),
              plate: values.get("plate"),
              name: values.get("name"),
              startDate: values.get("startDate"),
              initialKm: Number(values.get("initialKm")),
            });
            await onSaved();
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <button type="button" className="text-btn" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          选择其他建档方式
        </button>
        <label>
          车型配置
          <select name="modelId" required>
            <option value="">请选择车型</option>
            {models.map((m) => (
              <option value={m.id} key={m.id}>
                {m.brand} {m.name} · {m.year}款 {m.power}
                {m.isDemo ? "（演示车型）" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            车辆昵称
            <input
              name="name"
              required
              maxLength={40}
              placeholder="例如：我的小蓝"
            />
          </label>
          <label>
            车牌号码
            <input
              name="plate"
              required
              maxLength={12}
              placeholder="鲁B · XXXXX"
              autoCapitalize="characters"
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            启用日期
            <input
              type="date"
              name="startDate"
              max={dateInput()}
              required
              defaultValue={dateInput()}
            />
          </label>
          <label>
            启用时里程（km）
            <input
              type="number"
              name="initialKm"
              required
              min="0"
              max="2000000"
              step="1"
              defaultValue="0"
            />
          </label>
        </div>
        <p className="form-hint">
          启用时里程用于建立保养起点。当前里程请通过截图或仪表照片上传、核对确认后更新。
        </p>
        <ErrorBox message={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "正在保存…" : "建立车辆档案"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const importStatus: Record<ImportJob["status"], string> = {
  uploaded: "图片已上传",
  processing: "正在识别图片",
  awaiting_confirmation: "请核对识别结果",
  confirmed: "里程已确认入库",
  failed: "本次识别未完成",
  review: "需要核对图片信息",
};
export function ImportMileage({
  vehicle,
  data,
  initialJobId,
  onClose,
  onRefresh,
  onSuccess,
}: {
  vehicle: Vehicle;
  data: Bootstrap;
  initialJobId?: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSuccess: (text: string) => void;
}) {
  const [job, setJob] = useState<ImportJob | null>(
    () =>
      data.imports.find(
        (item) => item.id === initialJobId && item.vehicleId === vehicle.id,
      ) ||
      data.imports.find(
        (item) =>
          item.vehicleId === vehicle.id &&
          [
            "uploaded",
            "processing",
            "awaiting_confirmation",
            "review",
          ].includes(item.status),
      ) ||
      null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [km, setKm] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [unit, setUnit] = useState("km");
  const [engineKm, setEngineKm] = useState("");
  const needsEngineKm = data.rules.some(
    (rule) =>
      rule.modelId === vehicle.modelId &&
      rule.mileageType === "engine_km" &&
      rule.verified,
  );
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!job || !["uploaded", "processing"].includes(job.status)) return;
    const timer = setInterval(() => {
      api<ImportJob>(`/imports/${job.id}`)
        .then(setJob)
        .catch((e) => setError(messageOf(e)));
    }, 1800);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (!job) return;
    setKm(job.candidate.totalKm == null ? "" : String(job.candidate.totalKm));
    setUnit(job.candidate.unit || "km");
    setEngineKm(
      job.candidate.engineKm == null
        ? ""
        : String(
            Math.round(
              job.candidate.engineKm *
                (job.candidate.unit === "mi" ? 1.609344 : 1),
            ),
          ),
    );
    setObservedAt(
      job.candidate.observedAt
        ? localTimeInput(new Date(job.candidate.observedAt))
        : "",
    );
  }, [job?.id, job?.status]);
  const upload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    const form = new FormData(event.currentTarget);
    form.set("file", file);
    setBusy(true);
    setError("");
    try {
      const result = await api<ImportJob>(`/vehicles/${vehicle.id}/imports`, {
        method: "POST",
        body: form,
      });
      setJob(result);
      await onRefresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<ImportJob>(`/imports/${job.id}/confirm`, {
        totalKm: Number(km),
        unit,
        observedAt: asDateTime(observedAt),
        ...(engineKm !== "" ? { engineKm: Number(engineKm) } : {}),
      });
      setJob(result);
      await onRefresh();
      onSuccess("里程已核对确认，保养计划已更新");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="更新爱车里程"
      subtitle={`${vehicle.name} · ${vehicle.plate}`}
      onClose={onClose}
      wide
    >
      <div className="import-steps">
        <span className="current">1 上传图片</span>
        <i />
        <span className={job ? "current" : ""}>2 对照核验</span>
        <i />
        <span className={job?.status === "confirmed" ? "current" : ""}>
          3 确认更新
        </span>
      </div>
      <div className="import-layout">
        <div className="import-image-area">
          {job?.imageUrl || preview ? (
            <img
              src={job?.imageUrl || preview}
              alt="待核对的仪表或车厂应用截图"
            />
          ) : (
            <div className="upload-placeholder">
              <ScanLine size={48} />
              <p>让里程信息清楚可见</p>
              <small>停稳车辆后拍摄仪表，或选择车厂应用截图</small>
            </div>
          )}
        </div>
        <div>
          {!job ? (
            <form className="form-stack" onSubmit={upload}>
              <label className="file-picker">
                <ImagePlus size={25} />
                <span>{file ? file.name : "选择截图或仪表照片"}</span>
                <input
                  type="file"
                  name="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  onChange={(e) => {
                    const next = e.target.files?.[0] || null;
                    if (next && next.size > 8 * 1024 * 1024) {
                      setError("图片请小于8MB");
                      return;
                    }
                    setFile(next);
                    setError("");
                  }}
                />
              </label>
              <label>
                图片类型
                <select name="imageType">
                  <option value="dashboard">车辆仪表照片</option>
                  <option value="app">车厂应用截图</option>
                </select>
              </label>
              <div className="notice-note">
                <Camera size={18} />
                <span>
                  图片用于提取里程；识别结果需经你核对确认，才会更新车辆记录。
                </span>
              </div>
              {!data.config.aiConfigured && (
                <div className="feedback feedback-warning">
                  图片识别服务暂未配置。可以上传保存图片，但当前无法自动生成候选里程。
                </div>
              )}
              <ErrorBox message={error} />
              <button
                className="btn btn-primary btn-full"
                disabled={busy || !file}
              >
                <Upload size={17} />
                {busy ? "正在上传…" : "上传并识别"}
              </button>
            </form>
          ) : (
            <div className="form-stack">
              <span
                className={`badge ${job.status === "confirmed" ? "badge-success" : job.status === "failed" ? "badge-warning" : "badge-blue"}`}
              >
                {importStatus[job.status]}
              </span>
              {["uploaded", "processing"].includes(job.status) && (
                <Loading label="识别中，请稍候。离开页面不会取消任务。" />
              )}
              {job.reason && (
                <div
                  className={`feedback ${job.status === "failed" ? "feedback-warning" : ""}`}
                >
                  {job.reason}
                </div>
              )}
              {["awaiting_confirmation", "review"].includes(job.status) && (
                <form className="form-stack" onSubmit={confirm}>
                  <p className="muted">
                    请对照原图逐项核对。无法辨认或缺失的字段，请重新上传清晰图片。
                  </p>
                  <div className="form-grid">
                    <label>
                      总里程
                      <input
                        type="number"
                        min="0"
                        max="2000000"
                        step="1"
                        required
                        value={km}
                        onChange={(e) => setKm(e.target.value)}
                      />
                    </label>
                    <label>
                      原图单位
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                      >
                        <option value="km">km / 公里</option>
                        <option value="mi">mi / 英里</option>
                      </select>
                    </label>
                  </div>
                  {(needsEngineKm || job.candidate.engineKm != null) && (
                    <label>
                      发动机累计里程（km，可选）
                      <input
                        type="number"
                        min="0"
                        max="2000000"
                        step="1"
                        value={engineKm}
                        onChange={(event) => setEngineKm(event.target.value)}
                        placeholder="仅填写原图明确显示的发动机里程"
                      />
                      <span className="form-hint">
                        不能使用车辆总里程代替。原图无此读数可留空，对应保养将显示待补充。
                        {job.candidate.unit === "mi" &&
                        job.candidate.engineKm != null
                          ? "此候选值已按 1 mi = 1.609344 km 换算，请核对。"
                          : ""}
                      </span>
                    </label>
                  )}
                  <label>
                    图片数据时间（北京时间）
                    <input
                      type="datetime-local"
                      required
                      max={localTimeInput()}
                      value={observedAt}
                      onChange={(e) => setObservedAt(e.target.value)}
                    />
                  </label>
                  <p className="form-hint">
                    填写读数实际对应的时间，而非默认使用上传时间。
                  </p>
                  <ErrorBox message={error} />
                  <button className="btn btn-primary" disabled={busy}>
                    <CheckCircle2 size={18} />
                    {busy ? "正在确认…" : "已核对，确认更新"}
                  </button>
                </form>
              )}
              {job.status === "confirmed" && (
                <div className="success-panel">
                  <CheckCircle2 size={36} />
                  <h3>爱车档案已更新</h3>
                  <p>本次确认的信息已保存，保养计划按项目重新计算。</p>
                  <button className="btn btn-primary" onClick={onClose}>
                    回到我的爱车
                  </button>
                </div>
              )}
              {job.status === "failed" && (
                <>
                  <button
                    className="btn btn-secondary"
                    disabled={busy || !data.config.aiConfigured}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        setJob(
                          await post<ImportJob>(`/imports/${job.id}/retry`),
                        );
                      } catch (e) {
                        setError(messageOf(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <RefreshCw size={17} />
                    {busy ? "正在重试…" : "重新识别"}
                  </button>
                  <button
                    className="text-btn"
                    onClick={() => {
                      setJob(null);
                      setFile(null);
                      setPreview("");
                      setError("");
                    }}
                  >
                    选择另一张图片
                  </button>
                </>
              )}
              <ErrorBox message={error} />
              <small className="muted">
                上传时间：{dateText(job.createdAt, true)}
                <br />
                此前有效里程不会因识别失败而被覆盖。
              </small>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
