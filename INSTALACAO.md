# Como publicar o perfil

Tempo estimado: **5 minutos**.

## 1. Criar (ou abrir) o repositório especial

O GitHub só exibe um README no perfil se ele estiver num repositório com **exatamente o mesmo nome do usuário**:

```
Nome do repositório : V4SP3R
Visibilidade        : Public          (obrigatório)
Initialize with     : Add a README file
```

> https://github.com/new — ao digitar `V4SP3R` no nome, o GitHub mostra a mensagem
> *"You found a secret! V4SP3R/V4SP3R is a special repository…"*. É esse.

## 2. Copiar os arquivos

Estrutura final do repositório:

```
V4SP3R/
├── README.md
├── assets/
│   ├── header.svg          ← banner animado (feito à mão, não sobrescrito)
│   ├── divider.svg         ← divisor neon animado
│   ├── kpi.svg             ← gerado automaticamente
│   ├── langs.svg           ← gerado automaticamente
│   └── contrib.svg         ← gerado automaticamente
├── scripts/
│   └── build-cards.mjs     ← gerador dos 3 cards acima
└── .github/workflows/
    └── profile.yml         ← roda de 6 em 6 horas
```

Pela linha de comando:

```bash
git clone https://github.com/V4SP3R/V4SP3R.git
cd V4SP3R
# copie aqui o conteúdo do pacote (README.md, assets/, scripts/, .github/)
git add .
git commit -m "feat: perfil customizado"
git push
```

Ou pelo navegador: **Add file → Upload files**, arraste tudo e faça commit.

## 3. Liberar a permissão de escrita do Actions

Sem isso o workflow não consegue commitar os cards atualizados.

```
Settings → Actions → General → Workflow permissions
  ☑ Read and write permissions
```

## 4. Rodar o workflow pela primeira vez

```
Actions → "Atualizar perfil" → Run workflow
```

Ele executa dois jobs:

| Job | O que faz | Onde escreve |
|:--|:--|:--|
| `cards` | Consulta a GraphQL API do GitHub e regenera os 3 SVGs de métricas | `assets/` na `main` |
| `snake` | Gera a animação da cobrinha percorrendo o gráfico de contribuições | branch `output` |

Depois disso ele roda sozinho a cada 6 horas. Os números do perfil **nunca ficam desatualizados**
e **não dependem de nenhum serviço de terceiros** — tudo é gerado com o token do próprio repositório.

---

## Personalizações rápidas

**Trocar a paleta** — abra `scripts/build-cards.mjs`, objeto `C` no topo:

```js
const C = { bg:'#04070A', neon:'#00FFA3', cyan:'#2AC3FF', ... };
const HEAT = ['#0B1417','#0E5C42','#12A874','#00E58F','#00FFA3'];
```

Os mesmos hexadecimais aparecem em `assets/header.svg` e `assets/divider.svg`.

**Mudar o subtítulo do banner** — em `assets/header.svg`, procure a linha
`full-stack dev · dashboards · automação · IA`. Se o texto ficar mais longo, aumente
o valor `530` nos dois `values="0;530;530"` / `values="252;776;776"` (é a máscara de digitação).

**Adicionar tecnologias** — no README, seção `02`, acrescente slugs em
`skillicons.dev/icons?i=java,python,js,...` (lista completa em https://skillicons.dev).

**Testar os cards localmente** (sem token, com dados fictícios):

```bash
MOCK=1 node scripts/build-cards.mjs
```

**Fixar os repositórios em destaque** — no perfil, "Customize your pins": sugestão de ordem
`Colorfy` · `ZapAssina` · `Assinatura-e-certificado` · `Estudo-interativo-…` · `pagina-de-cores` · `psc-lista-01-2025`.

## Complementos fora do README

Esses dois campos ficam no perfil, não no arquivo — vale preencher para fechar o conjunto:

- **Bio:** `Full-Stack Dev · dashboards, integrações e automação · Java · JS/TS · Python`
- **Status (emoji):** `⚡` com o texto `construindo dashboards`
