/**
 * 펌프 선정 웹앱 - KMP 부스터 카타로그
 */

const CATALOG_URL = "catalog.json";
const FV_CATALOG_URL = "fv_catalog.json";
const EFV_CATALOG_URL = "efv_catalog.json";

const FLOW_TO_M3H = {
  m3h: (v) => v,
  m3min: (v) => v * 60,
  lpm: (v) => v / (1000 / 60),
};

const FLOW_TO_M3MIN = {
  m3h: (v) => v / 60,
  m3min: (v) => v,
  lpm: (v) => (v / (1000 / 60)) / 60,
};

const SHEET_BY_PUMP_TYPE = {
  입형: ["CVF3", "CVF5", "CVF10", "CVF15", "CVF20", "CVF32", "CVF45", "CVF64", "CVF90"],
  횡형: ["2-K-CMI", "2-ES-CMI", "KZ-CMIA", "KW-CMI", "1-K-CMI", "1-K-SWPA", "AZ-CMIA"],
};

const SHEET_BY_POWER = {
  삼상: ["CVF3", "CVF5", "CVF10", "CVF15", "CVF20", "CVF32", "CVF45", "CVF64", "CVF90", "2-ES-CMI", "1-K-CMI", "1-K-SWPA", "KW-CMI"],
  단상: ["2-K-CMI", "KZ-CMIA", "KW-CMI", "AZ-CMIA"],
};

function isSelfPriming(pump) {
  const m = (pump.model || "").toUpperCase();
  return m.includes("ZCMIA") || m.includes("ZCMI") || pump.sheet === "KZ-CMIA";
}

let catalog = null;
let fvCatalog = null;
let efvCatalog = null;
let lastResults = [];
let currentUserFlow = null;
let currentUserHead = null;
let currentUserFlowUnit = null;
let currentUserQty = 1;
const form = document.getElementById("form");
const resultList = document.getElementById("resultList");
const resultPlaceholder = document.getElementById("resultPlaceholder");
const errorMessage = document.getElementById("errorMessage");
const chartOverlay = document.getElementById("chartOverlay");
const chartContainer = document.getElementById("chartContainer");
const chartTitle = document.getElementById("chartTitle");

function showResults(items) {
  lastResults = items;
  resultPlaceholder.classList.add("hidden");
  errorMessage.classList.add("hidden");
  errorMessage.textContent = "";
  resultList.innerHTML = items
    .map(
      (p, i) => `
    <div class="result-item" data-idx="${i}">
      <div class="model">${escapeHtml(formatModelDisplay(p))}</div>
    </div>
  `
    )
    .join("");

  resultList.querySelectorAll(".result-item").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx, 10);
      const pump = lastResults[idx];
      if (pump) showChart(pump);
    });
  });
}

function showChart(pump) {
  chartTitle.textContent = `Q-H 곡선: ${pump.model}`;
  const html = pump.qhCurve?.length >= 2 ? renderQHChart(pump) : "<p style='padding:20px;color:#fff'>Q-H 데이터 없음 (추후 추가 예정)</p>";
  chartContainer.innerHTML = html;
  chartOverlay.classList.remove("hidden");
}

function showError(msg) {
  resultPlaceholder.classList.add("hidden");
  resultList.innerHTML = "";
  errorMessage.textContent = msg;
  errorMessage.classList.remove("hidden");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function getBaseModelKey(model) {
  if (!model) return "";
  const s = String(model).replace(/\s+/g, " ").trim();
  const m = s.match(/^\d+\s+(.+)$/);
  return m ? m[1].replace(/CV\(F\)/g, "CVF") : s.replace(/CV\(F\)/g, "CVF");
}

function getPumpQuantityFromModel(model, pump) {
  if (pump?.pumpQuantity) {
    const m = String(pump.pumpQuantity).match(/(\d+)/);
    if (m) return Math.max(1, parseInt(m[1], 10));
  }
  if (!model) return 1;
  const s = String(model).trim();
  const n = s.match(/^(\d+)[-\s]/);
  return n ? Math.max(1, parseInt(n[1], 10)) : 1;
}

function getPumpQtyForFilter(pump) {
  if (pump?.pumpQuantity) {
    const m = String(pump.pumpQuantity).match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  const m = (pump?.model || "").match(/^(\d+)[-\s]/);
  return m ? parseInt(m[1], 10) : 1;
}

function formatModelDisplay(pump) {
  if (pump.flowUnit === "m3min") {
    return (pump.model || "").replace(/\s+/g, " ").trim();
  }
  let model = (pump.model || "").replace(/\s+/g, " ").trim();
  const pQty = getPumpQtyForFilter(pump);
  const m = model.match(/^(\d+)\s+(.+)$/);
  if (m && parseInt(m[1], 10) !== pQty) {
    model = `${pQty} ${m[2]}`;
  }
  const motor = pump.motor ? `${pump.motor}kW` : "";
  const display = model.replace(/CV\(F\)/g, "CVF");
  let result = motor ? `${display}, ${motor}` : display;
  const headStr = formatHeadDisplay(pump);
  if (headStr) result += ` ${headStr}`;
  if (isSelfPriming(pump)) result += " 자흡";
  return result;
}

function formatHeadDisplay(pump) {
  if (pump.flowUnit === "m3h" && pump.headAtFlow != null && pump.headAtFlow > 0) {
    return `${Math.round(pump.headAtFlow)}m`;
  }
  if (pump.minHead != null && pump.maxHead != null) {
    return `${Math.round(pump.minHead)}~${Math.round(pump.maxHead)}m`;
  }
  if (pump.maxHead != null) return `${Math.round(pump.maxHead)}m`;
  if (pump.headAtFlow != null && pump.headAtFlow > 0) return `${Math.round(pump.headAtFlow)}m`;
  return "";
}

function flowToM3h(value, unit) {
  return FLOW_TO_M3H[unit] ? FLOW_TO_M3H[unit](value) : value;
}

function flowToLpm(value, unit) {
  const m3h = flowToM3h(value, unit);
  return m3h * (1000 / 60);
}

function getHeadAtFlow(curve, flow) {
  if (!curve || curve.length === 0) return null;
  const sorted = [...curve].sort((a, b) => a.q - b.q);
  const qMin = sorted[0].q;
  const qMax = sorted[sorted.length - 1].q;
  if (flow < qMin || flow > qMax) return null;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (flow >= sorted[i].q && flow <= sorted[i + 1].q) {
      const t = (flow - sorted[i].q) / (sorted[i + 1].q - sorted[i].q);
      return sorted[i].h + t * (sorted[i + 1].h - sorted[i].h);
    }
  }
  return null;
}

function getNominalFlowFromSheet(sheet) {
  const m = (sheet || "").match(/CVF(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function matchesCVF(pump, flowM3h, headM) {
  if (pump.flowUnit !== "m3h") return false;
  const hAtQ = getHeadAtFlow(pump.qhCurve, flowM3h);
  return hAtQ !== null && hAtQ >= headM;
}

function matchesCMI(pump, flowLpm, headM) {
  if (pump.flowUnit !== "lpm") return false;
  const maxFlow = pump.maxFlow;
  const recHead = pump.minHead ?? 0;
  const maxHead = pump.maxHead || 0;
  if (headM > maxHead) return false;
  if (maxFlow == null || maxFlow <= 0) return headM <= maxHead;
  if (flowLpm > maxFlow) return false;
  const headCriteria = recHead > 0 ? (recHead + maxHead) / 2 : headM;
  const hAtQ = maxHead - ((maxHead - recHead) * flowLpm) / maxFlow;
  return hAtQ >= headCriteria;
}

function getFlowDistanceNorm(pump, flowM3h, flowLpm) {
  if (pump.flowUnit === "m3h" && pump.qhCurve?.length && flowM3h > 0) {
    const qValues = pump.qhCurve.map((pt) => pt.q);
    const minDist = Math.min(...qValues.map((q) => Math.abs(flowM3h - q)));
    return minDist / flowM3h;
  }
  if (pump.flowUnit === "lpm" && pump.maxFlow && flowLpm > 0) {
    return Math.abs(flowLpm - pump.maxFlow) / flowLpm;
  }
  return 0;
}

/** CVF 정격 유량 대비 운영 유량 비율. 1에 가까울수록 최적. 상단 1/3(최대 근처)이면 불리 */
function getCvfFlowZoneScore(pump, flowPerPumpM3h) {
  const nominal = getNominalFlowFromSheet(pump.sheet);
  if (nominal == null || flowPerPumpM3h <= 0) return 1;
  const curve = pump.qhCurve || [];
  if (curve.length < 2) return 1;
  const qMin = Math.min(...curve.map((p) => p.q));
  const qMax = Math.max(...curve.map((p) => p.q));
  const qRange = qMax - qMin || 1;
  const nominalDist = Math.abs(flowPerPumpM3h - nominal) / nominal;
  const zoneRatio = (flowPerPumpM3h - qMin) / qRange;
  let zonePenalty = 0;
  if (zoneRatio > 0.85) zonePenalty = (zoneRatio - 0.85) * 2;
  return 1 / (1 + nominalDist + zonePenalty);
}

/**
 * FV/EFV 소방펌프 선정: 유량구간 → 정격양정 → 모델
 * 정확히 맞는 모델이 없으면 한 단계 높은 유량구간에서 선정
 */
function selectFVEFV(catalogData, params) {
  const { flow, flowUnit, head } = params;
  const flowM3min = FLOW_TO_M3MIN[flowUnit] ? FLOW_TO_M3MIN[flowUnit](flow) : flow;

  const flowRanges = catalogData.flowRanges || [];
  const headRows = catalogData.headRows || [];

  if (flowRanges.length === 0 || headRows.length === 0) return [];

  // 1) 유량구간 찾기: user flow <= nominalFlow 인 첫 구간 (해당 유량 구간)
  let flowColIdx = -1;
  for (let i = 0; i < flowRanges.length; i++) {
    if (flowM3min <= flowRanges[i].nominalFlow) {
      flowColIdx = i;
      break;
    }
  }
  if (flowColIdx < 0) flowColIdx = flowRanges.length - 1;

  // 2) 해당 유량구간에서 정격양정을 기준으로
  //    요구 양정보다 \"살짝 위이면서\" 가장 가까운 모델 선택
  const pickModelForCol = (colIndex) => {
    const candidates = [];
    for (let i = 0; i < headRows.length; i++) {
      const m = headRows[i].models[colIndex];
      if (!m) continue;
      candidates.push({ idx: i, head: headRows[i].nominalHead, model: m });
    }
    if (candidates.length === 0) return null;

    const higher = candidates.filter((c) => c.head >= head);
    let chosen;
    if (higher.length > 0) {
      // 요구 양정보다 크거나 같은 값 중에서 (head - 요청양정)이 가장 작은 것
      chosen = higher.reduce((best, c) =>
        c.head - head < best.head - head ? c : best
      );
    } else {
      // 모두 요청 양정보다 작다면, 그 중에서 가장 큰 양정 선택
      chosen = candidates.reduce((best, c) => (c.head > best.head ? c : best));
    }
    return chosen;
  };

  let chosen = pickModelForCol(flowColIdx);

  // 3) 현재 유량구간에 모델이 없으면 한 단계 높은 유량구간에서 재탐색
  if (!chosen && flowColIdx < flowRanges.length - 1) {
    flowColIdx++;
    chosen = pickModelForCol(flowColIdx);
  }

  if (!chosen) return [];

  const { model } = chosen;

  return [
    {
      model,
      flowUnit: "m3min",
      nominalFlow: flowRanges[flowColIdx].nominalFlow,
      headAtFlow: head,
      idx: -1,
    },
  ];
}

function selectPumps(catalogData, params) {
  const { usage, flow, flowUnit, head, pumpType, power, quantity, selfPriming } = params;
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const flowM3h = flowToM3h(flow, flowUnit);
  const flowLpm = flowToLpm(flow, flowUnit);
  const flowPerPumpM3h = flowM3h / qty;
  const flowLpmForCMI = flowLpm;

  const pumpTypeSheets = SHEET_BY_PUMP_TYPE[pumpType] || [];
  const powerSheets = SHEET_BY_POWER[power] || [];

  const filtered = catalogData.pumps.filter((p) => {
    if (usage === "소방") return false;
    if (!pumpTypeSheets.includes(p.sheet) || !powerSheets.includes(p.sheet)) return false;
    if (p.power !== power) return false;
    if (selfPriming && !isSelfPriming(p)) return false;
    if (pumpType === "입형") {
      const pQty = getPumpQtyForFilter(p);
      if (pQty !== qty) return false;
      return matchesCVF(p, flowPerPumpM3h, head);
    }
    if (pumpType === "횡형") {
      const m = (p.model || "").match(/^(\d+)-/);
      if (m && parseInt(m[1], 10) !== qty) return false;
      if (!m && qty > 1) return false;
      return matchesCMI(p, flowLpmForCMI, head);
    }
    return false;
  });

  const scored = filtered.map((p) => {
    let hAtQ = 0;
    if (p.flowUnit === "m3h") {
      hAtQ = getHeadAtFlow(p.qhCurve, flowPerPumpM3h) || 0;
    } else {
      const maxFlow = p.maxFlow || 0;
      const maxHead = p.maxHead || 0;
      const recHead = p.minHead ?? 0;
      hAtQ = maxFlow > 0 ? maxHead - ((maxHead - recHead) * flowLpmForCMI) / maxFlow : maxHead;
    }
    const margin = hAtQ - head;
    const marginRatioPct = head > 0 ? margin / head : 0;
    const nominalFlow = getNominalFlowFromSheet(p.sheet);
    let flowScore;
    if (p.flowUnit === "m3h" && nominalFlow != null && flowPerPumpM3h > 0) {
      flowScore = getCvfFlowZoneScore(p, flowPerPumpM3h);
    } else {
      const flowDistNorm = getFlowDistanceNorm(p, flowPerPumpM3h, flowLpm);
      flowScore = 1 / (1 + flowDistNorm);
    }
    const headScore = margin >= 0 ? 1 / (1 + marginRatioPct) : 0;
    const score = headScore * 0.45 + flowScore * 0.55;
    return { ...p, idx: catalogData.pumps.indexOf(p), margin, marginRatioPct, score, headAtFlow: hAtQ };
  });

  scored.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const unique = scored.filter((p) => {
    const key = getBaseModelKey(p.model);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const exact = unique.filter((p) => p.margin >= 0);
  const result = exact.length >= 2 ? exact.slice(0, 5) : unique.slice(0, Math.min(2, unique.length));

  return result.map((p) => ({
    ...p,
    model: p.model,
    sheet: p.sheet,
    motor: p.motor,
    flowUnit: p.flowUnit,
    headAtFlow: p.headAtFlow,
    minHead: p.minHead,
    maxHead: p.maxHead,
  }));
}

function renderQHChart(pump) {
  const rawCurve = pump.qhCurve || [];
  if (rawCurve.length < 2) {
    return "<p style='padding:20px;color:#fff'>Q-H 데이터 없음</p>";
  }

  // 펌프 수량에 따라 유량 축 스케일: CVF는 1대당 곡선 저장 → 총 유량으로 변환
  const pumpQty = getPumpQuantityFromModel(pump.model, pump);
  const curve =
    pump.flowUnit === "m3h" && pumpQty > 1
      ? rawCurve.map((p) => ({ q: p.q * pumpQty, h: p.h }))
      : rawCurve;

  // 사용자 입력 포인트 계산 (총 유량)
  let userPoint = null;
  if (currentUserFlow != null && currentUserHead != null && currentUserFlowUnit) {
    let userFlow = currentUserFlow;
    if (pump.flowUnit === "m3h") {
      userFlow = flowToM3h(currentUserFlow, currentUserFlowUnit);
    } else if (pump.flowUnit === "lpm") {
      userFlow = flowToLpm(currentUserFlow, currentUserFlowUnit);
    }
    if (!isNaN(userFlow) && !isNaN(currentUserHead) && userFlow >= 0 && currentUserHead >= 0) {
      userPoint = { q: userFlow, h: currentUserHead };
    }
  }

  const padding = { top: 20, right: 20, bottom: 35, left: 45 };
  const w = 308;
  const h = 244;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const qValues = curve.map((p) => p.q);
  const hValues = curve.map((p) => p.h);
  let dataQMax = Math.max(...qValues);
  let dataHMax = Math.max(...hValues);
  // 노란점이 보이도록 차트 범위에 사용자 포인트 포함
  if (userPoint) {
    dataQMax = Math.max(dataQMax, userPoint.q);
    dataHMax = Math.max(dataHMax, userPoint.h);
  }
  const qMin = 0;
  const qMaxForData = Math.ceil((dataQMax * 1.1) / 5) * 5 || 10;
  const qMaxForUser = userPoint ? Math.ceil((userPoint.q * 1.15) / 5) * 5 : 0;
  const qMax = Math.max(qMaxForData, qMaxForUser, 10);
  const hMin = 0;
  const hMaxForData = Math.max(50, Math.ceil((dataHMax + 20) / 10) * 10);
  const hMaxForUser = userPoint ? Math.ceil((userPoint.h * 1.15) / 10) * 10 : 0;
  const hMax = Math.max(hMaxForData, hMaxForUser);
  const hRange = hMax - hMin || 1;
  const qRange = qMax - qMin || 1;

  const x = (q) => padding.left + ((q - qMin) / qRange) * chartW;
  const y = (hVal) => padding.top + chartH - ((hVal - hMin) / hRange) * chartH;

  const pathD = curve
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.q)} ${y(p.h)}`)
    .join(" ");

  const gridStroke = "#555";
  const gridLines = [];
  for (let hm = 0; hm <= hMax; hm += 10) {
    const isMajor = hm % 50 === 0;
    gridLines.push(
      `<line x1="${x(qMin)}" y1="${y(hm)}" x2="${x(qMax)}" y2="${y(hm)}" stroke="${gridStroke}" stroke-width="${isMajor ? 1.2 : 0.5}"/>`
    );
  }
  for (let i = 1; i <= 4; i++) {
    const q = qMin + (qRange * i) / 4;
    gridLines.push(
      `<line x1="${x(q)}" y1="${y(hMin)}" x2="${x(q)}" y2="${y(hMax)}" stroke="${gridStroke}" stroke-width="0.5"/>`
    );
  }

  const textFill = "#fff";
  const qUnit = pump.flowUnit === "m3h" ? "m³/h" : "LPM";
  const axisLabels = [
    `<text x="${padding.left + chartW / 2}" y="${h + 2}" text-anchor="middle" fill="${textFill}" font-size="15">유량 Q (${qUnit})</text>`,
    `<text x="12" y="${padding.top + chartH / 2}" text-anchor="middle" fill="${textFill}" font-size="15" transform="rotate(-90, 12, ${padding.top + chartH / 2})">양정 H (m)</text>`,
  ];

  const tickLabels = [];
  const headTickStep = hMax <= 60 ? 10 : hMax <= 120 ? 20 : 50;
  for (let hv = 0; hv <= hMax; hv += headTickStep) {
    tickLabels.push(
      `<text x="${padding.left - 8}" y="${y(hv)}" text-anchor="end" fill="${textFill}" font-size="15">${hv}</text>`
    );
  }
  for (let i = 0; i <= 4; i++) {
    const qVal = qMin + (qRange * i) / 4;
    const label = qVal >= 1000 ? qVal.toFixed(0) : qVal % 1 === 0 ? qVal : qVal.toFixed(1);
    tickLabels.push(
      `<text x="${x(qVal)}" y="${h - 15}" text-anchor="middle" fill="${textFill}" font-size="15">${label}</text>`
    );
  }

  const userPointMark = userPoint
    ? `<circle cx="${x(userPoint.q)}" cy="${y(userPoint.h)}" r="4" fill="#ffd700" stroke="#fff" stroke-width="1"/>`
    : "";

  return `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      ${gridLines.join("")}
      <path d="${pathD}" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
      ${curve.map((p) => `<circle cx="${x(p.q)}" cy="${y(p.h)}" r="1.5" fill="#fff"/>`).join("")}
      ${userPointMark}
      ${axisLabels.join("")}
      ${tickLabels.join("")}
    </svg>
  `;
}

function toggleUsageFields(usage) {
  // 부스터/소방펌프/엔진펌프 모두 동일한 레이아웃 유지 (종류, 펌프타입, 펌프수량, 전원, 자흡조건 항상 표시)
}

document.getElementById("usage")?.addEventListener("change", (e) => {
  toggleUsageFields(e.target.value);
});
toggleUsageFields(document.getElementById("usage")?.value || "부스터");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const usage = document.getElementById("usage").value;
  const flow = parseFloat(document.getElementById("flow").value);
  const head = parseFloat(document.getElementById("head").value);
  const flowUnit = document.getElementById("flowUnit").value;
  const pumpType = document.getElementById("pumpType").value;
  const power = document.getElementById("power").value;
  const quantity = document.getElementById("quantity").value;
  const selfPriming = document.getElementById("selfPriming").checked;

  if (isNaN(flow) || flow <= 0) {
    showError("유량을 올바르게 입력해 주세요.");
    return;
  }
  if (isNaN(head) || head <= 0) {
    showError("양정을 올바르게 입력해 주세요.");
    return;
  }

  try {
    let results = [];
    if (usage === "FV" || usage === "EFV") {
      const url = usage === "FV" ? FV_CATALOG_URL : EFV_CATALOG_URL;
      let data = usage === "FV" ? fvCatalog : efvCatalog;
      if (!data) {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("카타로그를 불러올 수 없습니다.");
        data = await res.json();
        if (usage === "FV") fvCatalog = data;
        else efvCatalog = data;
      }
      results = selectFVEFV(data, { flow, flowUnit, head });
    } else {
      if (!catalog) {
        const res = await fetch(CATALOG_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("카타로그를 불러올 수 없습니다.");
        catalog = await res.json();
      }
      results = selectPumps(catalog, {
        usage,
        flow,
        flowUnit,
        head,
        pumpType,
        power,
        quantity,
        selfPriming,
      });
    }

    if (results.length === 0) {
      showError("추천 모델이 없습니다.");
    } else {
      currentUserFlow = flow;
      currentUserHead = head;
      currentUserFlowUnit = flowUnit;
      currentUserQty = Math.max(1, parseInt(quantity, 10) || 1);
      showResults(results);
    }
  } catch (err) {
    showError(err.message || "오류가 발생했습니다. 네트워크 연결을 확인해 주세요.");
  }
});

document.getElementById("chartBackBtn")?.addEventListener("click", () => {
  chartOverlay.classList.add("hidden");
});
chartOverlay?.addEventListener("click", (e) => {
  if (e.target === chartOverlay) chartOverlay.classList.add("hidden");
});

// Service Worker 비활성화 - 네트워크 우선으로 항상 최신 파일 로드
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}
