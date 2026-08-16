const replay = await fetch("./data/context-run.json").then((response) => {
  if (!response.ok) throw new Error(`Unable to load replay data: ${response.status}`);
  return response.json();
});

const steps = replay.steps;
const byId = (id) => document.getElementById(id);
const svg = byId("graph");
const namespace = "http://www.w3.org/2000/svg";
const make = (name, attributes = {}) => {
  const element = document.createElementNS(namespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
};

const copy = {
  zh: {
    title: "Context 工作图回放",
    case: "案例说明",
    journey: "决策旅程",
    play: "▶ 播放",
    pause: "Ⅱ 暂停",
    previous: "上一步",
    next: "下一步",
    speed: "播放速度",
    scrubber: "回放步骤",
    theme: "切换主题",
    inspector: "这一步发生了什么",
    explainer: "路线说明",
    brandLabel: "Agent Graph 实践案例",
    state: "当前状态",
    why: "为什么走到这里",
    action: "下一步行动",
    evidence: "完成证据",
    time: "相对时间",
    command: "CLI 调用",
    protocol: "协议字段",
    steps: "步",
    actionable: "可执行",
    waiting: "等待授权或决策",
    complete: "目标完成",
    single: "一次推进",
    loop: "循环",
    checkpoint: "检查点",
    fields: ["来源事实", "代码知识", "文档知识", "知识包结果"],
    provenance: "这是对真实 Context 调试记录的脱敏投影：保留路由顺序、循环、状态与相对时间，不包含来源正文、私有路径和不透明标识。"
  },
  en: {
    title: "Context Work Graph Replay",
    case: "Case study",
    journey: "Decision journey",
    play: "▶ Play",
    pause: "Ⅱ Pause",
    previous: "Previous step",
    next: "Next step",
    speed: "Playback speed",
    scrubber: "Replay step",
    theme: "Toggle theme",
    inspector: "What happened at this step",
    explainer: "ROUTE EXPLAINER",
    brandLabel: "Agent Graph case studies",
    state: "Current state",
    why: "Why this route",
    action: "Next action",
    evidence: "Completion evidence",
    time: "Relative time",
    command: "CLI invocation",
    protocol: "Protocol fields",
    steps: "steps",
    actionable: "Actionable",
    waiting: "Waiting for authority or a decision",
    complete: "Goal complete",
    single: "Single pass",
    loop: "Loop",
    checkpoint: "Checkpoint",
    fields: ["SOURCE FACTS", "CODE KNOWLEDGE", "PROSE KNOWLEDGE", "PACKAGE OUTCOME"],
    provenance: "This is a sanitized projection of a real Context debug recording. It preserves route order, loops, status, and relative timing without source text, private paths, or opaque identifiers."
  }
};

const nodes = {
  "choose-source-boundary": {
    phase: "SCOPE",
    zh: ["定义知识边界", "用户已提出目标，但本轮允许读取的来源尚未确定。", "登记本轮允许使用的代码与文档来源。", "来源清单及授权边界已成为工作区事实。"],
    en: ["Define knowledge scope", "The goal exists, but the sources permitted for this run are not yet fixed.", "Register the code and document sources allowed in this run.", "The source list and authority boundary become workspace facts."]
  },
  "configure-document-capture": {
    phase: "CAPTURE",
    zh: ["配置文档采集", "已登记文档来源，但项目尚未声明如何采集它们。", "为已登记文档声明确定性的采集阶段。", "每个文档来源都有可执行的采集目标。"],
    en: ["Configure document capture", "Document sources are registered, but the project has not declared how to capture them.", "Declare deterministic capture phases for the registered documents.", "Every document source has an executable capture target."]
  },
  "authorize-document-capture": {
    phase: "AUTHORITY",
    zh: ["授权读取来源", "采集动作需要读取外部来源，当前会话尚未持有对应权限。", "取得本次会话的来源读取授权。", "会话 Authority 允许采集动作继续。"],
    en: ["Authorize source reads", "Capture needs to read external sources, but the session does not yet hold that authority.", "Obtain source-read authority for this session.", "Session authority permits the capture actions to continue."]
  },
  "capture-next": {
    phase: "CAPTURE",
    zh: ["采集来源快照", "仍有文档来源缺少可审计快照。", "采集下一份来源并记录证据摘要。", "该来源的快照与资源清单已落盘。"],
    en: ["Capture source snapshot", "At least one document source still lacks an auditable snapshot.", "Capture the next source and record its evidence digest.", "The source snapshot and resource inventory are persisted."]
  },
  "configure-code-extraction": {
    phase: "CODE",
    zh: ["配置代码提取", "代码模块已经登记，但尚未声明提取范围。", "为模块声明代码知识提取阶段。", "每个模块都有明确的提取目标。"],
    en: ["Configure code extraction", "Code modules are registered, but their extraction scope is not declared.", "Declare code-knowledge extraction phases for the modules.", "Every module has an explicit extraction target."]
  },
  "extract-next": {
    phase: "CODE",
    zh: ["提取代码知识", "仍有模块缺少与当前源码一致的代码知识候选。", "从下一模块提取符号与关系候选。", "候选与源码摘要形成可验证绑定。"],
    en: ["Extract code knowledge", "At least one module still lacks code candidates matching its current source.", "Extract symbols and relations from the next module.", "Candidates are bound to verifiable source digests."]
  },
  "apply-managed-review": {
    phase: "GATE",
    zh: ["审核代码候选", "代码批次提取完成，候选尚未进入批准知识。", "依据本次托管授权原子应用审核决策。", "候选以明确决定写入批准知识。"],
    en: ["Review code candidates", "The code batch is extracted, but its candidates are not approved knowledge yet.", "Atomically apply review decisions under the current managed authority.", "Candidates enter approved knowledge with explicit decisions."]
  },
  "close-approved-knowledge": {
    phase: "CHECKPOINT",
    zh: ["固化知识投影", "批准页面已变化，结构投影仍对应旧事实。", "从已批准页面确定性重建知识投影。", "页面、节点和关系投影彼此一致。"],
    en: ["Close knowledge projection", "Approved pages changed while the structure projection still reflects older facts.", "Deterministically rebuild the projection from approved pages.", "Pages, nodes, and relation projections agree."]
  },
  "configure-prose-lifecycle": {
    phase: "PROSE",
    zh: ["配置文档知识流程", "文档快照已存在，但尚未声明结构与编译目标。", "为文档声明结构规划、编译和审核阶段。", "文档来源拥有完整的知识生产路径。"],
    en: ["Configure prose workflow", "Document snapshots exist, but structure and compile targets are not declared.", "Declare structure, compile, and review phases for documents.", "Document sources have a complete knowledge-production path."]
  },
  "align-next": {
    phase: "PROSE",
    zh: ["设计知识结构", "仍有文档来源没有经过确认的页面结构。", "读取当前所需证据并确认页面与章节边界。", "结构快照绑定来源摘要并通过校验。"],
    en: ["Design knowledge structure", "At least one document source lacks a confirmed page structure.", "Read the required evidence and confirm page and section boundaries.", "The structure snapshot is validated and bound to source digests."]
  },
  "compile-next": {
    phase: "PROSE",
    zh: ["编译知识页面", "仍有确认结构尚未编译成候选页面。", "按已确认结构编译下一批知识页面。", "页面候选保留逐节来源绑定。"],
    en: ["Compile knowledge pages", "At least one confirmed structure has not been compiled into candidate pages.", "Compile the next batch of pages from the confirmed structure.", "Page candidates retain section-level source bindings."]
  },
  "apply-resumed-review": {
    phase: "GATE",
    zh: ["审核文档候选", "完整文档批次已编译，候选等待统一决策。", "原子应用完整批次的审核决定。", "候选集合一次性进入批准知识。"],
    en: ["Review prose candidates", "The complete document batch is compiled and awaits one review decision set.", "Atomically apply review decisions to the complete batch.", "The candidate set enters approved knowledge as one transaction."]
  },
  "configure-package-output": {
    phase: "PACKAGE",
    zh: ["配置知识包输出", "知识已经关闭，但还没有声明面向消费端的产物。", "声明包名、模板和分发出口。", "构建器拥有明确的输出契约。"],
    en: ["Configure package output", "Knowledge is closed, but no consumer-facing output is declared.", "Declare the package identity, template, and distribution output.", "The builder has an explicit output contract."]
  },
  "review-package-template": {
    phase: "GATE",
    zh: ["确认消费入口", "生成的查询入口与模板需要在发布前确认。", "确认将进入知识包的消费入口。", "模板选择成为可审计的用户决定。"],
    en: ["Confirm consumer entry", "Generated query entrypoints and templates require confirmation before publication.", "Confirm the consumer entrypoints included in the package.", "Template selection becomes an auditable user decision."]
  },
  "build-next": {
    phase: "PACKAGE",
    zh: ["构建可消费知识包", "批准知识或输出配置比当前产物更新。", "构建知识包并执行确定性验证。", "产物清单与知识摘要一致。"],
    en: ["Build consumable package", "Approved knowledge or output configuration is newer than the current artifact.", "Build the package and run deterministic verification.", "The artifact inventory matches the knowledge digest."]
  },
  complete: {
    phase: "OUTCOME",
    zh: ["目标完成", "所有声明目标均已满足，没有待处理门禁或陈旧产物。", "停止执行并保留可恢复记录。", "最终状态由外部事实与构建证据证明。"],
    en: ["Goal complete", "Every declared target is satisfied with no pending gate or stale artifact.", "Stop execution and preserve the recoverable record.", "External facts and build evidence prove the final state."]
  }
};

const commands = {
  "choose-source-boundary": "context --workflow-managed source add batch --input <source-batch> --format json",
  "configure-document-capture": "context status --managed --format json",
  "authorize-document-capture": "context run --managed --authority context.source-read --until blocked-or-complete --format json",
  "capture-next": "context --workflow-managed --workflow-authority context.source-read run capture:document-source --format json",
  "configure-code-extraction": "context status --managed --format json",
  "extract-next": "context --workflow-managed run extract:module-source:codegraph --format json",
  "apply-managed-review": "context --workflow-managed review approve-all codegraph --managed --format json",
  "close-approved-knowledge": "context --workflow-managed close --format json",
  "configure-prose-lifecycle": "context status --managed --format json",
  "align-next": "context --workflow-managed run align:document-source:collection --view read-plan --format json",
  "compile-next": "context --workflow-managed run compile:document-source:collection --stage --format json",
  "apply-resumed-review": "context --workflow-managed review approve-all --all --managed --format json",
  "configure-package-output": "context status --managed --format json",
  "review-package-template": "context package template accept --all --format json",
  "build-next": "context build --format json",
  complete: "context status --managed --format json"
};

const positions = [
  [58, 72], [270, 52], [490, 92], [714, 54], [886, 160],
  [742, 238], [520, 212], [292, 268], [74, 354], [286, 404],
  [518, 350], [748, 416], [914, 326], [812, 520], [580, 494],
  [348, 548], [92, 510]
];

const instances = [];
for (const step of steps) {
  const previous = instances.at(-1);
  if (previous?.node === step.node) previous.steps.push(step);
  else instances.push({ node: step.node, steps: [step] });
}

const positionOf = (index) => ({ x: positions[index][0], y: positions[index][1] });
const port = (node, side) => {
  if (side === "top") return { x: node.x + 91, y: node.y, nx: 0, ny: -1 };
  if (side === "right") return { x: node.x + 182, y: node.y + 35, nx: 1, ny: 0 };
  if (side === "bottom") return { x: node.x + 91, y: node.y + 70, nx: 0, ny: 1 };
  return { x: node.x, y: node.y + 35, nx: -1, ny: 0 };
};
const boundary = (node, toward) => {
  const center = { x: node.x + 91, y: node.y + 35 };
  const other = { x: toward.x + 91, y: toward.y + 35 };
  const dx = other.x - center.x;
  const dy = other.y - center.y;
  if (Math.abs(dx) / 91 >= Math.abs(dy) / 35) {
    const sign = dx >= 0 ? 1 : -1;
    const scale = 91 / Math.max(Math.abs(dx), .001);
    return { x: center.x + sign * 91, y: center.y + dy * scale, nx: sign, ny: 0 };
  }
  const sign = dy >= 0 ? 1 : -1;
  const scale = 35 / Math.max(Math.abs(dy), .001);
  return { x: center.x + dx * scale, y: center.y + sign * 35, nx: 0, ny: sign };
};

const defs = make("defs");
for (const [id, className] of [["arrow", "arrow-default"], ["arrow-visited", "arrow-visited"], ["arrow-active", "arrow-active"]]) {
  const marker = make("marker", { id, viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 4.5, markerHeight: 4.5, orient: "auto" });
  marker.append(make("path", { d: "M 0 0 L 10 5 L 0 10 z", class: className }));
  defs.append(marker);
}
svg.append(defs);
const fieldLayer = make("g");
const edgeLayer = make("g");
const nodeLayer = make("g");
svg.append(fieldLayer, edgeLayer, nodeLayer);

const fields = [
  { x: 38, y: 30, w: 852, h: 116 },
  { x: 270, y: 170, w: 800, h: 140 },
  { x: 44, y: 318, w: 1022, h: 148 },
  { x: 64, y: 474, w: 922, h: 130 }
];
const fieldLabels = [];
fields.forEach((field, index) => {
  fieldLayer.append(make("rect", { ...field, rx: 28, class: "field" }));
  const label = make("text", { x: field.x + 18, y: field.y + 22, class: "field-label" });
  fieldLayer.append(label);
  fieldLabels.push({ label, index });
});

const overrides = new Map([
  ["capture-next>configure-code-extraction", ["right", "top"]],
  ["configure-code-extraction>extract-next", ["bottom", "right"]],
  ["close-approved-knowledge>configure-prose-lifecycle", ["left", "top"]],
  ["configure-prose-lifecycle>align-next", ["bottom", "left"]],
  ["align-next>compile-next", ["right", "left"]],
  ["compile-next>apply-resumed-review", ["right", "left"]],
  ["apply-resumed-review>close-approved-knowledge", ["right", "bottom"]],
  ["close-approved-knowledge>configure-package-output", ["bottom", "right"]]
]);
const edges = [];
for (let index = 0; index < instances.length - 1; index += 1) {
  const from = positionOf(index);
  const to = positionOf(index + 1);
  const pair = `${instances[index].node}>${instances[index + 1].node}`;
  const override = overrides.get(pair);
  const start = override ? port(from, override[0]) : boundary(from, to);
  const end = override ? port(to, override[1]) : boundary(to, from);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const curve = Math.max(34, Math.min(82, distance * .24));
  const path = make("path", {
    d: `M ${start.x} ${start.y} C ${start.x + start.nx * curve} ${start.y + start.ny * curve}, ${end.x + end.nx * curve} ${end.y + end.ny * curve}, ${end.x} ${end.y}`,
    class: "edge"
  });
  edgeLayer.append(path);
  edges.push(path);
}

const nodeElements = [];
const loops = new Map();
instances.forEach((instance, index) => {
  const position = positionOf(index);
  const group = make("g", { class: "node future", transform: `translate(${position.x} ${position.y})` });
  group.append(make("rect", { width: 182, height: 70, rx: 13 }));
  group.append(make("circle", { cx: 16, cy: 17, r: 3, class: "dot" }));
  const phase = make("text", { x: 27, y: 20, class: "phase" });
  const name = make("text", { x: 14, y: 43, class: "name" });
  const count = make("text", { x: 168, y: 58, class: "count", "text-anchor": "end" });
  group.append(phase, name, count);
  nodeLayer.append(group);
  nodeElements.push({ instance, group, phase, name, count });
  if (instance.steps.length > 1) {
    const loop = make("path", { d: `M ${position.x + 72} ${position.y - 4} A 27 27 0 1 1 ${position.x + 110} ${position.y - 4}`, class: "edge" });
    edgeLayer.append(loop);
    loops.set(index, loop);
  }
});

const requestedLanguage = new URLSearchParams(window.location.search).get("lang");
let language = requestedLanguage === "zh" ? "zh" : "en";
const state = { index: 0, playing: false, timer: undefined };
const localized = (node) => nodes[node][language === "zh" ? "zh" : "en"];
const elapsed = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const statusText = (status) => status === "complete" ? copy[language].complete : status === "waiting-user" ? copy[language].waiting : copy[language].actionable;

const countText = (instance, currentStep) => {
  const c = copy[language];
  if (instance.steps.length > 1) {
    const done = instance.steps.filter((step) => steps.indexOf(step) <= currentStep).length;
    return `${c.loop} ${done} / ${instance.steps.length}`;
  }
  const step = instance.steps[0];
  if (step.checkpoint) return `${c.checkpoint} ${step.checkpoint}/${step.checkpoints}`;
  return c.single;
};

function renderList() {
  const list = byId("event-list");
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  steps.forEach((step, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-item${index === state.index ? " active" : ""}`;
    const number = document.createElement("span");
    number.className = "event-step";
    number.textContent = String(index + 1).padStart(2, "0");
    const body = document.createElement("span");
    body.className = "event-copy";
    const title = document.createElement("span");
    title.className = "event-title";
    title.textContent = localized(step.node)[0];
    body.append(title);
    button.append(number, body);
    button.addEventListener("click", () => { pause(); state.index = index; render(); });
    fragment.append(button);
  });
  list.append(fragment);
  byId("rail-count").textContent = `${steps.length} ${copy[language].steps}`;
}

function renderGraph() {
  const currentStep = steps[state.index];
  let currentInstance = 0;
  instances.forEach((instance, index) => {
    if (instance.steps.some((step) => steps.indexOf(step) <= state.index)) currentInstance = index;
  });
  nodeElements.forEach(({ instance, group, phase, name, count }, index) => {
    phase.textContent = nodes[instance.node].phase;
    name.textContent = localized(instance.node)[0];
    count.textContent = countText(instance, state.index);
    group.setAttribute("class", `node ${index > currentInstance ? "future" : "visited"}${index === currentInstance ? " current" : ""}${instance.node === "complete" && currentStep.node === "complete" ? " complete" : ""}`);
  });
  edges.forEach((edge, index) => {
    const className = index === currentInstance - 1 ? "edge current" : index < currentInstance - 1 ? "edge visited" : "edge";
    edge.setAttribute("class", className);
    edge.setAttribute("marker-end", className.includes("current") ? "url(#arrow-active)" : className.includes("visited") ? "url(#arrow-visited)" : "url(#arrow)");
  });
  loops.forEach((loop, index) => {
    const className = index < currentInstance ? "edge visited" : index === currentInstance ? "edge current" : "edge";
    loop.setAttribute("class", className);
    loop.setAttribute("marker-end", className.includes("current") ? "url(#arrow-active)" : className.includes("visited") ? "url(#arrow-visited)" : "url(#arrow)");
  });
  fieldLabels.forEach(({ label, index }) => { label.textContent = copy[language].fields[index]; });
}

function renderInspector() {
  const step = steps[state.index];
  const text = localized(step.node);
  byId("state-value").textContent = statusText(step.status);
  byId("why-value").textContent = text[1];
  byId("action-value").textContent = text[2];
  byId("evidence-value").textContent = text[3];
  byId("sequence-value").textContent = elapsed(step.elapsed);
  byId("command-value").textContent = commands[step.node];
  byId("technical-value").textContent = `statusCode: ${step.status}\nreasonCode: ${step.reasonCode}\nnode: ${step.node}`;
}

function render() {
  const step = steps[state.index];
  byId("step-count").textContent = `${state.index + 1} / ${steps.length}`;
  byId("event-time").textContent = elapsed(step.elapsed);
  byId("scrubber").max = String(steps.length - 1);
  byId("scrubber").value = String(state.index);
  byId("progress-fill").style.width = `${state.index / (steps.length - 1) * 100}%`;
  byId("previous").disabled = state.index === 0;
  byId("next").disabled = state.index === steps.length - 1;
  renderGraph();
  renderInspector();
  document.querySelectorAll(".event-item").forEach((item, index) => item.classList.toggle("active", index === state.index));
  document.querySelector(".event-item.active")?.scrollIntoView({ block: "nearest" });
}

function applyLanguage() {
  const c = copy[language];
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = language === "zh" ? "Context · Agent Graph 实践案例" : "Context · Agent Graph case study";
  byId("brand-link").setAttribute("aria-label", c.brandLabel);
  byId("page-title").textContent = c.title;
  byId("case-link").textContent = c.case;
  byId("case-link").href = language === "zh"
    ? "https://github.com/context4ai/agent-graph/blob/main/docs/zh-CN/case-studies/context.md"
    : "https://github.com/context4ai/agent-graph/blob/main/docs/en/case-studies/context.md";
  byId("language").textContent = language === "zh" ? "EN" : "中文";
  byId("theme").setAttribute("aria-label", c.theme);
  byId("previous").setAttribute("aria-label", c.previous);
  byId("next").setAttribute("aria-label", c.next);
  byId("speed").setAttribute("aria-label", c.speed);
  byId("scrubber").setAttribute("aria-label", c.scrubber);
  byId("play").textContent = state.playing ? c.pause : c.play;
  byId("rail-title").textContent = c.journey;
  byId("inspector-title").textContent = c.inspector;
  byId("explainer-label").textContent = c.explainer;
  byId("state-label").textContent = c.state;
  byId("why-label").textContent = c.why;
  byId("action-label").textContent = c.action;
  byId("evidence-label").textContent = c.evidence;
  byId("time-label").textContent = c.time;
  byId("command-summary").textContent = c.command;
  byId("technical-summary").textContent = c.protocol;
  byId("provenance").textContent = c.provenance;
  svg.setAttribute("aria-label", language === "zh" ? "Context 工作图" : "Context work graph");
  renderList();
  render();
}

function pause() {
  state.playing = false;
  clearTimeout(state.timer);
  byId("play").textContent = copy[language].play;
}

function tick() {
  if (!state.playing) return;
  if (state.index >= steps.length - 1) { pause(); return; }
  state.index += 1;
  render();
  state.timer = setTimeout(tick, Number(byId("speed").value));
}

function togglePlay() {
  if (state.playing) { pause(); return; }
  if (state.index === steps.length - 1) state.index = 0;
  state.playing = true;
  byId("play").textContent = copy[language].pause;
  render();
  state.timer = setTimeout(tick, Number(byId("speed").value));
}

byId("play").addEventListener("click", togglePlay);
byId("previous").addEventListener("click", () => { pause(); state.index = Math.max(0, state.index - 1); render(); });
byId("next").addEventListener("click", () => { pause(); state.index = Math.min(steps.length - 1, state.index + 1); render(); });
byId("scrubber").addEventListener("input", (event) => { pause(); state.index = Number(event.target.value); render(); });
byId("speed").addEventListener("change", () => { if (state.playing) { clearTimeout(state.timer); state.timer = setTimeout(tick, Number(byId("speed").value)); } });
byId("theme").addEventListener("click", () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; });
byId("language").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  const url = new URL(window.location.href);
  url.searchParams.set("lang", language);
  window.history.replaceState({}, "", url);
  applyLanguage();
});
document.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (event.code === "Space") { event.preventDefault(); togglePlay(); }
  if (event.key === "ArrowLeft") { pause(); state.index = Math.max(0, state.index - 1); render(); }
  if (event.key === "ArrowRight") { pause(); state.index = Math.min(steps.length - 1, state.index + 1); render(); }
});

applyLanguage();
