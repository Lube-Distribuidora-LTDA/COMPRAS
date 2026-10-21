/* =============================================================================
 * pag-faturamento.js — as duas telas de RESULTADO, sobre a mesma base de faturamento:
 *   · Performance compras: venda (sell-out) do ano corrente aberta por comprador, fornecedor,
 *     departamento e supervisor. Venda é quantidade × (preço − ST) nos pedidos de venda normal;
 *     a margem é o lucro sobre a venda e a divisão é protegida contra venda zero.
 *   · Métricas: a evolução mês a mês de venda, lucro e margem, e as quebras por departamento,
 *     estado e seção.
 * A base guarda só o ano corrente: na virada do ano ela recomeça, por isso não há comparação com
 * o ano anterior. As opções de período são montadas a partir do que existe na base.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "performance", grupo: "Resultado", menu: "Performance compras", icone: "barras",
  titulo: "Resultado por comprador e fornecedor", olho: "Página 06 · Performance compras",
  filtros: ["comprador", "fornecedor"], mais: [], render: renderPerformance,
});
L.registrarPagina({
  id: "metricas", grupo: "Resultado", menu: "Métricas", icone: "linha",
  titulo: "Evolução mensal e margem", olho: "Página 07 · Métricas",
  filtros: ["mes", "mesFechado"], mais: [], render: renderMetricas,
});

function periodoBase() {
  var m = L.C.fatMes;
  if (!m.length) return "sem dados";
  var ini = L.fMesAno(m[0].mes), fim = L.fMesAno(m[m.length - 1].mes);
  return ini === fim ? ini : ini + " – " + fim;
}
function corMargem(v) { return v == null ? "" : v < 0.15 ? "neg" : v > 0.25 ? "pos" : "atn"; }
var CORTES = {
  comprador:    { rot: "Comprador", tit: "Compradores", dim: "comprador" },
  fornecedor:   { rot: "Fornecedor", tit: "Fornecedores", dim: "fornecedor" },
  departamento: { rot: "Departamento", tit: "Departamentos", dim: "depto" },
  supervisor:   { rot: "Supervisor", tit: "Supervisores", dim: "superv" },
};

/* ============================ PERFORMANCE ============================ */
function renderPerformance(raiz) {
  var F = L.C, temJanela12 = F.fatMes.length > 12;
  var corte = L.opt("performance", "corte", "comprador"), per = temJanela12 ? L.opt("performance", "periodo", "12m") : "tudo";
  var use12 = per === "12m", cabecalho = L.h("div", { class: "barra-visao" }, L.h("span", { class: "fx-rot", text: "Ranking por" }),
    L.segOpt("performance", "corte", [["comprador", "Comprador"], ["fornecedor", "Fornecedor"], ["departamento", "Departamento"], ["supervisor", "Supervisor"]], "comprador"));
  if (temJanela12) { cabecalho.appendChild(L.h("span", { class: "fx-rot", style: { marginLeft: "18px" }, text: "Período" })); cabecalho.appendChild(L.segOpt("performance", "periodo", [["12m", "Últimos 12 meses"], ["tudo", "Base completa"]], "12m")); }
  raiz.appendChild(cabecalho);

  var vDe = function (x) { return use12 ? x.v12 : x.venda; }, lDe = function (x) { return use12 ? x.l12 : x.lucro; };
  var totalVenda = L.soma(L.linhas("fatComp"), vDe), totalLucro = L.soma(L.linhas("fatComp"), lDe);
  var pedidos = L.soma(L.linhas("fatComp"), "pedidos"), posit = L.soma(L.linhas("fatComp"), "posit");
  var melhor = L.linhas("fatComp").slice().sort(function (a, b) { return (use12 ? b.margem12 : b.margem) - (use12 ? a.margem12 : a.margem); })[0];
  var colV = use12 ? "v12" : "venda", colL = use12 ? "l12" : "lucro", colM = use12 ? "margem12" : "margem";
  var ir = function (col) { return [function (f, opt) { L.defOpt(opt, "performance", "corte", "comprador"); }, { ordem: [col, -1] }]; };

  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "dinheiro", rot: "Venda", valor: totalVenda, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: L.h("span", { text: (use12 ? "últimos 12 meses" : periodoBase()) + " · somente venda normal" }), ir: ir(colV) }),
    L.kpiIr({ icone: "barras", rot: "Lucro", valor: totalLucro, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: L.h("span", { text: "venda menos CMV" }), ir: ir(colL) }),
    L.kpiIr({ icone: "percent", rot: "Margem", valor: L.pct(totalLucro, totalVenda) || 0, fmt: function (v) { return L.fPct(v, 1); }, classe: "violeta", leg: L.h("span", { text: "lucro sobre a venda do período" }), ir: ir(colM) }),
    L.kpiIr({ icone: "caixa", rot: "Pedidos", valor: pedidos, fmt: L.fInt, leg: L.h("span", { text: "acumulado de " + periodoBase() }), ir: ir("pedidos") }),
    L.kpiIr({ icone: "pessoas", rot: "Positivação", valor: posit, fmt: L.fInt, leg: L.h("span", { text: "clientes distintos atendidos, somados por dia" }), ir: ir("posit") }),
    L.kpi({ icone: "estrela", rot: "Melhor margem", valor: melhor ? (use12 ? melhor.margem12 : melhor.margem) : null, fmt: function (v) { return L.fPct(v, 1); }, classe: "ok", leg: L.h("span", { text: melhor ? L.nomeDe("comprador", L.compAtivo(melhor.comp)) : "—" }),
      aoClicar: melhor ? function (ev) { L.clique("comprador", L.compAtivo(melhor.comp), ev); } : null, ajuda: "Clique para abrir o relatório do comprador" })));

  // ---------------- ranking do corte escolhido
  var C = CORTES[corte], itens = rankingItens(corte, use12);
  var corBarra = corte === "comprador" || corte === "fornecedor" ? L.cores().d[0] : L.cores().d[1];
  var pRk = L.painel({ titulo: "Venda por " + C.rot.toLowerCase(), sub: "ordenado pela venda do período · clique para abrir o relatório", classe: "c-7" });
  var tot = itens.reduce(function (s, x) { return s + x.valor; }, 0);
  L.rankingDim(pRk.corpo, C.dim, itens.slice(0, 20), { fmt: L.fRc, fmtCheio: L.fR2, total: totalVenda, cor: function (i) { return i === 0 ? L.cores().ouro : corBarra; }, rotulo: "Venda",
    dica: function (x) {
      var l = [{ rot: "Venda", val: L.fR2(x.valor) }];
      var ex = "";
      if (x.lucro != null) { l.push({ rot: "Lucro", val: L.fR2(x.lucro), cor: L.cores().ok }); ex = '<div class="dica-sub">Margem de ' + L.esc(L.fPct(L.pct(x.lucro, x.valor), 1)) + "</div>"; }
      return { titulo: x.rot, linhas: l, extra: ex };
    },
    aoClicar: function (x, ev) { L.clique(C.dim, x.k, ev); } });
  var pMg = L.painel({ titulo: "Margem por " + C.rot.toLowerCase(), sub: "lucro sobre a venda · só quem tem lucro do período · clique para abrir o relatório", classe: "c-5" });
  var comMargem = itens.filter(function (x) { return x.lucro != null && x.valor > 0; }).map(function (x) { return Object.assign({}, x, { m: x.lucro / x.valor }); }).sort(function (a, b) { return b.m - a.m; }).slice(0, 20);
  L.rankingDim(pMg.corpo, C.dim, comMargem.map(function (x) { return { k: x.k, rot: x.rot, valor: x.m, v: x }; }), { fmt: function (v) { return L.fPct(v, 1); }, pct: false, linhaH: 28,
    cor: function (i, x) { return x.valor < 0.15 ? L.cores().perigo : x.valor > 0.25 ? L.cores().ok : L.cores().atencao; },
    dica: function (x) { return { titulo: x.rot, linhas: [{ rot: "Margem", val: L.fPct(x.valor, 2) }, { rot: "Venda", val: L.fR2(x.v.valor) }, { rot: "Lucro", val: L.fR2(x.v.lucro) }] }; },
    vazio: "Este recorte não tem lucro por item no período." });
  raiz.appendChild(L.grade(pRk, pMg));

  // ---------------- planilha do corte
  var colsVenda = function () {
    var c = [];
    if (temJanela12) c.push({ id: "v12", titulo: "Venda 12m", tipo: "moedaInt", valor: function (x) { return x.v12; }, exportarTipo: "moeda" });
    return c;
  };
  var cols;
  if (corte === "comprador") {
    cols = [{ id: "nome", titulo: "Comprador", tipo: "texto", valor: function (x) { return L.nomeDe("comprador", L.compAtivo(x.comp)); } }];
    if (temJanela12) cols.push({ id: "v12", titulo: "Venda 12m", tipo: "moedaInt", valor: function (x) { return x.v12; }, exportarTipo: "moeda" }, { id: "l12", titulo: "Lucro 12m", tipo: "moedaInt", valor: function (x) { return x.l12; }, exportarTipo: "moeda" },
      { id: "margem12", titulo: "Margem 12m", tipo: "pct", valor: function (x) { return x.margem12; }, somar: false, classe: corMargem });
    cols.push({ id: "venda", titulo: temJanela12 ? "Venda total" : "Venda", tipo: "moedaInt", valor: function (x) { return x.venda; }, exportarTipo: "moeda", barra: true, corBarra: "rgba(95,126,245,.2)" },
      { id: "lucro", titulo: temJanela12 ? "Lucro total" : "Lucro", tipo: "moedaInt", valor: function (x) { return x.lucro; }, exportarTipo: "moeda" },
      { id: "margem", titulo: temJanela12 ? "Margem total" : "Margem", tipo: "pct", valor: function (x) { return x.margem; }, somar: false, classe: corMargem },
      { id: "pedidos", titulo: "Pedidos", tipo: "inteiro", valor: function (x) { return x.pedidos; } },
      { id: "posit", titulo: "Positivação", tipo: "inteiro", valor: function (x) { return x.posit; } });
  } else {
    cols = [{ id: "nome", titulo: C.rot, tipo: "texto", valor: function (x) { return x.nome; } }].concat(colsVenda());
    cols.push({ id: "venda", titulo: temJanela12 ? "Venda total" : "Venda", tipo: "moedaInt", valor: function (x) { return x.venda; }, exportarTipo: "moeda", barra: true, corBarra: "rgba(95,126,245,.2)" },
      { id: "lucro", titulo: temJanela12 ? "Lucro total" : "Lucro", tipo: "moedaInt", valor: function (x) { return x.lucro; }, exportarTipo: "moeda" },
      { id: "margem", titulo: temJanela12 ? "Margem total" : "Margem", tipo: "pct", valor: function (x) { return x.margem; }, somar: false, classe: corMargem });
  }
  var linhas = linhasCorte(corte);
  var t = L.tabela({
    titulo: C.tit, buscaInicial: L.buscaTabela(), arquivo: "compras-performance-" + corte, aba: C.tit, porPagina: 25, linhas: linhas, colunas: cols,
    ordem: L.ordemTabela({ id: temJanela12 ? (corte === "comprador" || corte === "fornecedor" ? "v12" : "venda") : "venda", desc: true }),
    buscaDica: "Buscar por nome…", buscaTexto: function (x) { return x.nome || L.nomeComprador(x.comp); },
    filtrosTexto: function () { return L.descricaoFiltros([["Ranking por", C.rot.toLowerCase()]]); },
    totais: function (res) {
      var l = res.todas || res.linhas, v = L.soma(l, "venda"), lu = L.soma(l, "lucro");
      var a = [{ rot: C.tit, valor: L.fInt(l.length), pri: true }, { rot: "Venda", valor: L.fR2(v) }, { rot: "Lucro", valor: L.fR2(lu) }, { rot: "Margem", valor: L.fPct(L.pct(lu, v), 1) }];
      if (corte === "comprador") a.push({ rot: "Pedidos", valor: L.fInt(L.soma(l, "pedidos")) }, { rot: "Positivação", valor: L.fInt(L.soma(l, "posit")) });
      return a;
    },
    aoClicar: function (x, ev) { L.clique(C.dim, x.k, ev); }, vazio: "Nada para mostrar.",
  });
  raiz.appendChild(L.painelTabela(C.tit, (temJanela12 ? "total do período completo e dos últimos 12 meses, lado a lado" : "acumulado de " + periodoBase()) + " · clique na linha para abrir o relatório", t));
  raiz.appendChild(L.nota("Venda (sell-out) do ano corrente, só pedidos de venda normal: quantidade × (preço − ST). Margem é o lucro sobre a venda; a divisão é protegida contra venda zero. A base guarda só o ano corrente — na virada ela recomeça e não há comparação com o ano anterior."));
}

function linhasCorte(corte) {
  var F = L.C;
  if (corte === "comprador") return L.linhas("fatComp").map(function (c) { return Object.assign({ k: L.compAtivo(c.comp) }, c); });
  var fonte = corte === "fornecedor" ? L.linhas("fatForn") : corte === "departamento" ? F.fatDepto : F.fatSup;
  return fonte.map(function (f) { return { k: f.cod, nome: corte === "fornecedor" ? L.nomeFornec(f.cod) : L.titulo(f.nome), venda: f.venda, lucro: f.lucro, v12: f.v12, margem: f.venda ? f.lucro / f.venda : null }; });
}
function rankingItens(corte, use12) {
  var F = L.C;
  var l = corte === "comprador" ? L.linhas("fatComp").map(function (c) { return { k: L.compAtivo(c.comp), rot: L.nomeDe("comprador", L.compAtivo(c.comp)), valor: use12 ? c.v12 : c.venda, lucro: use12 ? c.l12 : c.lucro }; })
    : corte === "fornecedor" ? L.linhas("fatForn").map(function (f) { return { k: f.cod, rot: L.nomeFornec(f.cod), valor: use12 ? f.v12 : f.venda, lucro: use12 ? null : f.lucro }; })
    : corte === "departamento" ? F.fatDepto.map(function (d) { return { k: d.cod, rot: L.titulo(d.nome), valor: use12 ? d.v12 : d.venda, lucro: use12 ? null : d.lucro }; })
    : F.fatSup.map(function (s) { return { k: s.cod, rot: L.titulo(s.nome), valor: use12 ? s.v12 : s.venda, lucro: use12 ? null : s.lucro }; });
  return l.filter(function (i) { return i.valor > 0; }).sort(function (a, b) { return b.valor - a.valor; });
}

/* ============================ MÉTRICAS ============================ */
function renderMetricas(raiz) {
  var F = L.C, serie = L.linhas("fatMes");
  var campo = L.opt("metricas", "metrica", "venda"), visao = L.opt("metricas", "visao", "meses");
  var hoje = new Date(), mesAtual = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0");
  raiz.appendChild(L.h("div", { class: "barra-visao" },
    L.h("span", { class: "fx-rot", text: "Colunas" }), L.segOpt("metricas", "metrica", [["venda", "Venda"], ["lucro", "Lucro"], ["pedidos", "Pedidos"]], "venda"),
    L.h("span", { class: "fx-rot", style: { marginLeft: "18px" }, text: "Planilha" }), L.segOpt("metricas", "visao", [["meses", "Mês a mês"], ["departamento", "Departamentos"], ["estado", "Estados"], ["secao", "Seções"]], "meses")));

  var venda = L.soma(serie, "venda"), lucro = L.soma(serie, "lucro");
  var melhor = serie.slice().sort(function (a, b) { return b.venda - a.venda; })[0];
  var fechados = serie.filter(function (m) { return m.mes < mesAtual; });
  var mediaMes = fechados.length ? L.soma(fechados, "venda") / fechados.length : 0;
  var ult = fechados[fechados.length - 1], ant = fechados[fechados.length - 2];
  var variacao = ult && ant && ant.venda ? ult.venda / ant.venda - 1 : null;
  var idMes = function (m) { return +m.replace("-", ""); };
  var irMes = [function (f, opt) { L.defOpt(opt, "metricas", "visao", "meses"); }, { ordem: ["mes", -1] }];

  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "dinheiro", rot: "Venda no período", valor: venda, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: L.h("span", { text: serie.length === 1 ? "1 mês considerado" : serie.length + " meses considerados" }), ir: irMes }),
    L.kpiIr({ icone: "barras", rot: "Lucro no período", valor: lucro, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: L.h("span", { text: "venda menos CMV" }), ir: [irMes[0], { ordem: ["lucro", -1] }] }),
    L.kpiIr({ icone: "percent", rot: "Margem do período", valor: L.pct(lucro, venda) || 0, fmt: function (v) { return L.fPct(v, 1); }, classe: "violeta", leg: L.h("span", { text: "lucro sobre venda" }), ir: [irMes[0], { ordem: ["margem", -1] }] }),
    L.kpiIr({ icone: "calendario", rot: "Média mensal", texto: fechados.length ? undefined : "—", valor: fechados.length ? mediaMes : null, fmt: L.fRc, fmtTitulo: L.fR2, leg: L.h("span", { text: fechados.length ? "só meses fechados — ignora o mês corrente" : "ainda não há mês fechado no período" }),
      ir: fechados.length ? [function (f, opt) { L.defOpt(opt, "metricas", "visao", "meses"); f.mesFechado = [1]; }, { ordem: ["mes", -1] }] : null }),
    L.kpi({ icone: "estrela", rot: "Melhor mês", valor: melhor ? melhor.venda : null, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: L.h("span", { text: melhor ? L.fMesLongo(melhor.mes) : "—" }), aoClicar: melhor ? function (ev) { L.clique("mes", idMes(melhor.mes), ev); } : null, ajuda: "Clique para abrir o relatório do mês" }),
    L.kpi({ icone: "tendencia", rot: "Último mês fechado", valor: ult ? ult.venda : null, fmt: L.fRc, fmtTitulo: L.fR2, classe: variacao == null ? "" : variacao >= 0 ? "ok" : "perigo",
      leg: variacao == null ? L.h("span", { text: "—" }) : L.h("span", { text: (ult ? L.fMesLongo(ult.mes) + " · " : "") + (variacao >= 0 ? "+" : "−") + L.fPct(Math.abs(variacao), 1) + " contra o mês anterior" }),
      aoClicar: ult ? function (ev) { L.clique("mes", idMes(ult.mes), ev); } : null, ajuda: "Clique para abrir o relatório do mês" })));
  if (!serie.length) { raiz.appendChild(L.estadoVazio("Nada com estes filtros", "Limpe o filtro de mês para ver a evolução.")); return; }

  var C = L.cores(), rotMetrica = campo === "venda" ? "Venda" : campo === "lucro" ? "Lucro" : "Pedidos";
  var fm = campo === "pedidos" ? L.fInt : L.fRc, tipo = campo === "pedidos" ? undefined : "moeda";
  var tot = L.soma(serie, campo);
  var pEv = L.painel({ titulo: "Evolução mensal · " + rotMetrica.toLowerCase(), sub: "valor de cada mês (o mês em curso, com *, ainda está incompleto) · clique na coluna para abrir o relatório do mês", classe: "c-12" }), bEv = L.h("div");
  pEv.corpo.appendChild(bEv);
  L.graf.colunas(bEv, { categorias: serie.map(function (m) { return { rot: L.fMesAno(m.mes) + (m.mes === mesAtual ? "*" : "") }; }), altura: 300, fmt: fm, tipo: tipo,
    series: [{ nome: rotMetrica, valores: serie.map(function (m) { return m[campo] || 0; }), cor: C.d[0] }], corBarra: function (c) { return serie[c].mes === mesAtual ? C.d[7] : C.d[0]; },
    dica: function (c) {
      var m = serie[c];
      return { titulo: L.fMesLongo(m.mes) + (m.mes === mesAtual ? " (em curso)" : ""), linhas: [{ rot: "Venda", val: L.fR2(m.venda), cor: C.d[0] }, { rot: "Lucro", val: L.fR2(m.lucro), cor: C.ok }, { rot: "Pedidos", val: L.fInt(m.pedidos) }, { rot: "Positivação", val: L.fInt(m.posit) }],
        extra: '<div class="dica-sub">' + L.esc("Margem de " + L.fPct(m.margem, 1) + (tot > 0 ? " · " + L.fPct((m[campo] || 0) / tot, 1) + " do total" : "")) + "</div>" };
    },
    aoClicar: function (c, s, ev) { L.clique("mes", idMes(serie[c].mes), ev); } });
  raiz.appendChild(L.grade(pEv));

  var pMg = L.painel({ titulo: "Margem do mês", sub: "lucro sobre a venda, em desenho próprio (nunca dois eixos no mesmo gráfico) · clique no ponto para abrir o relatório do mês", classe: "c-12" }), bMg = L.h("div");
  pMg.corpo.appendChild(bMg);
  L.graf.linhas(bMg, { categorias: serie.map(function (m) { return { rot: L.fMesAno(m.mes) }; }), altura: 230, fmt: function (v) { return L.fPct100(v, 1); }, tipo: "pct", zero: false,
    series: [{ nome: "Margem", valores: serie.map(function (m) { return m.margem == null ? null : m.margem * 100; }), cor: C.d[1], destaque: true, parcial: serie.length && serie[serie.length - 1].mes === mesAtual ? serie.length - 1 : null }],
    dica: function (c) { var m = serie[c]; return { titulo: L.fMesLongo(m.mes), linhas: [{ rot: "Margem", val: L.fPct(m.margem, 2), cor: C.d[1] }, { rot: "Lucro", val: L.fR2(m.lucro) }, { rot: "Venda", val: L.fR2(m.venda) }] }; },
    aoClicar: function (c, s, ev) { L.clique("mes", idMes(serie[c].mes), ev); } });
  raiz.appendChild(L.grade(pMg));

  // ---------------- quebras
  function rk(titulo, sub, dim, dados, cor, classe, topN) {
    var p = L.painel({ titulo: titulo, sub: sub, classe: classe || "c-6" });
    var tl = dados.reduce(function (s, x) { return s + x.venda; }, 0);
    L.rankingDim(p.corpo, dim, dados.slice(0, topN || 99).map(function (x) { return { k: x.k, rot: x.rot, valor: x.venda, lucro: x.lucro }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: tl, cor: function (i) { return i === 0 ? C.ouro : cor; }, rotulo: "Venda",
      dica: function (x) { return { titulo: x.rot, linhas: [{ rot: "Venda", val: L.fR2(x.valor) }, { rot: "Lucro", val: L.fR2(x.lucro), cor: C.ok }], extra: '<div class="dica-sub">Margem de ' + L.esc(L.fPct(L.pct(x.lucro, x.valor), 1)) + "</div>" }; },
      aoClicar: function (x, ev) { L.clique(dim, x.k, ev); } });
    return p;
  }
  var dep = F.fatDepto.slice().sort(function (a, b) { return b.venda - a.venda; }).map(function (d) { return { k: d.cod, rot: L.titulo(d.nome), venda: d.venda, lucro: d.lucro }; });
  var ufs = F.fatUf.map(function (u, i) { return { k: i, rot: u.uf, venda: u.venda, lucro: u.lucro }; }).sort(function (a, b) { return b.venda - a.venda; });
  var sec = F.fatSec.slice(0, 20).map(function (s) { return { k: s.cod, rot: L.titulo(s.nome), venda: s.venda, lucro: s.lucro }; });
  raiz.appendChild(L.grade(rk("Departamentos", "venda acumulada de " + periodoBase() + " · clique para abrir o relatório", "depto", dep, C.d[1]),
    rk("Estados", "onde a venda acontece · clique para abrir o relatório", "uf", ufs, C.d[0])));
  raiz.appendChild(L.grade(rk("Seções mais vendidas", "as 20 maiores seções de produto por venda acumulada · clique para abrir o relatório", "secao", sec, C.d[0], "c-12")));

  // ---------------- planilha
  var cm = function (id, tit, f) { return { id: id, titulo: tit, tipo: "moedaInt", valor: f, exportarTipo: "moeda" }; };
  var t;
  var corM = { id: "margem", titulo: "Margem", tipo: "pct", valor: function (m) { return m.margem; }, somar: false, classe: corMargem };
  if (visao === "meses") t = L.tabela({
    titulo: "Mês a mês", arquivo: "compras-metricas-mensal", aba: "Mês a mês", porPagina: 25, linhas: serie, busca: false, ordem: L.ordemTabela({ id: "mes", desc: true }),
    filtrosTexto: function () { return L.descricaoFiltros(); },
    colunas: [{ id: "mes", titulo: "Mês", tipo: "texto", valor: function (m) { return L.fMesLongo(m.mes); }, ordVal: function (m) { return m.mes; } }, cm("venda", "Venda", function (m) { return m.venda; }), cm("cmv", "CMV", function (m) { return m.cmv; }), cm("lucro", "Lucro", function (m) { return m.lucro; }), corM,
      { id: "pedidos", titulo: "Pedidos", tipo: "inteiro", valor: function (m) { return m.pedidos; } }, { id: "posit", titulo: "Positivação", tipo: "inteiro", valor: function (m) { return m.posit; } }],
    totais: function (res) { var l = res.todas || res.linhas, v = L.soma(l, "venda"), lu = L.soma(l, "lucro"); return [{ rot: "Meses", valor: L.fInt(l.length), pri: true }, { rot: "Venda", valor: L.fR2(v) }, { rot: "CMV", valor: L.fR2(L.soma(l, "cmv")) }, { rot: "Lucro", valor: L.fR2(lu) }, { rot: "Margem", valor: L.fPct(L.pct(lu, v), 1) }, { rot: "Pedidos", valor: L.fInt(L.soma(l, "pedidos")) }, { rot: "Positivação", valor: L.fInt(L.soma(l, "posit")) }]; },
    aoClicar: function (m, ev) { L.clique("mes", idMes(m.mes), ev); },
  });
  else {
    var dimV = visao === "departamento" ? { dim: "depto", fonte: dep, tit: "Departamentos" } : visao === "estado" ? { dim: "uf", fonte: ufs, tit: "Estados" } : { dim: "secao", fonte: F.fatSec.map(function (s) { return { k: s.cod, rot: L.titulo(s.nome), venda: s.venda, lucro: s.lucro }; }), tit: "Seções" };
    var linhasD = dimV.fonte.map(function (x) { return { k: x.k, nome: x.rot, venda: x.venda, lucro: x.lucro, margem: x.venda ? x.lucro / x.venda : null }; });
    t = L.tabela({
      titulo: dimV.tit, buscaInicial: L.buscaTabela(), arquivo: "compras-metricas-" + visao, aba: dimV.tit, porPagina: 25, linhas: linhasD, ordem: L.ordemTabela({ id: "venda", desc: true }),
      buscaDica: "Buscar por nome…", buscaTexto: function (x) { return x.nome; }, filtrosTexto: function () { return L.descricaoFiltros([["Planilha", dimV.tit.toLowerCase()]]); },
      colunas: [{ id: "nome", titulo: dimV.tit.replace(/s$/, ""), tipo: "texto", valor: function (x) { return x.nome; } }, { id: "venda", titulo: "Venda", tipo: "moedaInt", valor: function (x) { return x.venda; }, exportarTipo: "moeda", barra: true, corBarra: "rgba(95,126,245,.2)" }, cm("lucro", "Lucro", function (x) { return x.lucro; }), corM],
      totais: function (res) { var l = res.todas || res.linhas, v = L.soma(l, "venda"), lu = L.soma(l, "lucro"); return [{ rot: dimV.tit, valor: L.fInt(l.length), pri: true }, { rot: "Venda", valor: L.fR2(v) }, { rot: "Lucro", valor: L.fR2(lu) }, { rot: "Margem", valor: L.fPct(L.pct(lu, v), 1) }]; },
      aoClicar: function (x, ev) { L.clique(dimV.dim, x.k, ev); },
    });
  }
  var titulos = { meses: "Mês a mês", departamento: "Departamentos", estado: "Estados", secao: "Seções" };
  raiz.appendChild(L.painelTabela(titulos[visao], visao === "meses" ? (serie.length === 1 ? "1 mês do período" : serie.length + " meses do período") + ", do mais recente para o mais antigo · clique na linha para abrir o relatório" : "venda acumulada de " + periodoBase() + " · clique na linha para abrir o relatório", t));
  raiz.appendChild(L.nota("A mesma base de faturamento vista no tempo. O mês corrente costuma aparecer menor porque ainda está em curso. A base guarda só o ano corrente: ela recomeça na virada do ano, então não há comparação com o mesmo mês do ano passado."));
}

})();
