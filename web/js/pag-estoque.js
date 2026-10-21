/* =============================================================================
 * pag-estoque.js — as três telas de ESTOQUE E COMPRA:
 *   · Estoque x venda: a consulta mais rica do BI. Para cada produto, a venda das últimas 9
 *     semanas, a média aparada (descarta a melhor e a pior semana), as semanas de cobertura e a
 *     sugestão para 8 semanas. Produto sem venda suficiente fica sem média, sem cobertura e sem sugestão.
 *   · Sugestão de compra: 30 dias, a partir do giro cadastrado no WinThor contra o estoque disponível;
 *     cada produto é avaliado ao seu próprio preço de venda.
 *   · Excesso de estoque: produtos cuja sugestão para 60 dias é negativa (filiais 1, 2 e 8); o valor
 *     é o excedente ao preço de tabela — o capital imobilizado além do necessário.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "estoque_venda", grupo: "Estoque e compras", menu: "Estoque x venda", icone: "tendencia",
  titulo: "Venda, cobertura e sugestão", olho: "Página 03 · Estoque x venda",
  filtros: ["comprador", "fornecedor", "sugestao", "cobFaixa", "vendaS"], mais: ["comCob", "semana", "produto"],
  render: renderEstoqueVenda,
});
L.registrarPagina({
  id: "sugestao", grupo: "Estoque e compras", menu: "Sugestão de compra", icone: "carteira",
  titulo: "Quanto comprar", olho: "Página 04 · Sugestão fornecedor x produto",
  filtros: function () { return L.opt("sugestao", "visao", "fornecedor") === "produto" ? ["comprador", "fornecedor", "produto"] : ["comprador", "fornecedor"]; }, mais: [],
  render: renderSugestao,
});
L.registrarPagina({
  id: "excesso", grupo: "Estoque e compras", menu: "Excesso de estoque", icone: "armazem",
  titulo: "Capital parado em excesso", olho: "Página 05 · Excesso de estoque",
  filtros: ["comprador", "fornecedor", "semGiro"], mais: ["produto"],
  render: renderExcesso,
});

var SEM = [8, 7, 6, 5, 4, 3, 2, 1, 0];          // da semana mais antiga para a atual
function nomeSemana(i) { return i === 0 ? "atual" : "-" + i; }

/* ============================ ESTOQUE X VENDA ============================ */
function colunasEV() {
  var cols = [
    { id: "desc", titulo: "Descrição", tipo: "texto", valor: function (r) { return r.desc; } },
    { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (r) { return r.codprod; }, fmt: function (v) { return String(v); }, somar: false },
    { id: "comp", titulo: "Comprador", tipo: "texto", valor: function (r) { return L.nomeComprador(r.comp); } },
    { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (r) { return L.nomeFornec(r.forn); }, essencial: false },
    { id: "disp", titulo: "Est. disp.", tipo: "inteiro", valor: function (r) { return r.disp; } },
    { id: "vendaTot", titulo: "Venda 9 sem.", tipo: "inteiro", valor: function (r) { return r.vendaTot; } },
    { id: "media", titulo: "Média aparada", tipo: "num", valor: function (r) { return r.media; }, somar: false },
    { id: "cob", titulo: "Cobertura (sem.)", tipo: "num", valor: function (r) { return r.cob; }, somar: false, dica: "Estoque disponível dividido pela média aparada de venda semanal",
      classe: function (v) { return v == null ? "" : v < 2 ? "neg" : v > 8 ? "atn" : "pos"; } },
    { id: "sug", titulo: "Sugestão (un)", tipo: "inteiro", valor: function (r) { return r.sug; } },
    { id: "valorSug", titulo: "Valor sugerido", tipo: "moedaInt", valor: function (r) { return r.valorSug || null; }, exportarTipo: "moeda", barra: true, corBarra: "rgba(95,126,245,.2)" },
    { id: "pendente", titulo: "Pendente", tipo: "inteiro", valor: function (r) { return r.pendente || null; }, essencial: false },
  ];
  SEM.forEach(function (idx) {
    cols.push({ id: "sem" + idx, titulo: idx === 0 ? "Sem. atual" : "Sem. -" + idx, tipo: "inteiro", valor: function (r) { return r.semanas[idx]; }, essencial: false });
  });
  return cols;
}
function renderEstoqueVenda(raiz) {
  var lin = L.linhas("ev");
  var comCob = lin.filter(function (r) { return r.cob != null; }), comSug = lin.filter(function (r) { return r.sug > 0; });
  var semVenda = lin.filter(function (r) { return !(r.vendaTot > 0); });
  var valorSug = L.soma(comSug, "valorSug"), vendaTot = L.soma(lin, "vendaTot");
  var cobMedia = comCob.length ? L.soma(comCob, "cob") / comCob.length : null;
  var longa = comCob.filter(function (r) { return r.cob > 8; }).length;
  var ord = function (id, desc) { return [id, desc ? -1 : 1]; };
  var irCob = [function (f) { f.comCob = [1]; }, { ordem: ord("cob", false) }];
  var irSug = [function (f) { f.sugestao = [1]; }, { ordem: ord("valorSug", true) }];

  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "caixa", rot: "Produtos no filtro", valor: lin.length, fmt: L.fInt, classe: "heroi", leg: L.h("span", { text: "de " + L.fInt(L.C.ev.length) + " na carga completa" }), ir: [null] }),
    L.kpiIr({ icone: "tendencia", rot: "Venda 9 semanas", valor: vendaTot, fmt: L.fInt, leg: L.h("span", { text: "unidades · filiais 1, 7 e 10" }), ir: [null, { ordem: ord("vendaTot", true) }] }),
    L.kpiIr({ icone: "medidor", rot: "Com cobertura calculada", valor: comCob.length, fmt: L.fInt, leg: L.h("span", { text: L.fPct(L.pct(comCob.length, lin.length), 1) + " têm venda suficiente" }), ajuda: "A média aparada exige pelo menos 3 semanas com venda: descarta a melhor e a pior e divide pelo resto.", ir: irCob }),
    L.kpiIr({ icone: "medidor", rot: "Cobertura média", texto: cobMedia == null ? "—" : L.fNum(cobMedia, 1) + " sem", valor: cobMedia, fmt: function (v) { return L.fNum(v, 1) + " sem"; }, classe: cobMedia > 8 ? "atencao" : "ok", leg: L.h("span", { text: "a meta de compra do BI é 8 semanas" }), ir: irCob }),
    L.kpiIr({ icone: "carteira", rot: "Itens com sugestão", valor: comSug.length, fmt: L.fInt, classe: "ok", leg: L.h("span", { text: "estoque abaixo da necessidade de 8 semanas" }), ir: irSug }),
    L.kpiIr({ icone: "dinheiro", rot: "Valor sugerido", valor: valorSug, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: L.h("span", { text: "sugestão ao preço de venda" }), ir: irSug }),
    L.kpiIr({ icone: "alerta", rot: "Sem venda em 9 sem.", valor: semVenda.length, fmt: L.fInt, classe: semVenda.length ? "atencao" : "zero", leg: L.h("span", { text: "candidatos a revisão de mix" }), ir: [function (f) { f.vendaS = [0]; }, { ordem: ord("disp", true) }] }),
    L.kpiIr({ icone: "armazem", rot: "Cobertura > 8 sem.", valor: longa, fmt: L.fInt, classe: longa ? "atencao" : "zero", leg: L.h("span", { text: "estoque acima da meta de compra" }), ir: [function (f) { f.cobFaixa = [3, 4]; }, { ordem: ord("cob", true) }] })));
  if (!lin.length) { raiz.appendChild(L.estadoVazio("Nada com estes filtros", "Limpe algum filtro para ver os produtos.")); return; }

  var C = L.cores();
  // ---------------- venda por semana
  var somaSem = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  lin.forEach(function (r) { r.semanas.forEach(function (v, i) { somaSem[i] += v || 0; }); });
  var totalSem = somaSem.reduce(function (s, v) { return s + v; }, 0);
  var pSem = L.painel({ titulo: "Venda das últimas 9 semanas", sub: "unidades por semana, da mais antiga para a atual (em curso, costuma estar incompleta) · clique para ver quem vendeu", classe: "c-7" }), bSem = L.h("div");
  pSem.corpo.appendChild(bSem);
  L.graf.colunas(bSem, { categorias: SEM.map(function (i) { return { rot: nomeSemana(i) }; }), altura: 280, fmt: L.fInt,
    series: [{ nome: "Unidades", valores: SEM.map(function (i) { return somaSem[i]; }), cor: C.d[0] }],
    corBarra: function (c) { return SEM[c] === 0 ? C.d[7] : C.d[0]; },
    dica: function (c) {
      var i = SEM[c], v = somaSem[i], ant = i < 8 ? somaSem[i + 1] : null;
      var ex = '<div class="dica-sub">' + L.esc(L.fPct(L.pct(v, totalSem), 1) + " das 9 semanas" + (ant > 0 ? " · " + (v >= ant ? "▲ " : "▼ ") + L.fPct(Math.abs(v / ant - 1), 1) + " contra a semana anterior" : "")) + "</div>";
      return { titulo: i === 0 ? "Semana atual (em curso)" : "Há " + i + (i === 1 ? " semana" : " semanas"), linhas: [{ rot: "Unidades vendidas", val: L.fInt(v) + " un", cor: i === 0 ? C.d[7] : C.d[0] }], extra: ex, clique: "Clique para ver os produtos que venderam nesta semana" };
    },
    aoClicar: function (c) { var i = SEM[c]; L.irTabela(function (f) { f.semana = [i]; }, { ordem: ["sem" + i, -1] }); } });

  // ---------------- distribuição da cobertura
  var faixas = L.FAIXAS_COB.slice(0, 5).map(function (f) {
    return { id: f.id, rot: f.nome.replace(" semanas", "").replace(" ou mais", "+"), qtd: comCob.filter(function (r) { return r.cob >= f.min && r.cob < f.max; }).length };
  });
  var coresF = [C.perigo, C.atencao, C.ok, C.atencao, C.perigo];
  var pFx = L.painel({ titulo: "Distribuição da cobertura", sub: "produtos em cada faixa de semanas de estoque · meta de compra: 8 semanas · clique para ver", classe: "c-5" }), bFx = L.h("div");
  pFx.corpo.appendChild(bFx);
  L.graf.colunas(bFx, { categorias: faixas.map(function (f) { return { rot: f.rot }; }), altura: 280, fmt: L.fInt,
    series: [{ nome: "Produtos", valores: faixas.map(function (f) { return f.qtd; }), cor: C.d[0] }], corBarra: function (c) { return coresF[c]; },
    dica: function (c) { var f = faixas[c]; return { titulo: "Cobertura de " + L.FAIXAS_COB[f.id].nome, linhas: [{ rot: "Produtos", val: L.fInt(f.qtd), cor: coresF[c] }], extra: '<div class="dica-sub">' + L.esc(L.fPct(L.pct(f.qtd, comCob.length), 1) + " dos produtos com cobertura calculada") + "</div>" }; },
    aoClicar: function (c) { L.irTabela(function (f) { f.cobFaixa = [faixas[c].id]; }, { ordem: ord("cob", false) }); } });
  raiz.appendChild(L.grade(pSem, pFx));

  // ---------------- sugestão por comprador
  var pRk = L.painel({ titulo: "Maior valor sugerido por comprador", sub: "sugestão de compra para 8 semanas, ao preço de venda do produto · clique para abrir o relatório do comprador", classe: "c-12" });
  var gr = L.agrupar(comSug, "comprador", function (g, r) { g.v = (g.v || 0) + (r.valorSug || 0); }).sort(function (a, b) { return b.v - a.v; }).slice(0, 12);
  L.rankingDim(pRk.corpo, "comprador", gr.map(function (g) { return { k: g.k, valor: g.v, n: g.n }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: valorSug, rotulo: "Valor sugerido",
    dica: function (x) { return { titulo: L.nomeDe("comprador", x.k), linhas: [{ rot: "Valor sugerido", val: L.fR2(x.valor) }, { rot: "Itens com sugestão", val: L.fInt(x.n) }] }; } });
  raiz.appendChild(L.grade(pRk));

  // ---------------- planilha
  var t = L.tabela({
    titulo: "Detalhe por produto — estoque x venda", arquivo: "compras-estoque-venda", aba: "Estoque x venda", porPagina: 25, linhas: lin, colunas: colunasEV(),
    ordem: L.ordemTabela({ id: "valorSug", desc: true }),
    buscaDica: "Buscar produto por código, nome ou fornecedor…", buscaTexto: function (r) { return r.codprod + " " + r.desc + " " + L.nomeFornec(r.forn); },
    filtrosTexto: function () { return L.descricaoFiltros(); },
    totais: function (res) { var l = res.todas || res.linhas; return [{ rot: "Produtos", valor: L.fInt(l.length), pri: true }, { rot: "Venda 9 sem.", valor: L.fInt(L.soma(l, "vendaTot")) + " un" }, { rot: "Itens com sugestão", valor: L.fInt(l.filter(function (r) { return r.sug > 0; }).length) }, { rot: "Valor sugerido", valor: L.fR2(L.soma(l, function (r) { return r.sug > 0 ? r.valorSug : 0; })) }, { rot: "Disponível", valor: L.fInt(L.soma(l, "disp")) + " un" }]; },
    foto: function (r) { return r.codprod; }, fotoColuna: "desc",
    aoClicar: function (r, ev) { L.clique("produto", r.codprod, ev); }, vazio: "Nenhum produto com os filtros atuais.",
  });
  raiz.appendChild(L.painelTabela("Detalhe por produto", "ordenado por valor sugerido · clique na linha para abrir o relatório do produto · colunas de cada semana em “Todas”", t));
  raiz.appendChild(L.nota("Média aparada: descarta a melhor e a pior das 9 semanas. Cobertura em semanas de estoque; a meta de compra é 8 semanas. Produtos sem venda suficiente no período ficam sem média, sem cobertura e sem sugestão."));
}

/* ============================ SUGESTÃO ============================ */
function renderSugestao(raiz) {
  var visao = L.opt("sugestao", "visao", "fornecedor");
  var porF = L.linhas("sugf"), porP = L.linhas("sugp");
  var vF = L.soma(porF, "valor"), vP = L.soma(porP, "valor");
  var irVisao = function (v) { return [function (f, opt) { L.defOpt(opt, "sugestao", "visao", v); }, { ordem: ["valor", -1] }]; };

  raiz.appendChild(L.barraVisao("Visão", L.segOpt("sugestao", "visao", [["fornecedor", "Por fornecedor"], ["produto", "Por produto"]], "fornecedor")));
  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "carteira", rot: "Valor sugerido", valor: vF, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: L.h("span", { text: "cada produto ao seu próprio preço" }), ir: irVisao("fornecedor") }),
    L.kpiIr({ icone: "caixa", rot: "Fornecedores", valor: porF.length, fmt: L.fInt, leg: L.h("span", { text: "sugestão positiva em 30 dias · filiais 1, 2, 7 e 8" }), ir: irVisao("fornecedor") }),
    L.kpiIr({ icone: "etiqueta", rot: "Produtos (30 dias)", valor: porP.length, fmt: L.fInt, leg: L.h("span", { text: "filiais 1, 7 e 12" }), ir: irVisao("produto") }),
    L.kpiIr({ icone: "dinheiro", rot: "Valor por produto", valor: vP, fmt: L.fRc, fmtTitulo: L.fR2, classe: "violeta", leg: L.h("span", { text: "consulta própria, com filiais e critério próprios" }),
      ajuda: "“Valor sugerido” usa as filiais 1, 2, 7 e 8. “Valor por produto” usa 1, 7 e 12. São duas consultas diferentes, não o mesmo número quebrado em duas visões.", ir: irVisao("produto") })));

  var C = L.cores(), ehF = visao === "fornecedor", lin = ehF ? porF : porP;
  if (!lin.length) { raiz.appendChild(L.estadoVazio("Nada com estes filtros", "Limpe algum filtro para ver a sugestão.")); return; }

  var pRk = L.painel({ titulo: "Maiores sugestões", sub: (ehF ? "os 15 fornecedores com maior valor sugerido" : "os 15 produtos com maior valor sugerido") + " · clique para abrir o relatório", classe: "c-12" });
  var top = lin.slice().sort(function (a, b) { return b.valor - a.valor; }).slice(0, 15);
  if (ehF) L.rankingDim(pRk.corpo, "fornecedor", top.map(function (f) { return { k: f.cod, rot: L.titulo(f.nome), valor: f.valor, f: f }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: vF, rotulo: "Valor sugerido",
    dica: function (x) { var f = x.f; return { titulo: L.titulo(f.nome), linhas: [{ rot: "Valor sugerido", val: L.fR2(f.valor) }, { rot: "Sugestão", val: L.fInt(f.sug) + " un" }, { rot: "Giro", val: L.fNum(f.giro, 2) + "/dia" }, { rot: "Disponível", val: L.fInt(f.disp) + " un" }], extra: '<div class="dica-sub">' + L.esc(L.nomeComprador(f.comp)) + "</div>" }; } });
  else L.rankingDim(pRk.corpo, "produto", top.map(function (p) { return { k: p.codprod, rot: p.desc, valor: p.valor, p: p }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: vP, rotulo: "Valor", cor: function (i) { return i === 0 ? C.ouro : C.d[2]; },
    dica: function (x) { var p = x.p; return { titulo: p.desc, linhas: [{ rot: "Valor", val: L.fR2(p.valor) }, { rot: "Sugestão", val: L.fInt(p.sug) + " un" }, { rot: "Disponível", val: L.fInt(p.disp) + " un" }, { rot: "Filial", val: String(p.filial) }], extra: '<div class="dica-sub">' + L.esc(L.nomeFornec(p.forn)) + "</div>" }; } });
  raiz.appendChild(L.grade(pRk));

  var t;
  if (ehF) t = L.tabela({
    titulo: "Sugestão por fornecedor", arquivo: "compras-sugestao-fornecedor", aba: "Fornecedores", porPagina: 25, linhas: lin, ordem: L.ordemTabela({ id: "valor", desc: true }),
    buscaDica: "Buscar fornecedor por nome ou código…", buscaTexto: function (f) { return f.cod + " " + f.nome; }, filtrosTexto: function () { return L.descricaoFiltros([["Visão", "por fornecedor"]]); },
    colunas: [
      { id: "nome", titulo: "Fornecedor", tipo: "texto", valor: function (f) { return L.titulo(f.nome); } },
      { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (f) { return f.cod; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "comp", titulo: "Comprador", tipo: "texto", valor: function (f) { return L.nomeComprador(f.comp); } },
      { id: "giro", titulo: "Giro/dia", tipo: "num2", valor: function (f) { return f.giro; }, somar: false, exportarTipo: "moeda" },
      { id: "disp", titulo: "Disponível", tipo: "inteiro", valor: function (f) { return f.disp; } },
      { id: "sug", titulo: "Sugestão (un)", tipo: "inteiro", valor: function (f) { return f.sug; } },
      { id: "valor", titulo: "Valor sugerido", tipo: "moedaInt", valor: function (f) { return f.valor; }, exportarTipo: "moeda", barra: true, corBarra: "rgba(95,126,245,.2)" },
    ],
    totais: function (res) { var l = res.todas || res.linhas; return [{ rot: "Fornecedores", valor: L.fInt(l.length), pri: true }, { rot: "Sugestão", valor: L.fInt(L.soma(l, "sug")) + " un" }, { rot: "Valor sugerido", valor: L.fR2(L.soma(l, "valor")) }]; },
    aoClicar: function (f, ev) { L.clique("fornecedor", f.cod, ev); }, vazio: "Nenhum fornecedor com os filtros atuais.",
  });
  else t = L.tabela({
    titulo: "Sugestão por produto e filial", arquivo: "compras-sugestao-produto", aba: "Produtos", porPagina: 25, linhas: lin, ordem: L.ordemTabela({ id: "valor", desc: true }),
    buscaDica: "Buscar produto por código, nome ou fornecedor…", buscaTexto: function (p) { return p.codprod + " " + p.desc + " " + L.nomeFornec(p.forn); }, filtrosTexto: function () { return L.descricaoFiltros([["Visão", "por produto"]]); },
    colunas: [
      { id: "desc", titulo: "Descrição", tipo: "texto", valor: function (p) { return p.desc; } },
      { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (p) { return p.codprod; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "filial", titulo: "Filial", tipo: "inteiro", valor: function (p) { return p.filial; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "comp", titulo: "Comprador", tipo: "texto", valor: function (p) { return L.nomeComprador(p.comp); } },
      { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (p) { return L.nomeFornec(p.forn); }, essencial: false },
      { id: "volume", titulo: "Volume líq. 3m", tipo: "inteiro", valor: function (p) { return p.volume; }, essencial: false },
      { id: "giro", titulo: "Giro/dia", tipo: "num2", valor: function (p) { return p.giro; }, fmt: function (v) { return L.fNum(v, 3); }, somar: false, exportarTipo: "moeda", essencial: false },
      { id: "disp", titulo: "Disponível", tipo: "inteiro", valor: function (p) { return p.disp; } },
      { id: "sug", titulo: "Sugestão (un)", tipo: "inteiro", valor: function (p) { return p.sug; } },
      { id: "preco", titulo: "Preço", tipo: "moeda", valor: function (p) { return p.preco; }, somar: false },
      { id: "valor", titulo: "Valor", tipo: "moedaInt", valor: function (p) { return p.valor; }, exportarTipo: "moeda", barra: true, corBarra: "rgba(167,139,250,.2)" },
    ],
    totais: function (res) { var l = res.todas || res.linhas; return [{ rot: "Linhas", valor: L.fInt(l.length), pri: true }, { rot: "Volume 3 meses", valor: L.fInt(L.soma(l, "volume")) + " un" }, { rot: "Sugestão", valor: L.fInt(L.soma(l, "sug")) + " un" }, { rot: "Valor", valor: L.fR2(L.soma(l, "valor")) }]; },
    foto: function (p) { return p.codprod; }, fotoColuna: "desc",
    aoClicar: function (p, ev) { L.clique("produto", p.codprod, ev); }, vazio: "Nenhum produto com os filtros atuais.",
  });
  raiz.appendChild(L.painelTabela(ehF ? "Detalhe por fornecedor" : "Detalhe por produto", ehF ? "sugestão consolidada por fornecedor · estoque das filiais 1, 2, 7 e 8 · clique na linha para abrir o relatório" : "sugestão por produto e filial, baseada nos 3 meses fechados anteriores · clique na linha para abrir o relatório", t));
  raiz.appendChild(L.nota("Sugestão de compra para 30 dias, a partir do giro cadastrado no WinThor contra o estoque disponível. Cada produto é avaliado ao seu próprio preço de venda, e a sugestão do fornecedor soma o valor de cada item da sua carteira."));
}

/* ============================ EXCESSO ============================ */
function renderExcesso(raiz) {
  var lin = L.linhas("excesso");
  var total = L.soma(lin, "valor"), semGiro = lin.filter(function (e) { return !(e.giro > 0); });
  var ordenado = lin.slice().sort(function (a, b) { return b.valor - a.valor; });
  var top20 = ordenado.slice(0, Math.ceil(ordenado.length * 0.2)), conc = total ? L.soma(top20, "valor") / total : 0;
  var pior = ordenado[0], ord = function (id, desc) { return [id, desc ? -1 : 1]; };

  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "armazem", rot: "Capital parado", valor: total, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: L.h("span", { text: "excedente ao preço de tabela" }), ir: [null, { ordem: ord("valor", true) }] }),
    L.kpiIr({ icone: "caixa", rot: "Produtos em excesso", valor: lin.length, fmt: L.fInt, leg: L.h("span", { text: "sugestão negativa em 60 dias" }), ir: [null, { ordem: ord("valor", true) }] }),
    L.kpiIr({ icone: "dinheiro", rot: "Valor médio por item", valor: lin.length ? total / lin.length : 0, fmt: L.fR, leg: L.h("span", { text: "quanto cada item carrega, em média" }), ir: [null, { ordem: ord("valor", true) }] }),
    L.kpiIr({ icone: "pulso", rot: "Sem giro cadastrado", valor: semGiro.length, fmt: L.fInt, classe: semGiro.length ? "perigo" : "zero", leg: L.h("span", { text: "giro/dia zerado — o excesso é todo o estoque" }), ir: [function (f) { f.semGiro = [1]; }, { ordem: ord("valor", true) }] }),
    L.kpiIr({ icone: "percent", rot: "Concentração", valor: conc, fmt: function (v) { return L.fPct(v, 1); }, classe: "violeta", leg: L.h("span", { text: "do capital nos 20% de produtos mais pesados" }), ajuda: "Clique para abrir a planilha ordenada do mais pesado para o mais leve", ir: [null, { ordem: ord("valor", true) }] }),
    L.kpi({ icone: "alerta", rot: "Pior item", valor: pior ? pior.valor : null, fmt: L.fRc, fmtTitulo: L.fR2, classe: pior ? "atencao" : "zero", leg: L.h("span", { text: pior ? pior.desc : "—", title: pior ? pior.desc : "" }), aoClicar: pior ? function (ev) { L.clique("produto", pior.codprod, ev); } : null, ajuda: "Clique para abrir o relatório do produto" })));
  if (!lin.length) { raiz.appendChild(L.estadoVazio("Nada com estes filtros", "Limpe algum filtro para ver os produtos em excesso.")); return; }

  var C = L.cores();
  var pC = L.painel({ titulo: "Excesso por comprador", sub: "valor imobilizado além da necessidade de 60 dias · clique para abrir o relatório do comprador", classe: "c-6" });
  var gc = L.agrupar(lin, "comprador", function (g, e) { g.v = (g.v || 0) + e.valor; }).sort(function (a, b) { return b.v - a.v; });
  L.rankingDim(pC.corpo, "comprador", gc.map(function (g) { return { k: g.k, valor: g.v, n: g.n }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: total, rotulo: "Capital parado", cor: function (i) { return i === 0 ? C.atencao : C.d[0]; },
    dica: function (x) { return { titulo: L.nomeDe("comprador", x.k), linhas: [{ rot: "Capital parado", val: L.fR2(x.valor) }, { rot: "Produtos em excesso", val: L.fInt(x.n) }] }; } });
  var pT = L.painel({ titulo: "Os 12 produtos mais pesados", sub: "concentram a maior parte do capital parado · clique para abrir o relatório do produto", classe: "c-6" });
  L.rankingDim(pT.corpo, "produto", ordenado.slice(0, 12).map(function (e) { return { k: e.codprod, rot: e.desc, valor: e.valor, e: e }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: total, rotulo: "Capital parado", cor: function (i) { return i === 0 ? C.atencao : C.d[0]; },
    dica: function (x) { var e = x.e; return { titulo: e.desc, linhas: [{ rot: "Capital parado", val: L.fR2(e.valor) }, { rot: "Excedente", val: L.fInt(Math.abs(e.sug)) + " un" }, { rot: "Disponível", val: L.fInt(e.disp) + " un" }, { rot: "Preço", val: L.fR2(e.preco) }], extra: '<div class="dica-sub">' + L.esc(L.nomeFornec(e.forn)) + "</div>" }; } });
  raiz.appendChild(L.grade(pC, pT));

  var t = L.tabela({
    titulo: "Detalhe por produto — excesso de estoque", arquivo: "compras-excesso-estoque", aba: "Excesso", porPagina: 25, linhas: lin, rank: true, ordem: L.ordemTabela({ id: "valor", desc: true }),
    buscaDica: "Buscar produto por código, nome ou fornecedor…", buscaTexto: function (e) { return e.codprod + " " + e.desc + " " + L.nomeFornec(e.forn); }, filtrosTexto: function () { return L.descricaoFiltros(); },
    colunas: [
      { id: "desc", titulo: "Descrição", tipo: "texto", valor: function (e) { return e.desc; } },
      { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (e) { return e.codprod; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "comp", titulo: "Comprador", tipo: "texto", valor: function (e) { return L.nomeComprador(e.comp); } },
      { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (e) { return L.nomeFornec(e.forn); } },
      { id: "giro", titulo: "Giro/dia", tipo: "num2", valor: function (e) { return e.giro; }, fmt: function (v) { return L.fNum(v, 3); }, somar: false, exportarTipo: "moeda", essencial: false },
      { id: "disp", titulo: "Disponível", tipo: "inteiro", valor: function (e) { return e.disp; } },
      { id: "exc", titulo: "Excedente (un)", tipo: "inteiro", valor: function (e) { return Math.abs(e.sug); } },
      { id: "preco", titulo: "Preço", tipo: "moeda", valor: function (e) { return e.preco; }, somar: false, essencial: false },
      { id: "valor", titulo: "Capital parado", tipo: "moedaInt", valor: function (e) { return e.valor; }, exportarTipo: "moeda", barra: true, corBarra: "rgba(255,179,64,.2)", classe: "atn" },
    ],
    totais: function (res) { var l = res.todas || res.linhas; return [{ rot: "Produtos", valor: L.fInt(l.length), pri: true }, { rot: "Disponível", valor: L.fInt(L.soma(l, "disp")) + " un" }, { rot: "Excedente", valor: L.fInt(L.soma(l, function (e) { return Math.abs(e.sug); })) + " un" }, { rot: "Capital parado", valor: L.fR2(L.soma(l, "valor")) }]; },
    foto: function (e) { return e.codprod; }, fotoColuna: "desc",
    aoClicar: function (e, ev) { L.clique("produto", e.codprod, ev); }, vazio: "Nenhum produto com os filtros atuais.",
  });
  raiz.appendChild(L.painelTabela("Detalhe por produto", "base completa: " + L.fInt(L.C.excesso.length) + " produtos com excesso · clique na linha para abrir o relatório do produto", t));
  raiz.appendChild(L.nota("Produtos cuja sugestão de compra para 60 dias é negativa: o estoque das filiais 1, 2 e 8 já cobre mais do que o giro cadastrado consome. O valor é o excedente ao preço de tabela — quanto capital está imobilizado além do necessário."));
}

})();
