# Plano de Melhorias — kodus-graph + review (Kodus)

> Consolidado da sessão de análise (2026-07). Princípio-guia: **o motor de grafo virou commodity**
> (CodeGraph 61k★ MIT, omp, LSP nativo no Claude Code). **O fosso da Kodus é o veredito de review** —
> não o grafo. Toda melhoria é priorizada por: move a qualidade do *review*? é medível? é barata?

---

## Onda 0 — Bancar o que já está pronto (0 trabalho novo)

| Item | Estado | Ação |
|---|---|---|
| **kodus-graph 0.4.0** — fix de construtor (15 linguagens) + blast radius **bidirecional/hub-damping** | Feito, 1305 testes verdes, lint/typecheck limpos, **não commitado** | commit → publicar (`npm publish` com Automation token; user seta `npm config set …authToken` antes) |
| **kodus-ai** — gate de ablação `KODUS_ABLATE_CALLGRAPH` | Feito, não commitado | commit em branch |

**Gate:** CI verde nos dois repos.

---

## Onda 1 — A melhoria que importa (#1: entrega estruturada) — **PRIORIDADE**

**Onde:** kodus-ai (o review) + `context` command do kodus-graph.
**Por quê:** única já **provada** nesta sessão — **2,75× mais bug cross-file real, 0 alucinação**, sem perda de recall local. Não depende do motor (que é commodity).

**O que fazer (concreto):**
1. **Contexto rico diff-aware** no `context` do kodus-graph: funções mudadas + callers/callees (usando o **blast radius bidirecional+hub** da 0.4.0) + **hierarquia de classes** (edges INHERITS: base, irmãs). *Consertar o bug atual "0 changed" quando se passa `--graph` + `--diff`.*
2. **Prompt 2-pass** no reviewer do kodus-ai, atrás de flag:
   - PASS 1 — LOCAL: revisar o diff sozinho (bugs locais), **independente**, sem distração.
   - PASS 2 — IMPACTO: usar o contexto rico só pra pegar o cross-file (contrato de classe-irmã, caller que quebra, divergência com o resto do sistema).
3. **Colapsar impls redundantes em assinatura** no contexto (ver #5) pra não estourar token.

**Gate (medir CERTO):** NÃO usar o benchmark de F1 golden puro — ele mede **bugs locais**, e o valor do grafo é **cross-file** (daria falso "não ajudou"). Medir: **"achou bug cross-file real que o diff-sozinho não achou?"** em 15-20 PRs (com/sem contexto), judge classifica extra em *bug-real* vs *alucinação*. Barra: o with-context tem que **manter recall local E adicionar cross-file real**.

**Esforço:** médio.

---

## Onda 2 — Melhorias de motor (por valor, depois da Onda 1)

### #2 — Aresta heurística com proveniência (a que move recall)
**Onde:** kodus-graph resolver (`call-resolver.ts`).
**Hoje:** o que não resolve estaticamente é **dropado** → é o gap de recall dinâmico medido (closure-DI, dispatch dinâmico).
**Fazer:** em vez de dropar, **sintetizar a aresta por match de nome** (chamada DI → implementações daquele nome; emitter→listener pelo nome literal do evento) e **marcar** `provenance:'heuristic'` + confiança baixa (reusa os tiers). O blast radius já filtra por confiança → a aresta entra no recall **rotulada como palpite**, sem ferir precisão.
**Gate:** re-rodar o harness de blast-radius (LSP/compilador como verdade) — recall sobe nos casos dinâmicos, precisão dos tiers altos intacta.
**Esforço:** médio.

### #4 — Detecção de código gerado (quick win)
**Onde:** kodus-graph extractor / discovery.
**Fazer:** detectar arquivos gerados (protobuf `*.pb.*`, `*.generated.*`, migrations, lockfiles, headers de codegen) e **des-priorizar/excluir** do blast radius e dos alvos de review.
**Esforço:** baixo.

### #3 — Route → handler (NestJS primeiro)
**Onde:** kodus-graph extractor (pass novo, **mesmo walk manual do construtor**).
**Fazer:** `findAll({rule:{kind: decorator}})` → achar verbo (`@Get/@Post`), puxar URL do arg, subir via `.ancestors()` até o método (handler) + `@Controller` base path → emitir **nó `Route`** + aresta **`ROUTES`** → handler. Novos: `NodeKind:'Route'`, `EdgeKind:'ROUTES'`.
**Valor:** review passa a dizer "isso afeta o endpoint `GET /users/:id`" (impacto de superfície de API).
**Esforço:** médio (por framework; começar NestJS — cobre o kodus-ai).

### #5 — Colapsar impls em assinatura no output
**Onde:** kodus-graph output (`context`/formatter).
**Fazer:** quando N implementações são intercambiáveis, mostrar **1 assinatura** + "e N outras" em vez de todos os corpos. Dimensiona a resposta ao que foi perguntado.
**Valor:** enxuga token (vimos 2 hops estourarem contexto na ablação).
**Esforço:** baixo. (Vai junto com a Onda 1.)

---

## Disciplina — Fixar o eval no repo (contínuo)

A ablação desta sessão foi feita **à mão** e se perde. CodeGraph tem `agent-eval` **fixado no repo**.
**Fazer:** um harness de eval versionado (com/sem grafo, review-quality, judge estruturado) em kodus-ai — pra cada melhoria ser **medida, não achismo**. É o que valida a Onda 1 e a #2.

---

## Sequência recomendada

1. **Onda 0** (bancar 0.4.0) — agora.
2. **#5** (assinatura) + **contexto rico** — pré-requisito da Onda 1.
3. **Onda 1** (#1 entrega estruturada) + **eval fixo** → **medir**. ← *ponto de decisão: se não move o número, para de investir no grafo e mexe no consumo/modelo.*
4. Se Onda 1 verde: **#2** (recall) → **#4** (gerado) → **#3** (rotas).

## O que NÃO fazer (corrida perdida)
Kernel Rust, SQLite+FTS, pool de resolução, bridging cross-language (nicho mobile), daemon de auto-sync ao vivo (caso interativo/MCP, não é review por-PR), empatar contagem de linguagem por vaidade. **Não out-engineer o motor commodity.**
