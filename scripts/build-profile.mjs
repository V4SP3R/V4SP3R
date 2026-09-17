#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const USER = process.env.GH_USER || "V4SP3R";
const TOKEN = process.env.GITHUB_TOKEN;
const OFFLINE = process.env.PROFILE_OFFLINE === "1" || process.argv.includes("--offline");
const OUT = resolve(ROOT, "assets", "profile.svg");
const VISITOR_PAGE_ID = process.env.VISITOR_PAGE_ID || USER + "." + USER;

const C = {
  bg: "#071018",
  bg2: "#0B1620",
  panel: "#0A141D",
  card: "#0C1822",
  border: "#233443",
  line: "#263746",
  blue: "#2F81F7",
  cyan: "#58A6FF",
  white: "#F0F6FC",
  text: "#C9D1D9",
  muted: "#8B949E",
  green: "#2EA043",
};

const HEAT = ["#0D1B24", "#0E4429", "#006D32", "#26A641", "#39D353"];
const STATIC_LEVELS = "00000000000000000000000000000000000000000000000000000000000000000000000000000000100000002000000000004002303010032000000000000032000000000000011021031011000030003001110311101112020100011000000010000000010000000000000000032000000000020000332221312244430200002100133003434343041034200104444044444444444444441003013032002200013200000000003000300000000220001120000113100200000";

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&apos;",
})[char]);

const nf = (value) => new Intl.NumberFormat("pt-BR").format(value);

const dataFile = (name, mime) => {
  const bytes = readFileSync(resolve(ROOT, "assets", name));
  return "data:" + mime + ";base64," + bytes.toString("base64");
};

const dataSvg = (source) =>
  "data:image/svg+xml;base64," + Buffer.from(source, "utf8").toString("base64");

const skillSource = readFileSync(resolve(ROOT, "assets", "skills-source.svg"), "utf8");
const skillIcons = [...skillSource.matchAll(/<g transform="translate\([^"]+\)">\s*(<svg[\s\S]*?<\/svg>)\s*<\/g>/g)]
  .map((match) => dataSvg(match[1]));

if (skillIcons.length < 12) {
  throw new Error("Não foi possível extrair os 12 ícones de assets/skills-source.svg");
}

const image = {
  top: dataFile("hero-all-vibes.png", "image/png"),
  main: dataFile("hero-even-more-code.png", "image/png"),
  signature: dataFile("hero-signature.png", "image/png"),
  scene: dataFile("vibes-smoke.png", "image/png"),
};

function staticWeeks() {
  if (STATIC_LEVELS.length !== 53 * 7) {
    throw new Error("Snapshot do heatmap está incompleto");
  }
  const start = new Date("2025-09-14T12:00:00Z");
  return Array.from({ length: 53 }, (_, week) => ({
    days: Array.from({ length: 7 }, (_, day) => ({
      date: new Date(start.getTime() + (week * 7 + day) * 864e5).toISOString().slice(0, 10),
      count: Number(STATIC_LEVELS[week * 7 + day]),
      level: Number(STATIC_LEVELS[week * 7 + day]),
      weekday: day,
    })),
  }));
}

const SNAPSHOT = {
  contributions: 9753,
  commits: 253,
  activeDays: 118,
  repositories: 12,
  streak: 17,
  followers: 48,
  visitors: 9,
  weeks: staticWeeks(),
};

const QUERY = [
  "query($login: String!, $from: DateTime!) {",
  "  user(login: $login) {",
  "    followers { totalCount }",
  "    contributionsCollection(from: $from) {",
  "      totalCommitContributions",
  "      totalRepositoriesWithContributedCommits",
  "      contributionCalendar {",
  "        totalContributions",
  "        weeks { firstDay contributionDays { date contributionCount weekday } }",
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

async function fetchGraphql() {
  const from = new Date(Date.now() - 364 * 864e5).toISOString();
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: "bearer " + TOKEN,
      "Content-Type": "application/json",
      "User-Agent": "v4sp3r-profile-readme",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USER, from } }),
  });
  if (!response.ok) {
    throw new Error("GitHub GraphQL " + response.status + ": " + await response.text());
  }
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors));
  return payload.data.user;
}

async function fetchVisitorCount() {
  const url = "https://visitor-badge.laobi.icu/badge?page_id=" +
    encodeURIComponent(VISITOR_PAGE_ID) + "&query_only=true";
  const response = await fetch(url, {
    headers: { Accept: "image/svg+xml", "User-Agent": "v4sp3r-profile-readme" },
  });
  if (!response.ok) throw new Error("contador de visitas " + response.status);
  const svg = await response.text();
  const values = [...svg.matchAll(/<text\b[^>]*>([\d.,]+)<\/text>/g)];
  const raw = values.at(-1)?.[1]?.replace(/[^\d]/g, "");
  const count = Number(raw);
  if (!raw || !Number.isSafeInteger(count)) {
    throw new Error("resposta inválida do contador de visitas");
  }
  return count;
}

async function fetchPublicCalendar(login) {
  const response = await fetch("https://github.com/users/" + login + "/contributions", {
    headers: { Accept: "text/html", "User-Agent": "v4sp3r-profile-readme" },
  });
  if (!response.ok) throw new Error("calendário público " + response.status);
  const html = await response.text();
  const counts = new Map();

  for (const match of html.matchAll(/<tool-tip[^>]*\sfor="([^"]+)"[^>]*>\s*(No|[\d.,]+)\s+contribution/g)) {
    counts.set(match[1], match[2] === "No" ? 0 : Number(match[2].replace(/[.,]/g, "")));
  }

  const today = new Date().toISOString().slice(0, 10);
  const buckets = new Map();
  for (const match of html.matchAll(/<td\b[^>]*>/g)) {
    const tag = match[0];
    if (!tag.includes("ContributionCalendar-day")) continue;
    const date = (tag.match(/data-date="([^"]+)"/) || [])[1];
    const id = (tag.match(/\sid="([^"]+)"/) || [])[1];
    if (!date || !id || date > today) continue;
    const index = id.match(/-(\d+)-(\d+)$/);
    const week = index ? Number(index[2]) : 0;
    const weekday = index ? Number(index[1]) : new Date(date + "T12:00:00Z").getUTCDay();
    if (!buckets.has(week)) buckets.set(week, []);
    buckets.get(week).push({ date, count: counts.get(id) || 0, weekday });
  }

  const weeks = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => ({ days: entry[1].sort((a, b) => a.weekday - b.weekday) }));

  if (weeks.flatMap((week) => week.days).length < 300) {
    throw new Error("calendário público incompleto");
  }
  return weeks.slice(-53);
}

function graphWeeks(graphqlWeeks) {
  return graphqlWeeks.slice(-53).map((week) => ({
    days: week.contributionDays.map((day) => ({
      date: day.date,
      count: day.contributionCount,
      weekday: day.weekday,
    })),
  }));
}

function withLevels(weeks) {
  const positive = weeks.flatMap((week) => week.days.map((day) => day.count))
    .filter((count) => count > 0)
    .sort((a, b) => a - b);
  const quantile = (ratio) => positive.length
    ? positive[Math.min(positive.length - 1, Math.floor(positive.length * ratio))]
    : 1;
  const q1 = quantile(0.25);
  const q2 = quantile(0.5);
  const q3 = quantile(0.75);
  return weeks.map((week) => ({
    days: week.days.map((day) => ({
      ...day,
      level: day.count === 0 ? 0 : day.count > q3 ? 4 : day.count > q2 ? 3 : day.count > q1 ? 2 : 1,
    })),
  }));
}

function activity(weeks) {
  const days = weeks.flatMap((week) => week.days)
    .sort((a, b) => a.date.localeCompare(b.date));
  let best = 0;
  let run = 0;
  for (const day of days) {
    if (day.count > 0) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return {
    contributions: days.reduce((total, day) => total + day.count, 0),
    activeDays: days.filter((day) => day.count > 0).length,
    streak: best,
  };
}

async function loadModel() {
  if (!TOKEN || OFFLINE) {
    console.log("· usando snapshot local de 17/09/2026");
    return SNAPSHOT;
  }

  const visitorsPromise = fetchVisitorCount().catch((error) => {
    console.warn("! " + error.message + "; mantendo visitantes do snapshot");
    return SNAPSHOT.visitors;
  });

  try {
    const [user, visitors] = await Promise.all([fetchGraphql(), visitorsPromise]);
    let weeks = graphWeeks(user.contributionsCollection.contributionCalendar.weeks);
    try {
      weeks = await fetchPublicCalendar(USER);
    } catch (error) {
      console.warn("! " + error.message + "; usando calendário GraphQL");
    }
    weeks = withLevels(weeks);
    const stats = activity(weeks);
    return {
      contributions: stats.contributions,
      commits: user.contributionsCollection.totalCommitContributions,
      activeDays: stats.activeDays,
      repositories: user.contributionsCollection.totalRepositoriesWithContributedCommits,
      streak: stats.streak,
      followers: user.followers.totalCount,
      visitors,
      weeks,
    };
  } catch (error) {
    console.warn("! métricas online indisponíveis: " + error.message);
    console.warn("· mantendo snapshot local");
    return { ...SNAPSHOT, visitors: await visitorsPromise };
  }
}

function sectionHeading(number, title, note, y) {
  return [
    '<g aria-label="' + esc(number + " — " + title) + '">',
    '<rect x="42" y="' + (y - 24) + '" width="38" height="30" rx="6" fill="#182634" stroke="' + C.border + '"/>',
    '<text x="61" y="' + (y - 3) + '" text-anchor="middle" class="mono section-number">' + esc(number) + '</text>',
    '<line x1="94" y1="' + (y - 9) + '" x2="119" y2="' + (y - 9) + '" stroke="' + C.text + '" stroke-width="2"/>',
    '<text x="133" y="' + y + '" class="sans section-title">' + esc(title) + '</text>',
    '<text x="1058" y="' + (y - 2) + '" text-anchor="end" class="mono section-note">' + esc(note) + '</text>',
    '<line x1="42" y1="' + (y + 18) + '" x2="1058" y2="' + (y + 18) + '" stroke="' + C.line + '"/>',
    '</g>',
  ].join("");
}

function customApiIcon(x, y) {
  return [
    '<g transform="translate(' + x + " " + y + ')">',
    '<rect width="44" height="44" rx="12" fill="#151D28"/>',
    '<path d="M12 27c-4.5 0-6-6.4-1.7-8.2A9.2 9.2 0 0 1 28 16.4c5.4-.7 7.7 7.4 2.6 9.4" fill="none" stroke="#D7E2EC" stroke-width="2"/>',
    '<text x="22" y="28" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="700" fill="#D7E2EC">API</text>',
    '</g>',
  ].join("");
}

function customActionsIcon(x, y) {
  return [
    '<g transform="translate(' + x + " " + y + ')">',
    '<rect width="44" height="44" rx="12" fill="#0B2033"/>',
    '<path d="M13 13l9 8m0 0l9-8m-9 8v10" fill="none" stroke="#58A6FF" stroke-width="2"/>',
    '<circle cx="13" cy="13" r="4" fill="#071018" stroke="#58A6FF" stroke-width="2"/>',
    '<circle cx="31" cy="13" r="4" fill="#071018" stroke="#58A6FF" stroke-width="2"/>',
    '<circle cx="22" cy="31" r="4" fill="#071018" stroke="#58A6FF" stroke-width="2"/>',
    '</g>',
  ].join("");
}

const STACKS = [
  { label: ["Java"], icon: 0 },
  { label: ["Python"], icon: 1 },
  { label: ["JavaScript"], icon: 2 },
  { label: ["TypeScript"], icon: 3 },
  { label: ["HTML5"], icon: 4 },
  { label: ["CSS3"], icon: 5 },
  { label: ["Git"], icon: 6 },
  { label: ["GitHub"], icon: 7 },
  { label: ["VS Code"], icon: 8 },
  { label: ["Linux"], icon: 9 },
  { label: ["npm"], icon: 10 },
  { label: ["APIs", "REST"], custom: "api" },
  { label: ["GitHub", "Actions"], custom: "actions" },
  { label: ["AI /", "Illustrator"], icon: 11 },
];

function stackCards() {
  const y = 474;
  const cardWidth = 66;
  const gap = 7;
  return STACKS.map((stack, index) => {
    const x = 42 + index * (cardWidth + gap);
    const labelY = stack.label.length === 1 ? 568 : 561;
    const parts = [
      '<g data-stack-card="' + esc(stack.label.join(" ")) + '">',
      '<rect x="' + x + '" y="' + y + '" width="' + cardWidth + '" height="72" rx="10" fill="' + C.card + '" stroke="' + C.border + '"/>',
    ];
    if (typeof stack.icon === "number") {
      parts.push('<image href="' + skillIcons[stack.icon] + '" x="' + (x + 11) + '" y="' + (y + 11) + '" width="44" height="44"/>');
    } else if (stack.custom === "api") {
      parts.push(customApiIcon(x + 11, y + 11));
    } else {
      parts.push(customActionsIcon(x + 11, y + 11));
    }
    stack.label.forEach((line, lineIndex) => {
      parts.push('<text x="' + (x + cardWidth / 2) + '" y="' + (labelY + lineIndex * 13) + '" text-anchor="middle" class="sans stack-label">' + esc(line) + '</text>');
    });
    parts.push("</g>");
    return parts.join("");
  }).join("");
}

function metricIcon(index, x, y) {
  const common = 'fill="none" stroke="' + C.cyan + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const icons = [
    '<path d="M4 18v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M10 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 7a3 3 0 0 1 3 3v2" ' + common + '/>',
    '<path d="M5 7a8 8 0 1 1-1 8M5 7V2M5 7h5M12 5v6l4 2" ' + common + '/>',
    '<rect x="2" y="4" width="18" height="16" rx="3" ' + common + '/><path d="M6 1v6M16 1v6M2 9h18M7 13h3M13 13h3" ' + common + '/>',
    '<path d="M2 7h7l2 3h9v10H2zM2 7V4h7l2 3" ' + common + '/>',
    '<path d="M13 1L4 13h7l-1 8 9-13h-7z" ' + common + '/>',
    '<path d="M11 20S2 14.8 2 8.5A4.5 4.5 0 0 1 10 5.7L11 7l1-1.3a4.5 4.5 0 0 1 8 2.8C20 14.8 11 20 11 20z" ' + common + '/>',
    '<path d="M1 11s4-7 10-7 10 7 10 7-4 7-10 7S1 11 1 11zM11 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" ' + common + '/>',
  ];
  return '<g transform="translate(' + x + " " + y + ')">' + icons[index] + "</g>";
}

function metricCards(model) {
  const metrics = [
    { value: nf(model.contributions), label: "Contributions", sub: "last 12 months" },
    { value: nf(model.commits), label: "Commits", sub: "public API" },
    { value: nf(model.activeDays), label: "Active days", sub: "with activity" },
    { value: nf(model.repositories), label: "Repositories", sub: "active projects" },
    { value: nf(model.streak) + "d", label: "Record streak", sub: "personal best" },
    { value: nf(model.followers), label: "Followers", sub: "GitHub profile" },
    { value: nf(model.visitors), label: "Visitors", sub: "live profile views" },
  ];
  const y = 705;
  const gap = 10;
  const width = (1016 - gap * (metrics.length - 1)) / metrics.length;
  return metrics.map((metric, index) => {
    const x = 42 + index * (width + gap);
    return [
      '<g data-metric-card="' + esc(metric.label) + '">',
      '<rect x="' + x.toFixed(2) + '" y="' + y + '" width="' + width.toFixed(2) + '" height="130" rx="12" fill="' + C.card + '" stroke="' + C.border + '"/>',
      '<rect x="' + x.toFixed(2) + '" y="' + y + '" width="' + width.toFixed(2) + '" height="3" rx="2" fill="url(#blue-line)"/>',
      '<rect x="' + (x + 14).toFixed(2) + '" y="' + (y + 14) + '" width="30" height="30" rx="8" fill="' + C.blue + '" opacity=".12"/>',
      metricIcon(index, x + 18, y + 18),
      '<text x="' + (x + 16).toFixed(2) + '" y="' + (y + 76) + '" class="sans metric-value">' + esc(metric.value) + '</text>',
      '<text x="' + (x + 16).toFixed(2) + '" y="' + (y + 101) + '" class="sans metric-label">' + esc(metric.label) + '</text>',
      '<text x="' + (x + 16).toFixed(2) + '" y="' + (y + 120) + '" class="sans metric-sub">' + esc(metric.sub) + '</text>',
      '</g>',
    ].join("");
  }).join("");
}

function monthLabels(weeks, startX, step) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let previous = -1;
  const labels = [];
  weeks.forEach((week, index) => {
    const dated = week.days.find((day) => day.date);
    if (!dated) return;
    const month = new Date(dated.date + "T12:00:00Z").getUTCMonth();
    if (month !== previous && index < weeks.length - 1) {
      labels.push('<text x="' + (startX + index * step).toFixed(1) + '" y="949" class="mono month">' + names[month] + '</text>');
      previous = month;
    }
  });
  return labels.join("");
}

function heatmap(model) {
  const weeks = model.weeks.slice(-53);
  const cell = 13.2;
  const gap = 4.3;
  const step = cell + gap;
  const startX = 88;
  const startY = 962;
  const cells = [];

  weeks.forEach((week, weekIndex) => {
    const byDay = new Map(week.days.map((day) => [day.weekday, day]));
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = byDay.get(weekday);
      const level = day ? Math.max(0, Math.min(4, day.level || 0)) : 0;
      cells.push(
        '<rect x="' + (startX + weekIndex * step).toFixed(1) +
        '" y="' + (startY + weekday * step).toFixed(1) +
        '" width="' + cell + '" height="' + cell +
        '" rx="3" fill="' + HEAT[level] + '"/>'
      );
    }
  });

  const legend = HEAT.map((color, index) =>
    '<rect x="' + (930 + index * 18) + '" y="1090" width="13" height="13" rx="3" fill="' + color + '"/>'
  ).join("");

  return [
    '<g aria-label="Contribution graph">',
    '<rect x="42" y="862" width="1016" height="258" rx="14" fill="' + C.panel + '" stroke="' + C.border + '"/>',
    '<path d="M66 895h4v14h-4zM73 900h4v9h-4zM80 890h4v19h-4zM87 897h4v12h-4z" fill="' + C.cyan + '"/>',
    '<text x="103" y="906" class="sans graph-title">Contribution graph</text>',
    '<text x="1030" y="906" text-anchor="end" class="sans graph-side">Last 12 months</text>',
    '<line x1="66" y1="924" x2="1034" y2="924" stroke="' + C.line + '"/>',
    monthLabels(weeks, startX, step),
    cells.join(""),
    '<text x="66" y="1100" class="mono graph-foot">' + nf(model.activeDays) + ' active days · record streak ' + nf(model.streak) + 'd</text>',
    '<text x="912" y="1100" text-anchor="end" class="mono graph-foot">Less</text>',
    legend,
    '<text x="1034" y="1100" text-anchor="end" class="mono graph-foot">More</text>',
    '</g>',
  ].join("");
}

function buildSvg(model) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 1709" width="1100" height="1709" role="img" aria-labelledby="title description">',
    '<title id="title">Vasper — All vibes, even more code</title>',
    '<desc id="description">GitHub profile with full-stack tools, current public metrics, contribution history and an artwork with a smoky transition.</desc>',
    '<defs>',
    '<linearGradient id="background" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08121C"/><stop offset=".7" stop-color="#071018"/><stop offset="1" stop-color="#061019"/></linearGradient>',
    '<linearGradient id="blue-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + C.cyan + '"/><stop offset="1" stop-color="' + C.blue + '"/></linearGradient>',
    '<radialGradient id="hero-glow" cx=".5" cy=".15" r=".65"><stop offset="0" stop-color="#163A63" stop-opacity=".22"/><stop offset="1" stop-color="#071018" stop-opacity="0"/></radialGradient>',
    '<filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feOffset dy="4"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0.15 0 0 0 0 0.35 0 0 0 .65 0"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
    '<style>',
    '.sans{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}',
    '.section-number{fill:#F0F6FC;font-size:19px;font-weight:800}.section-title{fill:#F0F6FC;font-size:25px;font-weight:700}.section-note{fill:#79A7CF;font-size:13px;letter-spacing:1px}',
    '.stack-label{fill:#C9D1D9;font-size:10.5px}.metric-value{fill:#F0F6FC;font-size:29px;font-weight:800}.metric-label{fill:#D6DEE6;font-size:14px;font-weight:600}.metric-sub{fill:#6EA8DD;font-size:10.5px}',
    '.graph-title{fill:#E6EDF3;font-size:15px;font-weight:650}.graph-side{fill:#8EBCE4;font-size:13px}.month{fill:#8B949E;font-size:9px}.graph-foot{fill:#71879A;font-size:9.5px}',
    '</style>',
    '</defs>',
    '<rect width="1100" height="1709" fill="url(#background)"/>',
    '<rect width="1100" height="390" fill="url(#hero-glow)"/>',
    '<image href="' + image.scene + '" x="0" y="1090" width="1100" height="619" preserveAspectRatio="xMidYMid meet"/>',
    '<image href="' + image.top + '" x="329" y="36" width="442" height="132" preserveAspectRatio="xMidYMid meet" filter="url(#soft-shadow)"/>',
    '<image href="' + image.main + '" x="174" y="145" width="752" height="111" preserveAspectRatio="xMidYMid meet" filter="url(#soft-shadow)"/>',
    '<text x="550" y="292" text-anchor="middle" font-family="Georgia,serif" font-size="23" fill="' + C.text + '">Architecture systems - Full Stack, and little bit more...</text>',
    '<image href="' + image.signature + '" x="469" y="310" width="162" height="60" preserveAspectRatio="xMidYMid meet"/>',
    '<path d="M477 374C521 365 563 363 626 366" fill="none" stroke="' + C.blue + '" stroke-width="3" stroke-linecap="round"/>',
    sectionHeading("01", "stack", "// tools that power my ideas", 427),
    stackCards(),
    sectionHeading("02", "metrics", "// a little bit of history", 663),
    metricCards(model),
    heatmap(model),
    '</svg>',
  ].join("\n");
}

const model = await loadModel();
const svg = buildSvg(model);
writeFileSync(OUT, svg);
console.log("✔ assets/profile.svg gerado");
console.log("  " + nf(model.contributions) + " contribuições · " + nf(model.activeDays) + " dias ativos · " + nf(model.followers) + " seguidores · " + nf(model.visitors) + " visitantes");
