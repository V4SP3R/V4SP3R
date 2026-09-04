#!/usr/bin/env node
/**
 * Gera os cards SVG do perfil (KPIs, linguagens e heatmap de contribuições)
 * usando a GraphQL API do GitHub. Roda dentro do GitHub Actions com o
 * GITHUB_TOKEN do próprio repositório — sem serviços de terceiros,
 * sem rate limit compartilhado, sem card quebrado.
 *
 *   node scripts/build-cards.mjs            # dados reais
 *   MOCK=1 node scripts/build-cards.mjs     # dados fictícios (preview local)
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const USER   = process.env.GH_USER || 'V4SP3R';
const TOKEN  = process.env.GITHUB_TOKEN;
const OUT    = 'assets';
const README = process.env.README_FILE || 'README.md';

// O token do Actions nao enxerga contribuicoes privadas/de organizacoes, entao o
// calendario publico do perfil (mesmo numero que aparece em github.com/<user>)
// e lido diretamente e substitui o calendario vindo da GraphQL. Sem numero fixo.

/* ─────────────────────────── paleta ─────────────────────────── */
const C = {
  bg:     '#04070A',
  panel:  '#070D10',
  border: '#13372F',
  grid:   '#0FE39A',
  neon:   '#00FFA3',
  cyan:   '#2AC3FF',
  text:   '#A8BDB7',
  bright: '#E9F5F1',
  dim:    '#4E6A63',
};
const HEAT = ['#0B1417', '#12734F', '#16B37C', '#00E08D', '#00FFA3'];
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const nf = (n) => new Intl.NumberFormat('pt-BR').format(n);

/* ───────────────────────── coleta de dados ───────────────────── */
const QUERY = `
query($login: String!, $from: DateTime!) {
  user(login: $login) {
    name
    login
    followers { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false,
                 orderBy: {field: STARGAZERS, direction: DESC}) {
      totalCount
      nodes {
        name
        stargazerCount
        languages(first: 12, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection(from: $from) {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalRepositoriesWithContributedCommits
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { firstDay contributionDays { date contributionCount weekday } }
      }
    }
  }
}`;

async function fetchData() {
  const from = new Date(Date.now() - 364 * 864e5).toISOString();
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'v4sp3r-profile-cards',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USER, from } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  return json.data.user;
}

/* Calendario publico do perfil — inclui contribuicoes privadas/de organizacoes
   quando o usuario optou por exibi-las, que e o numero mostrado no perfil. */
async function fetchPublicCalendar(login) {
  const res = await fetch(`https://github.com/users/${login}/contributions`, {
    headers: { 'User-Agent': 'v4sp3r-profile-cards', Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`calendario publico ${res.status}`);
  const html = await res.text();

  const counts = new Map();
  for (const m of html.matchAll(/<tool-tip[^>]*\sfor="([^"]+)"[^>]*>\s*(No|[\d.,]+)\s+contribution/g)) {
    counts.set(m[1], m[2] === 'No' ? 0 : parseInt(m[2].replace(/[.,]/g, ''), 10));
  }

  const today = new Date().toISOString().slice(0, 10);
  const buckets = new Map();
  for (const m of html.matchAll(/<td\b[^>]*>/g)) {
    const tag = m[0];
    if (!tag.includes('ContributionCalendar-day')) continue;
    const date = (tag.match(/data-date="([^"]+)"/) || [])[1];
    const id = (tag.match(/\sid="([^"]+)"/) || [])[1];
    if (!date || date > today) continue;
    const ix = id && id.match(/-(\d+)-(\d+)$/);
    const week = ix ? Number(ix[2]) : 0;
    const weekday = ix ? Number(ix[1]) : new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!buckets.has(week)) buckets.set(week, []);
    buckets.get(week).push({ date, contributionCount: counts.get(id) ?? 0, weekday });
  }

  const weeks = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, days]) => ({ contributionDays: days.sort((a, b) => a.weekday - b.weekday) }));
  const all = weeks.flatMap((w) => w.contributionDays);
  if (all.length < 300) throw new Error(`calendario publico incompleto (${all.length} dias)`);
  return { weeks, totalContributions: all.reduce((a, d) => a + d.contributionCount, 0) };
}

function mockData() {
  const weeks = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const start = new Date(Date.now() - 364 * 864e5);
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 864e5);
      const burst = w > 44 ? 3 : w % 9 < 3 ? 1 : 0;
      const v = rnd() < 0.42 ? 0 : Math.floor(rnd() * (4 + burst * 4));
      days.push({ date: date.toISOString().slice(0, 10), contributionCount: v, weekday: d });
    }
    weeks.push({ contributionDays: days });
  }
  const total = weeks.flatMap((w) => w.contributionDays).reduce((a, b) => a + b.contributionCount, 0);
  const L = (name, color, size) => ({ size, node: { name, color } });
  return {
    name: 'Geovane Santos', login: USER,
    followers: { totalCount: 41 },
    repositories: {
      totalCount: 24,
      nodes: [
        { name: 'Colorfy', stargazerCount: 0, languages: { edges: [L('HTML', '#e34c26', 90000), L('CSS', '#563d7c', 30000), L('JavaScript', '#f1e05a', 25000)] } },
        { name: 'ZapAssina', stargazerCount: 1, languages: { edges: [L('HTML', '#e34c26', 60000), L('JavaScript', '#f1e05a', 20000)] } },
        { name: 'psc-lista-01', stargazerCount: 0, languages: { edges: [L('Java', '#b07219', 110000)] } },
        { name: 'pinterest-api', stargazerCount: 0, languages: { edges: [L('TypeScript', '#3178c6', 40000)] } },
        { name: 'algoritmos', stargazerCount: 0, languages: { edges: [L('Python', '#3572A5', 35000), L('CSS', '#563d7c', 12000)] } },
      ],
    },
    contributionsCollection: {
      totalCommitContributions: 289,
      totalPullRequestContributions: 6,
      totalIssueContributions: 3,
      totalRepositoriesWithContributedCommits: 25,
      restrictedContributionsCount: 24,
      contributionCalendar: { totalContributions: total, weeks },
    },
  };
}

/* ───────────────────────── cálculos ───────────────────────── */
function streaks(weeks) {
  const days = weeks.flatMap((w) => w.contributionDays)
    .filter((d) => new Date(d.date) <= new Date())
    .sort((a, b) => a.date.localeCompare(b.date));
  let best = 0, run = 0, cur = 0;
  for (const d of days) {
    if (d.contributionCount > 0) { run++; best = Math.max(best, run); } else run = 0;
  }
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) cur++;
    else if (i !== days.length - 1) break;
  }
  const active = days.filter((d) => d.contributionCount > 0).length;
  return { best, cur, active, totalDays: days.length };
}

function topLanguages(repos, limit = 8) {
  const map = new Map();
  for (const r of repos) {
    for (const e of r.languages?.edges ?? []) {
      const k = e.node.name;
      const p = map.get(k) ?? { name: k, color: e.node.color || C.neon, size: 0 };
      p.size += e.size;
      map.set(k, p);
    }
  }
  const all = [...map.values()].sort((a, b) => b.size - a.size);
  const total = all.reduce((a, b) => a + b.size, 0) || 1;
  const top = all.slice(0, limit);
  const rest = all.slice(limit).reduce((a, b) => a + b.size, 0);
  if (rest > 0) top.push({ name: 'Outras', color: '#38505A', size: rest });
  return top.map((l) => ({ ...l, pct: (l.size / total) * 100 }));
}

function periodStats(weeks) {
  const days = weeks.flatMap((w) => w.contributionDays)
    .filter((d) => new Date(`${d.date}T12:00:00Z`) <= new Date())
    .sort((a, b) => a.date.localeCompare(b.date));

  const byMonth = new Map();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + d.contributionCount);
  }
  const bestMonth = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];

  const last30 = days.slice(-30);
  const peak = days.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a), days[0]);

  return {
    total: days.reduce((a, d) => a + d.contributionCount, 0),
    byMonth,
    bestMonth: { key: bestMonth[0], total: bestMonth[1] },
    last30: {
      total: last30.reduce((a, d) => a + d.contributionCount, 0),
      active: last30.filter((d) => d.contributionCount > 0).length,
    },
    peak: { date: peak.date, count: peak.contributionCount },
  };
}

const MESES_EXT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesExtenso = (ym) => {
  const [y, m] = ym.split('-');
  return `${MESES_EXT[Number(m) - 1]} de ${y}`;
};
const plural = (n, sing, plur) => (n === 1 ? sing : plur);

/* Paragrafo "Leitura do painel": escrito a partir dos mesmos dados dos cards,
   entre os marcadores METRICS no README — nunca digitado a mao. */
const wrapQuote = (text, width = 96) => {
  const out = [];
  let line = '>';
  for (const w of text.split(/\s+/)) {
    if (line.length + w.length + 1 > width && line !== '>') { out.push(line); line = '>'; }
    line += ` ${w}`;
  }
  out.push(line);
  return out.join('\n');
};

function metricsBlock(u, s, p) {
  const cc = u.contributionsCollection;
  const repos = cc.totalRepositoriesWithContributedCommits;
  const leitura = [
    `**Leitura do painel** — são **${nf(p.total)} contribuições nos últimos 12 meses**,`,
    `distribuídas em **${nf(s.active)} ${plural(s.active, 'dia', 'dias')} com código**, com sequência`,
    `recorde de **${nf(s.best)} ${plural(s.best, 'dia', 'dias')}** e pico de **${nf(p.peak.count)} contribuições em um único dia**.`,
    `O mês mais forte foi **${mesExtenso(p.bestMonth.key)}**, com **${nf(p.bestMonth.total)} contribuições**;`,
    `nos últimos 30 dias foram **${nf(p.last30.total)} contribuições em ${nf(p.last30.active)} ${plural(p.last30.active, 'dia ativo', 'dias ativos')}**.`,
    `Desse volume, **${nf(cc.totalCommitContributions)} commits diretos** em`,
    `**${nf(repos)} ${plural(repos, 'repositório', 'repositórios')}** são os que a API pública detalha.`,
  ].join(' ');
  const carimbo = new Date().toLocaleDateString('pt-BR',
    { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  return `<!-- METRICS:START -->
<div align="center">

<img src="./assets/kpi.svg" width="100%" alt="Painel de métricas — últimos 12 meses" />

<br/>

<img src="./assets/contrib.svg" width="100%" alt="Gráfico de contribuições das últimas 53 semanas" />

</div>

${wrapQuote(leitura)}
>
> <sub>números lidos do calendário público de contribuições e regenerados a cada 6 horas — última atualização: ${carimbo}</sub>
<!-- METRICS:END -->`;
}

function updateReadme(block) {
  let md;
  try { md = readFileSync(README, 'utf8'); } catch { return false; }
  const re = /<!-- METRICS:START -->[\s\S]*?<!-- METRICS:END -->/;
  if (!re.test(md)) { console.warn('! marcadores METRICS nao encontrados em', README); return false; }
  const next = md.replace(re, block);
  if (next === md) return false;
  writeFileSync(README, next);
  return true;
}

/* ───────────────────────── blocos SVG ───────────────────────── */
const defs = `
  <defs>
    <linearGradient id="neon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.neon}"/><stop offset="100%" stop-color="${C.cyan}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
      <path d="M26 0H0V26" fill="none" stroke="${C.grid}" stroke-opacity=".06" stroke-width="1"/>
    </pattern>
  </defs>`;

const frame = (w, h, title) => `
  <rect width="${w}" height="${h}" rx="16" fill="${C.bg}"/>
  <rect width="${w}" height="${h}" rx="16" fill="url(#grid)"/>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="15" fill="none" stroke="${C.border}" stroke-width="2"/>
  <text x="26" y="34" font-family="${MONO}" font-size="13" fill="${C.dim}" letter-spacing="2.4">${esc(title)}</text>
  <line x1="26" y1="48" x2="${w - 26}" y2="48" stroke="${C.border}"/>`;

function cardKPI(u, s) {
  const cc = u.contributionsCollection;
  const W = 1000, H = 190;
  const items = [
    { v: nf(cc.contributionCalendar.totalContributions), l: 'CONTRIBUIÇÕES / ANO' },
    { v: nf(cc.totalCommitContributions), l: 'COMMITS' },
    { v: nf(s.active), l: 'DIAS ATIVOS' },
    { v: nf(cc.totalRepositoriesWithContributedCommits), l: 'REPOS ATIVOS' },
    { v: `${nf(s.best)}d`, l: 'SEQUÊNCIA RECORDE' },
    { v: nf(u.followers.totalCount), l: 'SEGUIDORES' },
  ];
  const gap = 14, pad = 26;
  const cw = (W - pad * 2 - gap * (items.length - 1)) / items.length;
  const tiles = items.map((it, i) => {
    const x = pad + i * (cw + gap);
    return `
    <g>
      <rect x="${x}" y="68" width="${cw}" height="${H - 68 - 28}" rx="12" fill="${C.panel}" stroke="${C.border}"/>
      <rect x="${x}" y="68" width="${cw}" height="3" rx="1.5" fill="url(#neon)" opacity=".9"/>
      <text x="${x + cw / 2}" y="122" text-anchor="middle" font-family="${MONO}" font-size="30"
            font-weight="700" fill="${C.bright}" filter="url(#glow)">${esc(it.v)}</text>
      <text x="${x + cw / 2}" y="146" text-anchor="middle" font-family="${MONO}" font-size="9.5"
            fill="${C.dim}" letter-spacing="1.2">${esc(it.l)}</text>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Métricas de ${esc(u.login)}">${defs}
  ${frame(W, H, '// PAINEL DE MÉTRICAS — ÚLTIMOS 12 MESES')}
  ${tiles}
</svg>`;
}

function cardLangs(langs, title) {
  title = title || '// DISTRIBUIÇÃO DE LINGUAGENS — POR VOLUME DE CÓDIGO';
  const cols = 4;
  const rows = Math.ceil(langs.length / cols);
  const W = 1000, pad = 26, barY = 74, barH = 22, barW = W - pad * 2;
  const H = barY + barH + 40 + rows * 34 + 6;
  let x = pad;
  const segs = langs.map((l, i) => {
    const w = Math.max(2, (l.pct / 100) * barW);
    const r = `<rect x="${x.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" fill="${l.color}">
       <animate attributeName="opacity" values="0;1" dur=".5s" begin="${(i * 0.09).toFixed(2)}s" fill="freeze"/>
     </rect>`;
    x += w;
    return r;
  }).join('');
  const rowH = 34;
  const legend = langs.map((l, i) => {
    const cx = pad + (i % cols) * ((barW) / cols);
    const cy = barY + barH + 40 + Math.floor(i / cols) * rowH;
    return `<g>
      <rect x="${cx}" y="${cy - 10}" width="11" height="11" rx="3" fill="${l.color}"/>
      <text x="${cx + 20}" y="${cy}" font-family="${MONO}" font-size="13" fill="${C.text}">${esc(l.name)}</text>
      <text x="${cx + (barW / cols) - 34}" y="${cy}" font-family="${MONO}" font-size="13"
            fill="${C.neon}" text-anchor="end">${l.pct.toFixed(1)}%</text>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Linguagens mais usadas">${defs}
  ${frame(W, H, title)}
  <clipPath id="barclip"><rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="11"/></clipPath>
  <g clip-path="url(#barclip)"><rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" fill="${C.panel}"/>${segs}</g>
  <rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="11" fill="none" stroke="${C.border}"/>
  ${legend}
</svg>`;
}

function cardHeatmap(u, s) {
  const weeks = u.contributionsCollection.contributionCalendar.weeks;
  const W = 1000, H = 252, pad = 26, top = 84;
  const gap = 3.4;
  const cell = +(((W - pad * 2 + gap) / weeks.length) - gap).toFixed(2);
  const gridW = weeks.length * (cell + gap) - gap;
  const startX = Math.round((W - gridW) / 2);
  const nz = weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount))
    .filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p) => (nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * p))] : 1);
  const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
  const level = (n) => (n === 0 ? 0 : n > q3 ? 4 : n > q2 ? 3 : n > q1 ? 2 : 1);

  // uma animação por coluna (semana) em vez de uma por célula: SVG ~4x menor
  let cells = '';
  weeks.forEach((wk, wi) => {
    const x = +(startX + wi * (cell + gap)).toFixed(1);
    const inner = wk.contributionDays.map((d) => {
      const lv = level(d.contributionCount);
      const y = +(top + d.weekday * (cell + gap)).toFixed(1);
      return `<rect y="${y}" width="${cell}" height="${cell}" rx="3" fill="${HEAT[lv]}"${lv === 4 ? ' filter="url(#glow)"' : ''}/>`;
    }).join('');
    cells += `<g transform="translate(${x},0)" opacity="1">` +
      `<animate attributeName="opacity" values="0;1" dur=".4s" begin="${(wi * 0.022).toFixed(3)}s" fill="freeze"/>` +
      inner + `</g>`;
  });

  const MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  let labels = '', last = -1;
  weeks.forEach((wk, wi) => {
    const m = new Date(wk.contributionDays[0].date).getMonth();
    if (m !== last && wi < weeks.length - 1) {
      labels += `<text x="${startX + wi * (cell + gap)}" y="${top - 10}" font-family="${MONO}" font-size="10" fill="${C.dim}">${MES[m]}</text>`;
      last = m;
    }
  });

  const legY = top + 7 * (cell + gap) + 28;
  const scale = HEAT.map((c, k) =>
    `<rect x="${W - pad - 122 + k * 17}" y="${legY - 10}" width="12" height="12" rx="3" fill="${c}"/>`).join('');

  const peak = Math.max(...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)), 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gráfico de contribuições">${defs}
  ${frame(W, H, '// GRÁFICO DE CONTRIBUIÇÕES — 53 SEMANAS')}
  ${labels}${cells}
  <text x="${pad}" y="${legY}" font-family="${MONO}" font-size="11" fill="${C.dim}">
    ${s.active} dias com código · sequência recorde: ${s.best}d · pico: ${peak} contribuições em um único dia
  </text>
  <text x="${W - pad - 140}" y="${legY}" font-family="${MONO}" font-size="10" fill="${C.dim}" text-anchor="end">menos</text>
  ${scale}
  <text x="${W - pad}" y="${legY}" font-family="${MONO}" font-size="10" fill="${C.dim}" text-anchor="end">mais</text>
</svg>`;
}

/* ───────────────────────────── main ───────────────────────────── */
const seedFile = process.env.SEED_FILE;
const user = seedFile
  ? JSON.parse(readFileSync(seedFile, 'utf8'))
  : process.env.MOCK ? mockData() : await fetchData();

// calendario publico manda no total/heatmap; GraphQL fica como plano B
if (!process.env.MOCK && !process.env.SKIP_PUBLIC_CALENDAR) {
  try {
    const pub = await fetchPublicCalendar(user.login || USER);
    user.contributionsCollection.contributionCalendar = pub;
  } catch (err) {
    console.warn(`! calendario publico indisponivel (${err.message}) — usando dados da GraphQL`);
  }
}

const cal = user.contributionsCollection.contributionCalendar;
const s = streaks(cal.weeks);
const p = periodStats(cal.weeks);
cal.totalContributions = p.total;
const langs = topLanguages(user.repositories.nodes);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/kpi.svg`, cardKPI(user, s));
writeFileSync(`${OUT}/langs.svg`, cardLangs(langs, process.env.LANGS_TITLE));
writeFileSync(`${OUT}/contrib.svg`, cardHeatmap(user, s));
const touched = updateReadme(metricsBlock(user, s, p));
console.log(`✔ cards gerados em ${OUT}/ — ${nf(p.total)} contribuições, ${s.active} dias ativos, ${langs.length} linguagens`);
console.log(touched ? `✔ ${README} atualizado (bloco METRICS)` : `· ${README} sem mudanças`);
