#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "README.md",
  "assets/profile.svg",
  "assets/vibes-smoke.png",
  "assets/skills-source.svg",
  "assets/hero-all-vibes.png",
  "assets/hero-even-more-code.png",
  "assets/hero-signature.png",
  "scripts/build-profile.mjs",
  ".github/workflows/profile.yml",
];

for (const file of required) {
  if (!existsSync(resolve(root, file))) {
    throw new Error("Arquivo obrigatório ausente: " + file);
  }
}

const readme = readFileSync(resolve(root, "README.md"), "utf8");
const svgPath = resolve(root, "assets/profile.svg");
const svg = readFileSync(svgPath, "utf8");

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

expect(/^<svg[\s>]/.test(svg), "profile.svg não começa com <svg>");
expect(/viewBox="0 0 1100 1709"/.test(svg), "viewBox inesperado");
expect(svg.trimEnd().endsWith("</svg>"), "profile.svg não termina com </svg>");
expect(svg.includes("Architecture systems - Full Stack, and little bit more..."), "subtítulo ausente");
expect(svg.includes("01 — stack"), "seção stack ausente");
expect(svg.includes("02 — metrics"), "seção metrics ausente");
expect((svg.match(/data-stack-card=/g) || []).length === 14, "o painel deve ter 14 stacks");
expect((svg.match(/data-metric-card=/g) || []).length === 7, "o painel deve ter 7 métricas");
expect(svg.includes('data-metric-card="Visitors"'), "card de visitantes ausente");
expect(!/<(?:script|foreignObject|animate|animateTransform)\b/i.test(svg), "SVG contém recurso proibido ou animação");
expect(!/(?:href|xlink:href)="https?:/i.test(svg), "SVG contém referência remota");
expect((svg.match(/data:image\//g) || []).length >= 16, "assets não foram incorporados ao SVG");
expect(statSync(svgPath).size < 10 * 1024 * 1024, "profile.svg excede 10 MB");
expect(readme.includes("./assets/profile.svg"), "README não referencia o painel");
expect(readme.includes("https://visitor-badge.laobi.icu/badge?page_id=V4SP3R.V4SP3R"), "contador de visitas incorreto");
expect(/width="0" height="0"/.test(readme), "contador real oculto deve permanecer sem ocupar espaço no README");
expect(!/page_id=trilokia/i.test(readme), "contador ainda aponta para Trilokia");

console.log("✔ README e profile.svg validados");
console.log("  stacks: 14 · métricas: 7 · contador real · sem animações · assets incorporados");
