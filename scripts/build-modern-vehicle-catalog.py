"""Build recent catalog variants from the attributed PyLab.me CC BY 4.0 snapshot.

Python 3.14+ standard library only (older Python needs zstandard for history).
No source code or SQL from the provider is run.
Use --archive to reuse a downloaded archive, otherwise download the pinned commit.
The output contains only rows with an explicit 2019--2026 model year, a matching
brand/series, and same-column powertrain facts. Missing values are never inferred.
"""
from __future__ import annotations

import argparse
import base64
import collections
import csv
import hashlib
import io
import json
import re
import tarfile
import unicodedata
import urllib.request
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "a5eeb0dbecbbb007bb7ee1cd3afc0b7021f75a26"
SOURCE_ID = "pylab-autohome-modern-20261016"
RETRIEVED_AT = "2026-11-04"
ARCHIVE_SHA256 = "fa11ed16e276842d449f38c10021fc1c0bcb345552bfbe406d299fe93de05805"
URL = f"https://codeload.github.com/swoiow/autohome/zip/{COMMIT}"
HISTORY_COMMIT = "5d791c2241a1e48f3be9251b913e41e500563f99"
HISTORY_MONTH = "202412"
HISTORY_SOURCE_ID = "pylab-autohome-history-202412"
HISTORY_SHA256 = "64fa28054dd1c4dbed54931b67449c773aae91c42a2ddab41a66bf6b2ea27907"
BRAND_ALIASES = {
    "理想汽车": "理想", "小鹏": "小鹏汽车", "ARCFOX极狐": "ARCFOX",
    "Polestar极星": "Polestar", "Lorinser罗伦士": "Lorinser", "魏牌": "WEY",
    "上汽大通MAXUS": "上汽大通", "江汽集团": "江淮", "江淮汽车": "江淮",
}
# Deliberate name aliases, never a fuzzy match or a year/power/trim cross join.
SERIES_ALIASES = {
    ("比亚迪", "唐新能源"): "唐", ("比亚迪", "宋PLUS新能源"): "宋PLUS",
    ("比亚迪", "宋Pro新能源"): "宋Pro", ("比亚迪", "元PLUS"): "元PLUS",
    ("比亚迪", "宋L EV"): "宋L", ("比亚迪", "宋L DM-i"): "宋L",
    ("比亚迪", "海狮05 EV"): "海狮05", ("比亚迪", "海狮05 DM-i"): "海狮05",
    ("比亚迪", "海狮06新能源"): "海狮06", ("比亚迪", "海狮07 EV"): "海狮07",
    ("比亚迪", "海狮07 DM-i"): "海狮07", ("比亚迪", "海豹06新能源"): "海豹06",
    ("比亚迪", "海豹07 DM-i"): "海豹07",
}
PASSENGER_BRANDS = set("""212 ARCFOX Polestar smart MINI DS Jeep LEVC
一汽 东南 东风 东风奕派 东风富康 东风纳米 中华 乐道 云度 五菱汽车
众泰 依维柯 先锋 傲旋 克莱斯勒 别克 力帆 劳斯莱斯 北京汽车 北京越野
北汽新能源 北汽昌河 华泰 华颂 南汽 名爵 启辰 吉利汽车 吉利几何 吉利银河
哪吒汽车 哈弗 坦克 塔塔 埃安 大众 奔腾 奔驰 奥迪 奇瑞 奇瑞新能源
奇瑞风云 威马 威麟 宾利 宝沃 宝马 宝骏 富康 小鹏汽车 小米汽车 岚图汽车
巴博斯 布加迪 广汽传祺 广汽吉奥 开瑞 思皓 悦达起亚 捷尼赛思 捷豹 捷达
捷途 摩根 斯巴鲁 斯威汽车 斯柯达 日产 昊铂 昌河 星途 智己汽车 智界
极氪 极狐 极石 枫叶 标致 欧宝 欧拉 欧尚 比亚迪 沃尔沃 江淮 江铃
法拉利 深蓝汽车 灵悉 炫界 爱驰 特斯拉 玛莎拉蒂 现代 理想 瑞麒 瑞驰
知豆 神龙 神龙汽车 福特 福迪 红旗 纳智捷 腾势 莲花跑车 荣威 菲亚特
蔚来 蔚来汽车 蓝电 讴歌 路特斯 路虎 迈凯伦 远航汽车 道奇 郑州日产
长城 长安 长安启源 长安欧尚 陆风 雪佛兰 雪铁龙 雷克萨斯 雷诺
零跑汽车 领克 领途汽车 飞凡汽车 风光 风行 魏牌 WEY 高合 高合汽车
鸿蒙智行 智界 享界 尊界 齐鲁 丰田 本田 保时捷 林肯 凯迪拉克 兰博基尼 阿斯顿·马丁
阿尔法·罗密欧 阿维塔 马自达 铃木 起亚 方程豹 仰望""".split())
NEW_SERIES_EXCLUDE = re.compile(r"概念|Concept|CONCEPT|原型|赛车|底盘|客车|微卡|轻卡|货车|专用|全顺|依维柯|房车|改装|皮卡|商用|风骏|金杯|图雅诺|五菱荣光|五菱之光|五菱之途|五菱扬光|五菱征途|五菱征程|五菱龙卡")
PLACEHOLDER_TRIM = re.compile(r"基本型|基本版|高配|中配|低配|概念|试装|待售|预售|未上市|即将上市|prototype|concept", re.IGNORECASE)
PASSENGER_LEVELS = set("""微型车 小型车 紧凑型车 中型车 中大型车 大型车
小型SUV 紧凑型SUV 中型SUV 中大型SUV 大型SUV
紧凑型MPV 中型MPV 中大型MPV 大型MPV MPV 跑车""".split())
# These exact Autohome IDs are represented by reviewed BYD official columns.
# Keep this aligned with preExistingIds + official[].replacements in
# scripts/build-byd-recent-variants.mjs; never deduplicate on fuzzy trim text.
BYD_OFFICIAL_SPEC_IDS = {
    75413, 75141, 76108, 76176, 77748, 77717, 77718, 77749, 73552, 74310, 73553, 74335,
    76199, 76109, 76177, 75123, 75404, 75416, 75559, 75560, 75429, 75544,
    77933, 77708, 77709, 77710, 76681, 76682, 76224, 76652, 69004, 69005, 69006, 66316,
}


def canonical_brand_name(brand: str, series: str) -> str:
    if brand == "鸿蒙智行":
        for badge in ("问界", "智界", "享界", "尊界"):
            if series.startswith(badge):
                return badge
    return BRAND_ALIASES.get(brand, brand)


def canonical_series(brand: str, series: str) -> str:
    series = SERIES_ALIASES.get((brand, series), series)
    prefixes = {"理想": "理想", "小鹏汽车": "小鹏", "蔚来": "蔚来", "极氪": "极氪", "问界": "问界", "智界": "智界", "享界": "享界", "尊界": "尊界", "小米汽车": "小米", "零跑汽车": "零跑"}
    prefix = prefixes.get(brand)
    if prefix and series.startswith(prefix):
        return series[len(prefix):].strip()
    return series


def normalized(text: str) -> str:
    return re.sub(r"[\s·]", "", unicodedata.normalize("NFKC", text)).casefold()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def history_files() -> tuple[list, dict]:
    """Decode the provider's data-only historical container; never execute it."""
    cache = ROOT / ".local/modern-research" / f"vaults_{HISTORY_MONTH}_data.vault"
    url = f"https://raw.githubusercontent.com/swoiow/autohome/{HISTORY_COMMIT}/vaults/{HISTORY_MONTH}/data.vault"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as response:
            cache.write_bytes(response.read())
    raw = cache.read_bytes()
    if hashlib.sha256(raw).hexdigest() != HISTORY_SHA256:
        raise ValueError("Historical snapshot SHA256 mismatch")
    # This is a standard Base85 + zlib + Zstandard + tar data container.
    compressed_tar = zlib.decompress(base64.b85decode(raw))
    try:
        from compression import zstd  # Python 3.14+
        tar_bytes = zstd.decompress(compressed_tar)
    except ImportError:
        try:
            import zstandard
        except ImportError as error:
            raise RuntimeError("History decoding requires Python >=3.14 or the zstandard package") from error
        tar_bytes = zstandard.ZstdDecompressor().decompress(compressed_tar)
    files = []
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:") as archive:
        for member in sorted(archive.getmembers(), key=lambda x: x.name):
            if member.isfile() and member.name.endswith(".csv"):
                # Read members in memory; archive paths are never extracted.
                filename = member.name.removeprefix("./")
                if "/" in filename or "\\" in filename:
                    raise ValueError("Unexpected historical member path")
                files.append((HISTORY_SOURCE_ID, filename, archive.extractfile(member).read()))
    return files, {"sourceId": HISTORY_SOURCE_ID, "commit": HISTORY_COMMIT, "monthLabel": HISTORY_MONTH, "url": url, "sha256": HISTORY_SHA256, "fileCount": len(files)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ROOT / ".local/modern-research/pylab-autohome.zip")
    parser.add_argument("--skip-history", action="store_true", help="Build the main snapshot only (default also reads 202412 history)")
    args = parser.parse_args()
    if not args.archive.exists():
        args.archive.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL, timeout=60) as response:
            args.archive.write_bytes(response.read())
    archive = args.archive.read_bytes()
    digest = hashlib.sha256(archive).hexdigest()
    if ARCHIVE_SHA256 and digest != ARCHIVE_SHA256:
        raise ValueError(f"Archive SHA256 mismatch: {digest}")
    models = read_json(ROOT / "apps/api/src/data/catalog-models.json")
    recent_file = ROOT / "apps/api/src/data/catalog-models-recent.json"
    if recent_file.exists():
        models += read_json(recent_file)
    preferred_byd = ROOT / "apps/api/src/data/catalog-variants-byd-recent.json"
    preferred_spec_ids = set(BYD_OFFICIAL_SPEC_IDS)
    if preferred_byd.exists():
        for row in read_json(preferred_byd):
            exact = re.fullmatch(r"autohome-byd-spec-(\d+)", row["id"])
            if exact:
                preferred_spec_ids.add(int(exact[1]))
    preferred_latest = ROOT / "apps/api/src/data/catalog-variants-latest.json"
    latest_spec_ids = set()
    latest_manifest = None
    if preferred_latest.exists():
        for row in read_json(preferred_latest):
            exact = re.fullmatch(r"autohome-latest-spec-(\d+)", row["id"])
            if exact:
                latest_spec_ids.add(int(exact[1]))
        latest_manifest = {"file": "apps/api/src/data/catalog-variants-latest.json", "sha256": hashlib.sha256(preferred_latest.read_bytes()).hexdigest(), "specIds": sorted(latest_spec_ids)}
    index = collections.defaultdict(list)
    for model in models:
        index[(normalized(model["brand"]), normalized(model["name"]))].append(model)

    def match(brand: str, series: str):
        brand = canonical_brand_name(brand, series)
        series = SERIES_ALIASES.get((brand, series), series)
        candidates = index[(normalized(brand), normalized(series))]
        # The official navigation stores short names such as L6 / M7 / 001.
        if not candidates:
            prefixes = [brand]
            if brand == "理想":
                prefixes.append("理想")
            if brand == "小鹏汽车":
                prefixes.extend(["小鹏", "小鹏汽车"])
            if brand == "零跑汽车":
                prefixes.append("零跑")
            if brand == "小米汽车":
                prefixes.append("小米")
            if brand == "ARCFOX":
                prefixes.append("极狐")
            for prefix in prefixes:
                if series.startswith(prefix):
                    candidates = index[(normalized(brand), normalized(series[len(prefix):]))]
                    if candidates:
                        break
        if len(candidates) == 1:
            return candidates[0]
        return None

    variants = []
    skipped = collections.Counter()
    unmatched = []
    used_files = []
    new_models = {}
    source_model_count = collections.Counter()
    source_year_count = collections.Counter()
    seen = set()
    seen_spec_ids = set()
    historical_manifest = None
    with zipfile.ZipFile(io.BytesIO(archive)) as snapshot:
        expected_root = f"autohome-{COMMIT}/"
        if not all(name.startswith(expected_root) for name in snapshot.namelist()):
            raise ValueError("Unexpected archive root")
        license_bytes = snapshot.read(expected_root + "LICENSE")
        license_text = license_bytes.decode("utf-8")
        if "CC BY 4.0" not in license_text or "PyLab.me" not in license_text:
            raise ValueError("Expected data license notice missing")
        (ROOT / "docs/licenses/Autohome-PyLab-DATA-LICENSE.txt").write_bytes(license_bytes)
        file_inputs = [(SOURCE_ID, name.split("/data/", 1)[1], snapshot.read(name)) for name in sorted(snapshot.namelist()) if "/data/" in name and name.endswith(".csv")]
        if not args.skip_history:
            historical_files, historical_manifest = history_files()
            file_inputs.extend(historical_files)
        for input_source_id, filename, raw in file_inputs:
            if "_" not in filename:
                skipped["filename"] += 1
                continue
            brand, series = filename[:-4].split("_", 1)
            rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
            if not rows or rows[0][0] != "Feature":
                skipped["header"] += 1
                continue
            specids = rows[0][1:]
            fields = {row[0]: row[1:] for row in rows[1:] if row}
            names = fields.get("车型名称", [])
            model = match(brand, series)
            current_names = [label for label in names if re.search(r"20(?:19|2[0-6])款", label)]
            if not model:
                if current_names:
                    unmatched.append({"brand": brand, "name": series, "recentCount": len(current_names), "sample": current_names[:2], "file": f"data/{filename}"})
                canonical_brand = canonical_brand_name(brand, series)
                if canonical_brand not in PASSENGER_BRANDS or NEW_SERIES_EXCLUDE.search(series):
                    continue
                new_series = canonical_series(canonical_brand, series)
                model_key = (normalized(canonical_brand), normalized(new_series))
                model_hash = hashlib.sha256((model_key[0] + "/" + model_key[1]).encode("utf-8")).hexdigest()[:12]
                model = {"id": f"pylab-series-{model_hash}", "brand": canonical_brand, "name": new_series, "sourceId": input_source_id}
            added = 0

            def cell(index: int, *keys: str) -> str:
                values = []
                for key in keys:
                    values_for_key = fields.get(key, [])
                    value = values_for_key[index].strip() if index < len(values_for_key) else ""
                    if value not in ("", "-", "--", "未知", "暂无"):
                        values.append(value)
                if len(set(values)) > 1:
                    # Conflicting duplicated fields cannot be silently reconciled.
                    raise ValueError(f"Conflicting fields {filename} {specids[index]} {keys}: {values}")
                return values[0] if values else ""

            for i, specid in enumerate(specids):
                if int(specid) in preferred_spec_ids:
                    skipped["preferred_byd_exact_spec"] += 1
                    continue
                if specid in seen_spec_ids:
                    skipped["newer_exact_spec_preferred"] += 1
                    continue
                label = names[i].strip() if i < len(names) else ""
                year_match = re.search(r"\b(20\d{2})款\s*(.*)$", label)
                if not year_match:
                    skipped["no_explicit_year"] += 1
                    continue
                # Some upstream CSVs contain a fallback car's columns under an
                # unrelated filename. Verify each full model name independently.
                source_series = label[:year_match.start()].strip()
                if normalized(source_series) != normalized(series):
                    skipped["filename_model_mismatch"] += 1
                    continue
                year = int(year_match[1])
                if not 2019 <= year <= 2026:
                    skipped["outside_recent_years"] += 1
                    continue
                trim = re.sub(r"\s+", " ", year_match[2]).strip()
                if not trim or re.search(r"[<>\ufffd]|hs_kw", label):
                    skipped["incomplete_name"] += 1
                    continue
                if PLACEHOLDER_TRIM.search(trim):
                    skipped["placeholder_or_unreleased_trim"] += 1
                    continue
                if int(specid) in latest_spec_ids:
                    skipped["preferred_latest_exact_spec"] += 1
                    continue
                try:
                    energy = cell(i, "能源类型", "能源类型_x", "能源类型_y")
                    engine = cell(i, "发动机")
                    motor_kw = cell(i, "电动机总功率(kW)")
                    gearbox = cell(i, "变速箱", "简称")
                    manufacturer = cell(i, "厂商")
                    level = cell(i, "级别")
                except ValueError:
                    skipped["conflicting_source_fields"] += 1
                    continue
                if model["id"].startswith("pylab-series-") and level not in PASSENGER_LEVELS:
                    skipped["new_series_not_confirmed_passenger"] += 1
                    continue
                if not energy:
                    skipped["missing_energy"] += 1
                    continue
                parts = [energy]
                if engine and engine != energy and engine != "纯电动":
                    parts.append(engine)
                if motor_kw and re.fullmatch(r"\d+(?:\.\d+)?", motor_kw):
                    parts.append(f"电机{motor_kw}kW")
                if gearbox:
                    parts.append(gearbox)
                if len(parts) == 1 and not any(char.isdigit() for char in trim):
                    skipped["insufficient_power_facts"] += 1
                    continue
                power = " · ".join(parts)
                if len(f"{power} · {trim}") > 200:
                    skipped["display_too_long"] += 1
                    continue
                key = (model["id"], year, normalized(power), normalized(trim))
                if key in seen:
                    skipped["duplicate_configuration"] += 1
                    continue
                seen.add(key)
                seen_spec_ids.add(specid)
                variant = {
                    "id": f"pylab-spec-{specid}", "modelCatalogId": model["id"], "year": year,
                    "power": power, "trim": trim, "sourceId": input_source_id,
                    "sourceEvidence": f"data/{filename}；specid={specid}；原名={label}；年款/能源/发动机/电机/变速箱取同一列",
                }
                if manufacturer:
                    variant["manufacturer"] = manufacturer
                variants.append(variant)
                source_model_count[f'{model["brand"]} {model["name"]}'] += 1
                source_year_count[year] += 1
                added += 1
            if added:
                if model["id"].startswith("pylab-series-"):
                    new_models[model["id"]] = model
                    index[(normalized(model["brand"]), normalized(model["name"]))] = [model]
                used_files.append({"sourceId": input_source_id, "path": f"data/{filename}", "sha256": hashlib.sha256(raw).hexdigest(), "modelCatalogId": model["id"], "variants": added})

    counts = collections.Counter(v["id"] for v in variants)
    duplicates = {key for key, count in counts.items() if count > 1}
    if duplicates:
        write_json(ROOT / ".local/modern-research/duplicate-specs.json", [v for v in variants if v["id"] in duplicates])
        raise ValueError(f"Duplicate source spec ids: {len(duplicates)}; inspect duplicate-specs.json")
    variants.sort(key=lambda v: (v["modelCatalogId"], -v["year"], v["id"]))
    source = {
        "id": SOURCE_ID,
        "title": "PyLab.me 汽车参数公开数据（近年年款与配置快照）",
        "url": f"https://github.com/swoiow/autohome/tree/{COMMIT}",
        "license": "CC BY 4.0（数据）；署名 PyLab.me；已筛选和转换字段",
        "revision": COMMIT, "retrievedAt": RETRIEVED_AT,
        "description": "源提交日期2026-10-16不等于车型年款或全部车型数据日期；逐列读取车型名称中明确的2019—2026款，保留同列能源、发动机、电机功率及变速箱事实。剔除错车文件、概念/预售及基本型/高低配等不能确认实际配置的占位记录。数据来源为PyLab.me维护的汽车之家参数快照，可能包含停产车型及源数据疏漏，不代表全部年款/当前在售或原厂保养依据。",
    }
    manifest = {
        "sourceId": SOURCE_ID, "attribution": "PyLab.me", "license": "CC BY 4.0",
        "commit": COMMIT, "retrievedAt": RETRIEVED_AT, "archiveUrl": URL,
        "archiveSha256": digest, "sourceCommitAt": "2026-10-16T04:04:30Z",
        "count": len(variants), "seriesCount": len(source_model_count),
        "newSeriesCount": len(new_models),
        "years": dict(sorted(source_year_count.items())), "excluded": dict(skipped),
        "files": used_files,
    }
    sources = [source]
    if historical_manifest:
        manifest["history"] = historical_manifest
        sources.append({
            "id": HISTORY_SOURCE_ID, "title": "PyLab.me 汽车参数历史归档（202412标签）",
            "url": f"https://github.com/swoiow/autohome/tree/{HISTORY_COMMIT}/vaults/{HISTORY_MONTH}",
            "license": "CC BY 4.0（数据）；署名 PyLab.me；已筛选和转换字段",
            "revision": HISTORY_COMMIT, "retrievedAt": RETRIEVED_AT,
            "description": "源历史归档标签为202412，归档写入时间为2026-02-24；标签和归档时间都不作为车型年款。只补主快照缺失的明确YYYY款及同列动力/配置，按具体车型specid优先保留较新快照。包含历史/停产车型，非全量在售目录或原厂保养依据。",
        })
    if latest_manifest:
        manifest["preferredLatest"] = latest_manifest
    imported_paths = {row["path"] for row in used_files}
    unmatched = list({(row["brand"], row["name"]): row for row in unmatched if row["file"] not in imported_paths}.values())
    manifest["remainingUnmatchedSeries"] = len(unmatched)
    manifest["sourceCounts"] = dict(collections.Counter(row["sourceId"] for row in variants))
    write_json(ROOT / "apps/api/src/data/catalog-variants-modern.json", variants)
    write_json(ROOT / "apps/api/src/data/catalog-sources-modern.json", sources)
    write_json(ROOT / "apps/api/src/data/catalog-models-modern.json", sorted(new_models.values(), key=lambda m: (m["brand"], m["name"])))
    write_json(ROOT / "docs/vehicle-variants-modern-manifest.json", manifest)
    write_json(ROOT / ".local/modern-research/unmatched.json", unmatched)
    print(json.dumps({key: value for key, value in manifest.items() if key != "files"}, ensure_ascii=True, indent=2))
    print(f"Unmatched recent series: {len(unmatched)}; see .local/modern-research/unmatched.json")


if __name__ == "__main__":
    main()
