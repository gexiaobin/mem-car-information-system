import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  FileImage,
  ImagePlus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type {
  CarModel,
  PublicConfig,
  RegistrationFields,
  RegistrationImport,
  Vehicle,
} from "@autovoyage/shared";
import { api, post } from "../lib/api";
import { dateInput, dateText, ErrorBox, Loading, messageOf, Modal } from "./UI";
import "./registration.css";

const fieldLabels: Record<keyof RegistrationFields, string> = {
  plate: "号牌号码",
  vehicleType: "车辆类型",
  ownerName: "所有人",
  useNature: "使用性质",
  brandModel: "品牌型号",
  vin: "车辆识别代号（VIN）",
  engineNumber: "发动机号码",
  registerDate: "注册日期",
  issueDate: "发证日期",
};
const fieldKeys = Object.keys(fieldLabels) as (keyof RegistrationFields)[];
type FormFields = Record<keyof RegistrationFields, string>;
const emptyFields = (): FormFields =>
  Object.fromEntries(fieldKeys.map((key) => [key, ""])) as FormFields;
const statusLabels: Record<RegistrationImport["status"], string> = {
  uploaded: "已上传，等待识别",
  processing: "正在识别行驶证",
  awaiting_confirmation: "识别完成，待你核对",
  confirmed: "已核对并存入档案",
  failed: "这次未能完成识别",
};
export const registrationStatusLabel = (status: RegistrationImport["status"]) =>
  statusLabels[status];

export function RegistrationDetails({
  fields,
}: {
  fields: RegistrationFields;
}) {
  return (
    <dl className="registration-details">
      {fieldKeys.map((key) => (
        <div key={key}>
          <dt>{fieldLabels[key]}</dt>
          <dd className={key === "vin" ? "registration-vin" : ""}>
            {fields[key] || "未填写"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function RegistrationCertificate({
  models,
  vehicle,
  initialJob,
  aiConfigured,
  onClose,
  onSaved,
}: {
  models: CarModel[];
  vehicle?: Vehicle;
  initialJob?: RegistrationImport;
  aiConfigured?: boolean;
  onClose: () => void;
  onSaved: (job: RegistrationImport) => Promise<void>;
}) {
  const [job, setJob] = useState<RegistrationImport | null>(initialJob || null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(
    aiConfigured ?? null,
  );
  const [consent, setConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [fields, setFields] = useState<FormFields>(emptyFields);
  const [modelId, setModelId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [initialKm, setInitialKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const processing = job?.status === "uploaded" || job?.status === "processing";
  const reviewing = job?.status === "awaiting_confirmation";
  const confirmed = job?.status === "confirmed";
  const existing = Boolean(vehicle || initialJob?.vehicleId);

  useEffect(() => {
    if (aiConfigured !== undefined) return;
    let alive = true;
    api<PublicConfig>("/config")
      .then((config) => {
        if (alive) setConfigured(config.aiConfigured);
      })
      .catch((e) => {
        if (alive) setError(messageOf(e));
      });
    return () => {
      alive = false;
    };
  }, [aiConfigured]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!job) return;
    const source = job.confirmedFields || job.candidate;
    setFields(
      Object.fromEntries(
        fieldKeys.map((key) => [key, source[key] || ""]),
      ) as FormFields,
    );
    setReviewed(false);
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (!job || !["uploaded", "processing"].includes(job.status)) return;
    let alive = true;
    const read = () =>
      api<RegistrationImport>(`/registration-imports/${job.id}`)
        .then((next) => {
          if (alive) {
            setJob(next);
            setPollError("");
          }
        })
        .catch((e) => {
          if (alive) setPollError(messageOf(e));
        });
    const timer = setInterval(read, 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  const chooseFile = (next: File | null, input: HTMLInputElement) => {
    if (
      next &&
      (!["image/jpeg", "image/png", "image/webp"].includes(next.type) ||
        next.size > 8 * 1024 * 1024)
    ) {
      setError("请选择不超过 8 MB 的 JPG、PNG 或 WebP 图片。");
      input.value = "";
      setFile(null);
      return;
    }
    setFile(next);
    setConsent(false);
    setError("");
  };
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !consent) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("consent", "true");
      if (vehicle) body.set("vehicleId", vehicle.id);
      setJob(
        await api<RegistrationImport>("/registration-imports", {
          method: "POST",
          body,
        }),
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!job || !reviewed) return;
    setBusy(true);
    setError("");
    try {
      const normalized: RegistrationFields = {
        plate: fields.plate.trim() || null,
        vehicleType: fields.vehicleType.trim() || null,
        ownerName: fields.ownerName.trim() || null,
        useNature: fields.useNature.trim() || null,
        brandModel: fields.brandModel.trim() || null,
        vin: fields.vin.trim() || null,
        engineNumber: fields.engineNumber.trim() || null,
        registerDate: fields.registerDate.trim() || null,
        issueDate: fields.issueDate.trim() || null,
      };
      const result = await post<RegistrationImport>(
        `/registration-imports/${job.id}/confirm`,
        {
          fields: normalized,
          ...(!existing
            ? {
                vehicle: {
                  modelId,
                  name,
                  startDate,
                  initialKm: Number(initialKm),
                },
              }
            : {}),
        },
      );
      setJob(result);
      await onSaved(result);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const startAgain = () => {
    setJob(null);
    setFile(null);
    setPreview("");
    setConsent(false);
    setReviewed(false);
    setError("");
    setPollError("");
  };
  const retry = async () => {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      setJob(
        await post<RegistrationImport>(`/registration-imports/${job.id}/retry`),
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        confirmed
          ? "行驶证档案"
          : existing
            ? "补充爱车行驶证"
            : "行驶证识别建档"
      }
      subtitle={
        vehicle
          ? `${vehicle.name} · ${vehicle.plate}`
          : "拍一张正页，核对后建立你的专属车辆档案。"
      }
      onClose={onClose}
      wide
    >
      <div className="registration-flow">
        <ol className="registration-steps" aria-label="行驶证建档步骤">
          {["上传正页", "核对信息", "存入档案"].map((label, index) => {
            const step = confirmed ? 2 : reviewing ? 1 : 0;
            return (
              <li
                key={label}
                className={
                  index === step
                    ? "is-current"
                    : index < step
                      ? "is-complete"
                      : ""
                }
                aria-current={index === step ? "step" : undefined}
              >
                <span>
                  {index < step ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
        <div className="registration-layout">
          <aside className="registration-preview">
            <div className="registration-document-frame">
              {job?.imageUrl || preview ? (
                <img
                  src={job?.imageUrl || preview}
                  alt="待核对的机动车行驶证正页"
                />
              ) : (
                <div className="registration-placeholder">
                  <div className="registration-outline">
                    <FileImage
                      size={42}
                      strokeWidth={1.35}
                      aria-hidden="true"
                    />
                    <span>中华人民共和国机动车行驶证</span>
                    <i />
                    <i />
                    <i />
                  </div>
                  <h3>行驶证正页</h3>
                  <p>
                    四角完整，文字清晰
                    <br />
                    避免反光、遮挡与水印
                  </p>
                </div>
              )}
            </div>
            <div className="registration-private">
              <ShieldCheck size={19} aria-hidden="true" />
              <p>
                证件照片与识别档案仅本人可查看。
                <br />
                本流程不提取或保存住址字段。
              </p>
            </div>
            {job && (
              <p className="registration-upload-time">
                上传于 {dateText(job.createdAt, true)}
              </p>
            )}
          </aside>
          <div className="registration-content">
            {!job && (
              <form className="form-stack" onSubmit={upload}>
                <div className="registration-heading">
                  <span className="eyebrow">YOUR VEHICLE, DOCUMENTED</span>
                  <h3>让爱车信息，一次填清。</h3>
                  <p>
                    支持识别号牌、品牌型号、VIN、注册日期等信息。识别后可逐项修改，由你确认保存。
                  </p>
                </div>
                <label className="registration-file-picker">
                  <ImagePlus size={27} aria-hidden="true" />
                  <span>{file ? file.name : "选择行驶证正页照片"}</span>
                  <small>JPG / PNG / WebP · 最大 8 MB</small>
                  <input
                    type="file"
                    name="registrationFile"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="选择行驶证正页照片"
                    required
                    onChange={(e) =>
                      chooseFile(e.target.files?.[0] || null, e.target)
                    }
                  />
                </label>
                <p className="form-hint">
                  可先遮住住址等无关信息，请保留待识别字段。行驶证不包含当前里程，里程仍需通过仪表照片核对更新。
                </p>
                <label className="registration-check">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    required
                  />
                  <span>
                    我同意将本张照片发送至已配置的 AI
                    识别服务。识别结果经我核对确认后，才存入车辆档案。
                  </span>
                </label>
                {configured === null && (
                  <p className="form-hint" role="status">
                    正在检查识别服务…
                  </p>
                )}
                {configured === false && (
                  <div className="feedback feedback-warning">
                    行驶证识别服务暂不可用，请稍后再试，也可先通过手动填写添加车辆。
                  </div>
                )}
                <ErrorBox message={error} />
                <button
                  className="btn btn-primary btn-full"
                  disabled={busy || !file || !consent || configured !== true}
                >
                  <Upload size={18} aria-hidden="true" />
                  {busy ? "正在上传…" : "上传并识别行驶证"}
                </button>
              </form>
            )}
            {job && (
              <>
                <div className="registration-job-heading">
                  <span
                    className={`badge ${confirmed ? "badge-success" : job.status === "failed" ? "badge-warning" : "badge-blue"}`}
                    role="status"
                  >
                    {statusLabels[job.status]}
                  </span>
                  {job.reason && <p>{job.reason}</p>}
                </div>
                {processing && (
                  <>
                    <Loading label="正在读取证件上的车辆信息…" />
                    <p className="form-hint">
                      离开窗口不会取消任务，可在“我的车辆档案”中继续查看。识别完成前不会创建或修改车辆。
                    </p>
                    <ErrorBox message={pollError} />
                  </>
                )}
                {reviewing && (
                  <form className="form-stack" onSubmit={confirm}>
                    <div className="registration-review-note">
                      <ScanLine size={20} aria-hidden="true" />
                      <p>
                        请对照原图核对。空白字段表示未能辨认，可据实补充或保留空白；带
                        * 的信息必须填写。
                      </p>
                    </div>
                    {existing && (
                      <p className="registration-bound-vehicle">
                        本次补充到{" "}
                        <strong>{vehicle?.plate || "已关联车辆"}</strong>
                        。号牌需与该车辆一致，保养车型、启用日期与里程保持原值。
                      </p>
                    )}
                    <fieldset className="registration-fieldset">
                      <legend>行驶证信息</legend>
                      <div className="form-grid">
                        {fieldKeys.map((key) => (
                          <label
                            key={key}
                            className={
                              key === "vin" || key === "brandModel"
                                ? "registration-field-wide"
                                : ""
                            }
                          >
                            {fieldLabels[key]}
                            {key === "plate" || key === "brandModel"
                              ? " *"
                              : ""}
                            <input
                              type={key.endsWith("Date") ? "date" : "text"}
                              value={fields[key]}
                              required={key === "plate" || key === "brandModel"}
                              max={
                                key.endsWith("Date") ? dateInput() : undefined
                              }
                              min={
                                key === "issueDate" && fields.registerDate
                                  ? fields.registerDate
                                  : undefined
                              }
                              maxLength={
                                key === "vin" ? 17 : key === "plate" ? 12 : 100
                              }
                              pattern={
                                key === "vin"
                                  ? "[A-HJ-NPR-Z0-9]{17}"
                                  : undefined
                              }
                              title={
                                key === "vin"
                                  ? "VIN 为 17 位字母与数字，不含 I、O、Q；无此信息可留空"
                                  : undefined
                              }
                              autoCapitalize={
                                key === "vin" || key === "plate"
                                  ? "characters"
                                  : undefined
                              }
                              onChange={(e) => {
                                setFields((current) => ({
                                  ...current,
                                  [key]:
                                    key === "vin" || key === "plate"
                                      ? e.target.value.toUpperCase()
                                      : e.target.value,
                                }));
                                setReviewed(false);
                              }}
                              placeholder={
                                key.endsWith("Date")
                                  ? undefined
                                  : key === "plate" || key === "brandModel"
                                    ? "请对照原图核对填写"
                                    : "原图未显示可留空"
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {!existing && (
                      <fieldset className="registration-fieldset">
                        <legend>确认车辆建档信息</legend>
                        <label>
                          保养车型配置 *
                          <select
                            required
                            value={modelId}
                            onChange={(e) => {
                              setModelId(e.target.value);
                              setReviewed(false);
                            }}
                          >
                            <option value="">
                              请核对品牌、年款和动力后选择
                            </option>
                            {models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.brand} {model.name} · {model.year} 款 ·{" "}
                                {model.power}
                                {model.isDemo ? "（演示车型）" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="form-hint">
                          行驶证上的“品牌型号”通常是车辆型号代码，请自行确认对应的具体车型；列表无匹配配置时，请联系平台补充，不要选择相近车型。
                        </p>
                        <label>
                          车辆昵称 *
                          <input
                            value={name}
                            onChange={(e) => {
                              setName(e.target.value);
                              setReviewed(false);
                            }}
                            required
                            maxLength={40}
                            placeholder="例如：我的海豹"
                          />
                        </label>
                        <div className="form-grid">
                          <label>
                            车辆启用日期 *
                            <input
                              type="date"
                              required
                              value={startDate}
                              onChange={(e) => {
                                setStartDate(e.target.value);
                                setReviewed(false);
                              }}
                              max={dateInput()}
                            />
                          </label>
                          <label>
                            启用时里程（km）*
                            <input
                              type="number"
                              required
                              value={initialKm}
                              onChange={(e) => {
                                setInitialKm(e.target.value);
                                setReviewed(false);
                              }}
                              min="0"
                              max="2000000"
                              step="1"
                              placeholder="请据实填写"
                            />
                          </label>
                        </div>
                        <p className="form-hint">
                          启用日期和起始里程由你单独确认，不使用行驶证发证日期推算，也不会从证件生成当前里程。
                        </p>
                      </fieldset>
                    )}
                    <label className="registration-check">
                      <input
                        type="checkbox"
                        required
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      <span>
                        我已对照原图核对以上信息，确认属于本人的车辆，并同意保存到车辆档案。
                      </span>
                    </label>
                    <ErrorBox message={error} />
                    <button
                      className="btn btn-primary btn-full"
                      disabled={busy || !reviewed}
                    >
                      <FileCheck2 size={18} aria-hidden="true" />
                      {busy
                        ? "正在保存…"
                        : existing
                          ? "确认并保存行驶证档案"
                          : "确认信息并建立车辆档案"}
                    </button>
                  </form>
                )}
                {confirmed && (
                  <div className="form-stack">
                    <div className="registration-success">
                      <CheckCircle2 size={28} aria-hidden="true" />
                      <div>
                        <h3>这份爱车资料，已妥善记录。</h3>
                        <p>确认于 {dateText(job.confirmedAt, true)}</p>
                      </div>
                    </div>
                    <RegistrationDetails
                      fields={job.confirmedFields || job.candidate}
                    />
                    <button
                      className="btn btn-primary btn-full"
                      onClick={onClose}
                    >
                      回到车辆档案
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                    {vehicle && (
                      <button className="text-btn" onClick={startAgain}>
                        <RefreshCw size={16} aria-hidden="true" />
                        上传新的行驶证照片
                      </button>
                    )}
                  </div>
                )}
                {job.status === "failed" && (
                  <div className="form-stack">
                    <p className="muted">
                      请检查照片是否为清晰的行驶证正页。此次失败不会修改车辆档案，可使用原图重试或换一张照片。
                    </p>
                    <ErrorBox message={error} />
                    <button
                      className="btn btn-primary"
                      disabled={busy || configured !== true}
                      onClick={retry}
                    >
                      <RefreshCw size={17} aria-hidden="true" />
                      {busy ? "正在重试…" : "使用原图重新识别"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={startAgain}
                    >
                      <ImagePlus size={17} aria-hidden="true" />
                      换一张照片
                    </button>
                  </div>
                )}
                {reviewing && (
                  <button
                    className="text-btn registration-back"
                    disabled={busy}
                    onClick={startAgain}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    重新选择照片
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
