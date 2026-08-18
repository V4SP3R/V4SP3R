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
import { writeFileSync, mkdirSync } from 'node:fs';

const USER  = process.env.GH_USER || 'V4SP3R';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT   = 'assets';

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
  ? JSON.parse((await import('node:fs')).readFileSync(seedFile, 'utf8'))
  : process.env.MOCK ? mockData() : await fetchData();
const s = streaks(user.contributionsCollection.contributionCalendar.weeks);
const langs = topLanguages(user.repositories.nodes);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/kpi.svg`, cardKPI(user, s));
writeFileSync(`${OUT}/langs.svg`, cardLangs(langs, process.env.LANGS_TITLE));
writeFileSync(`${OUT}/contrib.svg`, cardHeatmap(user, s));
console.log(`✔ cards gerados em ${OUT}/ — ${user.contributionsCollection.contributionCalendar.totalContributions} contribuições, ${langs.length} linguagens`);
