/* =============================================================================
 * pag-verba.js — as duas telas da VERBA com fornecedor principal:
 *   · Verba x avaria: a verba é o saldo de movimentação de crédito; a avaria é o valor do
 *     estoque indenizado; o saldo é a diferença (negativo = a avaria já consumiu a verba).
 *     A avaria aqui soma todas as filiais e fica restrita aos fornecedores principais com
 *     movimentação de verba — por isso é menor que a avaria por produto da tela Compras.
 *   · Saldo verba: entrada é crédito concedido, saída é crédito consumido; as colunas de
 *     vencidas e a vencer separam o crédito pelo prazo registrado.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "verba_avaria", grupo: "Verba", menu: "Verba x avaria", icone: "carteira",
  titulo: "Verba contra avaria", olho: "Página 02 · Saldo verba x avaria",
  filtros: ["comprador", "fornecedor", "saldoVA", "vencida"], mais: ["aVencer"],
  render: renderVerbaAvaria,
});
L.registrarPagina({
  id: "saldo_verba", grupo: "Verba", menu: "Saldo verba", icone: "dinheiro",
  titulo: "Crédito com os fornecedores", olho: "Página 08 · Saldo verba",
  filtros: ["comprador", "fornecedor", "comSaldo", "vencida"], mais: ["aVencer"],
  render: renderSaldoVerba,
});

function tabelaVerba(linhas, cfg) {
  var cor = function (v) { return v >= 0 ? "pos" : "neg"; };
  return L.tabela(Object.assign({
    titulo: "Fornecedores principais", arquivo: "compras-verba-fornecedores", aba: "Verba", porPagina: 25,
    linhas: linhas, buscaDica: "Buscar fornecedor por nome ou código…",
    buscaTexto: function (v) { return v.cod + " " + v.nome + " " + L.nomeFornec(v.cod); },
    colunas: cfg.colunas, ordem: cfg.ordem, totais: cfg.totais,
    aoClicar: function (v, ev) { L.clique("fornecedor", v.cod, ev); },
    vazio: "Nenhum fornecedor com os filtros atuais.",
  }, cfg.extra || {}));
}
var COL_COD = { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (v) { return v.cod; }, fmt: function (v) { return String(v); }, somar: false };
var COL_NOME = { id: "nome", titulo: "Fornecedor principal", tipo: "texto", valor: function (v) { return L.titulo(v.nome); } };
var COL_COMP = { id: "comp", titulo: "Comprador", tipo: "texto", valor: function (v) { return v.comp == null ? "—" : L.nomeComprador(v.comp); } };
function colMoeda(id, titulo, campo, extra) { return Object.assign({ id: id, titulo: titulo, tipo: "moeda", valor: function (v) { return v[campo]; } }, extra || {}); }

/* ============================ VERBA X AVARIA ============================ */
function renderVerbaAvaria(raiz) {
  var lin = L.linhas("verba");
  var verba = L.soma(lin, "verba"), avaria = L.soma(lin, "avaria"), venc = L.soma(lin, "vencidas"), avenc = L.soma(lin, "avencer");
  var neg = lin.filter(function (v) { return v.saldo < 0; });
  var ord = function (id, desc) { return [id, desc ? -1 : 1]; };

  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "carteira", rot: "Verba total", valor: verba, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: L.h("span", { text: "saldo de movimentação de crédito" }), ir: [null, { ordem: ord("verba", true) }] }),
    L.kpiIr({ icone: "devolucao", rot: "Avaria total", valor: avaria, fmt: L.fRc, fmtTitulo: L.fR2, classe: avaria ? "perigo" : "zero", leg: L.h("span", { text: "todas as filiais · só fornecedores com verba" }), ir: [null, { ordem: ord("avaria", true) }] }),
    L.kpiIr({ icone: "dinheiro", rot: "Saldo líquido", valor: verba - avaria, fmt: L.fRc, fmtTitulo: L.fR2, classe: verba - avaria >= 0 ? "ok" : "perigo", leg: L.h("span", { text: "verba menos avaria" }), ir: [null, { ordem: ord("saldo", false) }] }),
    L.kpiIr({ icone: "alerta", rot: "Fornecedores no vermelho", valor: neg.length, fmt: L.fInt, classe: neg.length ? "perigo" : "zero", leg: L.h("span", { text: "avaria maior que a verba · " + L.fPct(L.pct(neg.length, lin.length), 1) + " do total" }), ir: [function (f) { f.saldoVA = [1]; }, { ordem: ord("saldo", false) }] }),
    L.kpiIr({ icone: "relogio", rot: "Verba vencida", valor: venc, fmt: L.fRc, fmtTitulo: L.fR2, classe: venc ? "atencao" : "zero", leg: L.h("span", { text: "crédito com vencimento já passado" }), ir: [function (f) { f.vencida = [1]; }, { ordem: ord("vencidas", true) }] }),
    L.kpiIr({ icone: "calendario", rot: "Verba a vencer", valor: avenc, fmt: L.fRc, fmtTitulo: L.fR2, leg: L.h("span", { text: "ainda dentro do prazo" }), ir: [function (f) { f.aVencer = [1]; }, { ordem: ord("avencer", true) }] })));
  if (!lin.length) { raiz.appendChild(L.estadoVazio("Nada com estes filtros", "Limpe algum filtro para ver os fornecedores.")); return; }

  var C = L.cores();
  // ---------------- onde a avaria mais consome a verba
  var pNeg = L.painel({ titulo: "Onde a avaria mais consome a verba", sub: "os 15 fornecedores com o saldo mais negativo · clique para abrir o relatório do fornecedor", classe: "c-7" });
  var top = neg.slice().sort(function (a, b) { return a.saldo - b.saldo; }).slice(0, 15);
  if (!top.length) pNeg.corpo.appendChild(L.h("div", { class: "vazio", html: "<b>Nenhum fornecedor no vermelho</b>Nenhum fornecedor com saldo negativo nos filtros atuais." }));
  else L.rankingDim(pNeg.corpo, "fornecedor", top.map(function (v) { return { k: v.cod, rot: L.titulo(v.nome), valor: Math.abs(v.saldo), v: v }; }), {
    fmt: L.fRc, pct: false, cor: function () { return C.perigo; },
    dica: function (x) { var v = x.v; return { titulo: L.titulo(v.nome), linhas: [{ rot: "Verba", val: L.fR2(v.verba), cor: C.ok }, { rot: "Avaria", val: L.fR2(v.avaria), cor: C.perigo }, { rot: "Saldo", val: L.fR2(v.saldo) }, { rot: "Itens com avaria", val: L.fInt(v.itens) }], extra: '<div class="dica-sub">' + L.esc(L.nomeComprador(v.comp)) + "</div>" }; } });

  // ---------------- verba x avaria por comprador
  var porC = L.agrupar(lin, "comprador", function (g, v) { g.verba = (g.verba || 0) + (v.verba || 0); g.avaria = (g.avaria || 0) + (v.avaria || 0); }).sort(function (a, b) { return b.verba - a.verba; });
  var pC = L.painel({ titulo: "Verba e avaria por comprador", sub: "clique na coluna para abrir o relatório do comprador", classe: "c-5" }), bC = L.h("div");
  pC.corpo.appendChild(bC);
  L.graf.colunas(bC, { categorias: porC.map(function (g) { return L.nomeDe("comprador", g.k) === "—" ? "Sem comprador" : L.nomeCurto(g.k); }), altura: 280, fmt: L.fRc, tipo: "moeda",
    series: [{ nome: "Verba", valores: porC.map(function (g) { return g.verba; }), cor: C.ok }, { nome: "Avaria", valores: porC.map(function (g) { return g.avaria; }), cor: C.perigo }],
    dica: function (i) { var g = porC[i]; return { titulo: L.nomeDe("comprador", g.k), linhas: [{ rot: "Verba", val: L.fR2(g.verba), cor: C.ok }, { rot: "Avaria", val: L.fR2(g.avaria), cor: C.perigo }, { rot: "Saldo", val: L.fR2(g.verba - g.avaria) }] }; },
    aoClicar: function (i, s, ev) { L.clique("comprador", porC[i].k, ev); } });
  pC.corpo.appendChild(L.graf.legenda([{ rot: "Verba", cor: C.ok }, { rot: "Avaria", cor: C.perigo }]));
  raiz.appendChild(L.grade(pNeg, pC));

  // ---------------- planilha
  var t = tabelaVerba(lin, {
    ordem: L.ordemTabela({ id: "saldo", desc: false }),
    colunas: [COL_NOME, COL_COD, COL_COMP,
      colMoeda("verba", "Verba (saldo mov.)", "verba"), colMoeda("avaria", "Avaria", "avaria", { barra: true, corBarra: "rgba(255,107,116,.18)" }),
      colMoeda("saldo", "Saldo", "saldo", { classe: function (v) { return v < 0 ? "neg" : "pos"; } }),
      colMoeda("vencidas", "Vencidas", "vencidas", { essencial: false }), colMoeda("avencer", "A vencer", "avencer", { essencial: false }),
      { id: "itens", titulo: "Itens c/ avaria", tipo: "inteiro", valor: function (v) { return v.itens; }, essencial: false }],
    totais: function (res) { var l = res.todas || res.linhas; return [{ rot: "Fornecedores", valor: L.fInt(l.length), pri: true }, { rot: "Verba", valor: L.fR2(L.soma(l, "verba")) }, { rot: "Avaria", valor: L.fR2(L.soma(l, "avaria")) }, { rot: "Saldo", valor: L.fR2(L.soma(l, "saldo")) }, { rot: "Vencidas", valor: L.fR2(L.soma(l, "vencidas")) }, { rot: "A vencer", valor: L.fR2(L.soma(l, "avencer")) }]; },
    extra: { filtrosTexto: function () { return L.descricaoFiltros(); } },
  });
  raiz.appendChild(L.painelTabela("Fornecedores principais", "base completa: " + L.fInt(L.C.verba.length) + " fornecedores principais · clique na linha para abrir o relatório do fornecedor", t));
  raiz.appendChild(L.nota("A verba é o saldo de movimentação de crédito (consulta oficial de saldo de verba). A avaria soma todas as filiais e fica restrita aos fornecedores principais com movimentação de verba — por isso é menor que a avaria por produto da tela Compras, que não tem essa restrição."));
}

/* ============================ SALDO VERBA ============================ */
function renderSaldoVerba(raiz) {
  var lin = L.linhas("verba");
  var saldo = L.soma(lin, "verba"), entrada = L.soma(lin, "entrada"), saida = L.soma(lin, function (v) { return Math.abs(v.saida || 0); });
  var venc = L.soma(lin, "vencidas"), avenc = L.soma(lin, "avencer");
  var comSaldo = lin.filter(function (v) { return (v.verba || 0) > 0; });
  var ord = function (id, desc) { return [id, desc ? -1 : 1]; };
  var irVenc = [function (f) { f.vencida = [1]; }, { ordem: ord("vencidas", true) }], irAv = [function (f) { f.aVencer = [1]; }, { ordem: ord("avencer", true) }];

  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "dinheiro", rot: "Saldo de verba", valor: saldo, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: L.h("span", { text: "entrada menos saída de crédito" }), ir: [null, { ordem: ord("verba", true) }] }),
    L.kpiIr({ icone: "carteira", rot: "Crédito concedido", valor: entrada, fmt: L.fRc, fmtTitulo: L.fR2, leg: L.h("span", { text: "total lançado a favor da empresa" }), ir: [null, { ordem: ord("entrada", true) }] }),
    L.kpiIr({ icone: "devolucao", rot: "Crédito consumido", valor: saida, fmt: L.fRc, fmtTitulo: L.fR2, leg: L.h("span", { text: "já utilizado em abatimentos" }), ir: [null, { ordem: ord("saida", false) }] }),
    L.kpiIr({ icone: "verificar", rot: "Fornecedores com saldo", valor: comSaldo.length, fmt: L.fInt, classe: "ok", leg: L.h("span", { text: "de " + L.fInt(lin.length) + " no filtro atual" }), ir: [function (f) { f.comSaldo = [1]; }, { ordem: ord("verba", true) }] }),
    L.kpiIr({ icone: "relogio", rot: "Vencidas", valor: venc, fmt: L.fRc, fmtTitulo: L.fR2, classe: venc ? "atencao" : "zero", leg: L.h("span", { text: "verba com vencimento já passado" }), ir: irVenc }),
    L.kpiIr({ icone: "calendario", rot: "A vencer", valor: avenc, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: L.h("span", { text: "ainda dentro do prazo" }), ir: irAv })));
  if (!lin.length) { raiz.appendChild(L.estadoVazio("Nada com estes filtros", "Limpe algum filtro para ver os fornecedores.")); return; }

  var C = L.cores();
  var pR = L.painel({ titulo: "Maiores saldos", sub: "os 15 fornecedores com mais crédito disponível · clique para abrir o relatório do fornecedor", classe: "c-7" });
  var top = lin.slice().sort(function (a, b) { return b.verba - a.verba; }).slice(0, 15);
  L.rankingDim(pR.corpo, "fornecedor", top.map(function (v) { return { k: v.cod, rot: L.titulo(v.nome), valor: Math.max(0, v.verba), v: v }; }), {
    fmt: L.fRc, pct: false, total: saldo,
    dica: function (x) { var v = x.v; return { titulo: L.titulo(v.nome), linhas: [{ rot: "Entrada", val: L.fR2(v.entrada), cor: C.d[0] }, { rot: "Saída", val: L.fR2(Math.abs(v.saida || 0)), cor: C.d[7] }, { rot: "Saldo", val: L.fR2(v.verba) }, { rot: "Vencidas", val: L.fR2(v.vencidas), cor: C.atencao }, { rot: "A vencer", val: L.fR2(v.avencer), cor: C.ok }], extra: '<div class="dica-sub">' + L.esc(v.comp == null ? "—" : L.nomeComprador(v.comp)) + "</div>" }; } });

  var pP = L.painel({ titulo: "Crédito por prazo", sub: "quanto do saldo já venceu e quanto ainda está no prazo · clique para ver os fornecedores", classe: "c-5" }), bP = L.h("div");
  pP.corpo.appendChild(bP);
  var fat = [{ rot: "Vencidas", valor: Math.max(0, venc), cor: C.atencao, corTexto: "#0b1533", idxOriginal: 0 }, { rot: "A vencer", valor: Math.max(0, avenc), cor: C.ok, corTexto: "#0b1533", idxOriginal: 1 }];
  var irP = function (i) { L.irTabela.apply(L, i === 0 ? irVenc : irAv); };
  if (venc + avenc > 0) {
    L.graf.rosca(bP, { fatias: fat, altura: 240, fmt: L.fRc, centro: { valor: L.fPct(L.pct(venc, venc + avenc), 0), titulo: "já venceu" },
      dica: function (i, s, f, tot) { return { titulo: fat[i].rot, linhas: [{ rot: "Valor", val: L.fR2(fat[i].valor) }, { rot: "Do crédito com prazo", val: L.fPct(fat[i].valor / tot, 1) }] }; },
      aoClicar: function (i) { irP(i); } });
    pP.corpo.appendChild(L.graf.legendaLista(fat, L.fRc, function (i) { irP(i); }));
  } else bP.appendChild(L.h("div", { class: "vazio", html: "<b>Sem prazo registrado</b>Nenhum crédito com prazo registrado nos filtros atuais." }));
  raiz.appendChild(L.grade(pR, pP));

  var t = tabelaVerba(lin, {
    ordem: L.ordemTabela({ id: "verba", desc: true }),
    colunas: [COL_NOME, COL_COD, COL_COMP,
      colMoeda("entrada", "Entrada", "entrada"),
      { id: "saida", titulo: "Saída", tipo: "moeda", valor: function (v) { return v.saida; }, classe: "mudo" },
      colMoeda("verba", "Saldo mov.", "verba", { classe: function (v) { return v < 0 ? "neg" : "pos"; }, barra: true, corBarra: "rgba(52,232,158,.16)" }),
      colMoeda("vencidas", "Vencidas", "vencidas"), colMoeda("avencer", "A vencer", "avencer")],
    totais: function (res) { var l = res.todas || res.linhas; return [{ rot: "Fornecedores", valor: L.fInt(l.length), pri: true }, { rot: "Entrada", valor: L.fR2(L.soma(l, "entrada")) }, { rot: "Saída", valor: L.fR2(L.soma(l, function (v) { return Math.abs(v.saida || 0); })) }, { rot: "Saldo", valor: L.fR2(L.soma(l, "verba")) }, { rot: "Vencidas", valor: L.fR2(L.soma(l, "vencidas")) }, { rot: "A vencer", valor: L.fR2(L.soma(l, "avencer")) }]; },
    extra: { titulo: "Todos os fornecedores", arquivo: "compras-saldo-verba", filtrosTexto: function () { return L.descricaoFiltros(); } },
  });
  raiz.appendChild(L.painelTabela("Todos os fornecedores", "base completa: " + L.fInt(L.C.verba.length) + " fornecedores principais · clique na linha para abrir o relatório do fornecedor", t));
  raiz.appendChild(L.nota("Entrada é crédito concedido; saída é crédito consumido; o saldo de movimentação é a diferença — é esse valor que alimenta o cartão de verba da tela Compras. Vencidas e a vencer separam o crédito pelo prazo registrado na verba."));
}

})();
