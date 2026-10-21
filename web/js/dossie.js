/* =============================================================================
 * dossie.js — o RELATÓRIO que abre a cada clique numa pessoa ou coisa do painel.
 *
 * Qualquer barra, ponto, chip ou linha de comprador, fornecedor, produto, mês, departamento,
 * seção, estado ou supervisor abre aqui o relatório daquele recorte. Dentro dele, clicar abre o
 * relatório do item clicado (com "Voltar"). Os filtros da tela não entram: o relatório mostra
 * o item inteiro, em todas as consultas do BI Compras (ruptura, estoque, sugestão, excesso, verba, venda).
 *   comprador   : Resumo · Produtos · Fornecedores · Verba
 *   fornecedor  : Resumo · Produtos · Verba
 *   produto     : Resumo (a ficha do produto, consulta a consulta)
 *   demais      : Resumo
 * ent = { dim, id }
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var pilha = [], aba = "resumo";

function escopo(ent) {
  var f = {};
  if (ent.dim && L.DIM[ent.dim]) f[ent.dim] = [+ent.id];
  return { f: f };
}
function nomeEnt(ent) { return ent.titulo || (ent.dim ? L.nomeDe(ent.dim, ent.id) : "Seleção"); }
/* todo cartão do relatório leva ao dado: fecha o relatório e abre a tela de origem já filtrada por este item
   (com "Voltar" na faixa de filtros). mudar(filtros, opt) acrescenta o que o cartão pede. */
function irPara(pagina, dim, id, mudar, ordem, busca) {
  L.fecharDossie();
  L.irTabela(function (f, opt) { if (dim != null) f[dim] = [+id]; if (mudar) mudar(f, opt); }, { pagina: pagina, ordem: ordem, busca: busca });
}
var ROT = { comprador: "Comprador", fornecedor: "Fornecedor", produto: "Produto", mes: "Mês", depto: "Departamento", secao: "Seção", uf: "Estado", superv: "Supervisor" };

/* ------------------------------ abrir / fechar ------------------------------ */
L.abrirDossie = function (ent, manter) {
  if (!manter) pilha = [];
  var topo = pilha[pilha.length - 1];
  if (!topo || JSON.stringify(topo) !== JSON.stringify(ent)) pilha.push(ent);
  aba = "resumo";
  L.dica.esconder(); if (L.fecharPopover) L.fecharPopover();
  L.$("dossie").classList.add("on"); L.$("dossie-fundo").classList.add("on");
  document.body.style.overflow = "hidden";
  desenhar();
};
L.fecharDossie = function () { pilha = []; L.$("dossie").classList.remove("on"); L.$("dossie-fundo").classList.remove("on"); document.body.style.overflow = ""; };
L.dossieAberto = function () { return L.$("dossie").classList.contains("on"); };
document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && L.dossieAberto() && !document.querySelector(".pop")) L.fecharDossie(); });
document.addEventListener("click", function (ev) { if (ev.target && ev.target.id === "dossie-fundo") L.fecharDossie(); });

function abasDe(ent) {
  return ent.dim === "comprador" ? [["resumo", "Resumo"], ["produtos", "Produtos"], ["fornecedores", "Fornecedores"], ["verba", "Verba"]]
       : ent.dim === "fornecedor" ? [["resumo", "Resumo"], ["produtos", "Produtos"], ["verba", "Verba"]]
       : [["resumo", "Resumo"]];
}
function desenhar() {
  var ent = pilha[pilha.length - 1], box = L.$("dossie"), es = escopo(ent);
  L.limpar(box);
  box.appendChild(cabecalho(ent));
  var corpo = L.h("div", { class: "dos-corpo" });
  box.appendChild(corpo);
  if (pilha.length > 1) {
    var tr = L.h("div", { class: "dos-trilha" });
    pilha.forEach(function (e, i) {
      if (i) tr.appendChild(L.h("span", { text: "›" }));
      tr.appendChild(L.h("button", { type: "button", text: nomeEnt(e), onclick: function () { pilha = pilha.slice(0, i + 1); aba = "resumo"; desenhar(); } }));
    });
    corpo.appendChild(tr);
  }
  var abas = abasDe(ent);
  if (!abas.some(function (a) { return a[0] === aba; })) aba = abas[0][0];
  if (abas.length > 1) {
    var barra = L.h("div", { class: "dos-abas" });
    abas.forEach(function (a) { barra.appendChild(L.h("button", { type: "button", class: aba === a[0] ? "on" : "", text: a[1], onclick: function () { aba = a[0]; desenhar(); } })); });
    corpo.appendChild(barra);
  }
  var conteudo = L.h("div");
  corpo.appendChild(conteudo);
  try {
    var el = aba === "produtos" ? abaProdutos(ent, es) : aba === "fornecedores" ? abaFornecedores(ent, es) : aba === "verba" ? abaVerba(ent, es) : resumo(ent, es);
    conteudo.appendChild(el);
    L.executarFila();
  } catch (e) { console.error(e); conteudo.appendChild(L.erroTela("Não foi possível montar o relatório", e.message || String(e))); }
  box.scrollTop = 0;
}

function cabecalho(ent) {
  var subs = [], chip = function (ic, t) { return L.h("span", { html: L.ic(ic) + " " + L.esc(t) }); };
  subs.push(chip("relogio", "carga de " + L.fDataHora(L.META.geradoEm)));
  if (ent.dim === "produto") {
    var p = L.PM.get(+ent.id);
    if (p) {
      subs.push(chip("caixa", "Cód. " + p.cod));
      subs.push(chip("pessoas", L.nomeComprador(p.comp) === "—" ? "sem comprador ativo" : L.nomeComprador(p.comp)));
      subs.push(chip("carteira", L.nomeFornec(p.forn)));
      subs.push(chip("verificar", p.ativo ? "Ativo" : "Fora de linha"));
    }
  } else if (ent.dim === "comprador") {
    subs.push(chip("caixa", L.fInt(L.linhas("ruptura", escopo(ent)).length) + " produtos na carteira"));
  } else if (ent.dim === "fornecedor") {
    var rr = L.linhas("ruptura", escopo(ent));
    if (rr.length) subs.push(chip("pessoas", L.nomeComprador(rr[0].comp) === "—" ? "sem comprador ativo" : L.nomeComprador(rr[0].comp)));
    subs.push(chip("caixa", L.fInt(rr.length) + " produtos"));
  }
  var acoes = L.h("div", { class: "dos-acoes" });
  if (pilha.length > 1) acoes.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("dir").replace("<svg", '<svg style="transform:rotate(180deg)"') + " Voltar", onclick: function () { pilha.pop(); aba = "resumo"; desenhar(); } }));
  var filtraveis = L.dimsDaPagina();
  if (ent.dim && filtraveis.indexOf(ent.dim) >= 0) acoes.appendChild(L.h("button", { class: "btn ouro", type: "button", html: L.ic("filtro") + " Filtrar o painel por isso", onclick: function () { L.setFiltro(ent.dim, [ent.id]); L.fecharDossie(); L.toast("Painel filtrado: " + nomeEnt(ent), "ok"); } }));
  acoes.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("baixar") + " Imprimir / PDF", onclick: imprimir }));
  acoes.appendChild(L.h("button", { class: "btn-ic", type: "button", title: "Fechar (Esc)", html: L.ic("x"), onclick: L.fecharDossie }));
  var rotTipo = ROT[ent.dim] || "Recorte", foto = null;
  if (ent.dim === "produto" && L.temFoto(ent.id)) {
    var im = L.h("img", { src: L.urlFoto(ent.id), alt: "", loading: "lazy" });
    im.addEventListener("error", function () { if (foto) foto.remove(); });
    foto = L.h("div", { class: "dos-foto" }, im);
  }
  return L.h("div", { class: "dos-cab" }, foto,
    L.h("div", { style: { minWidth: 0 } },
      L.h("div", { class: "olho", html: L.ic(ent.dim && L.DIM[ent.dim] ? L.DIM[ent.dim].icone : "estrela").replace("<svg", '<svg style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2"') + "<span>Relatório · " + L.esc(rotTipo) + " · Central Compras</span>" }),
      L.h("h2", { text: nomeEnt(ent) }), L.h("div", { class: "sub" }, subs)),
    acoes);
}
function imprimir() {
  var tema = document.documentElement.getAttribute("data-tema");
  document.documentElement.setAttribute("data-tema", "claro"); document.body.classList.add("imprimindo");
  setTimeout(function () { L.redesenharTudo(); window.print(); document.body.classList.remove("imprimindo"); document.documentElement.setAttribute("data-tema", tema); L.redesenharTudo(); }, 250);
}

/* ============================ RESUMO ============================ */
function kpisCarteira(es, dim, id) {
  var rup = L.linhas("ruptura", es), ev = L.linhas("ev", es), ex = L.linhas("excesso", es), vb = L.linhas("verba", es);
  var nRup = rup.filter(function (r) { return r.ruptura; }).length, nExc = rup.filter(function (r) { return !r.cobertura; }).length;
  var avaria = L.soma(rup, "avaria"), verba = L.soma(vb, "verba"), capital = L.soma(ex, "valor");
  var vSug = L.soma(ev.filter(function (r) { return r.sug > 0; }), "valorSug");
  var venda = null, margem = null, lucro = null;
  if (dim === "comprador") { var c = L.C.fatComp.filter(function (x) { return L.compAtivo(x.comp) === +id; })[0]; if (c) { venda = c.venda; lucro = c.lucro; margem = c.margem; } }
  if (dim === "fornecedor") { var f = L.C.fatForn.filter(function (x) { return x.cod === +id; })[0]; if (f) { venda = f.venda; lucro = f.lucro; margem = f.venda ? f.lucro / f.venda : null; } }
  return { rup: rup, ev: ev, ex: ex, vb: vb, nRup: nRup, nExc: nExc, avaria: avaria, verba: verba, capital: capital, vSug: vSug, venda: venda, lucro: lucro, margem: margem };
}
function resumo(ent, es) {
  var raiz = L.h("div");
  if (ent.dim === "produto") return resumoProduto(ent, raiz);
  if (ent.dim === "comprador" || ent.dim === "fornecedor") return resumoCarteira(ent, es, raiz);
  return resumoFaturamento(ent, raiz);
}

function resumoCarteira(ent, es, raiz) {
  var k = kpisCarteira(es, ent.dim, ent.id), C = L.cores(), n = k.rup.length;
  var D = ent.dim, ID = ent.id, ir = function (pag, mudar, ordem) { return function () { irPara(pag, D, ID, mudar, ordem); }; };
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "caixa", rot: "Produtos", aoClicar: ir("compras", null, ["est", -1]), valor: n, fmt: L.fInt, classe: "heroi", leg: L.h("span", { text: "ruptura e cobertura · clique para listar" }) }),
    L.kpi({ icone: "alerta", rot: "Em ruptura", aoClicar: ir("compras", function (f) { f.ruptura = [1]; }, ["dias", 1]), valor: k.nRup, fmt: L.fInt, classe: k.nRup ? "perigo" : "zero", leg: L.h("span", { text: L.fPct(L.pct(k.nRup, n), 1) + " dos produtos" }) }),
    L.kpi({ icone: "armazem", rot: "Cobertura em excesso", aoClicar: ir("compras", function (f) { f.coberturaOk = [0]; }, ["dias", -1]), valor: k.nExc, fmt: L.fInt, classe: k.nExc ? "atencao" : "zero", leg: L.h("span", { text: L.fPct(L.pct(k.nExc, n), 1) + " dos produtos" }) }),
    L.kpi({ icone: "devolucao", rot: "Avaria", aoClicar: ir("compras", function (f) { f.comAvaria = [1]; }, ["avaria", -1]), valor: k.avaria, fmt: L.fRc, fmtTitulo: L.fR2, classe: k.avaria ? "atencao" : "zero", leg: L.h("span", { text: "filiais 1, 2, 7 e 8" }) }),
    L.kpi({ icone: "carteira", rot: "Verba", aoClicar: ir("saldo_verba", null, ["verba", -1]), valor: k.verba, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: L.h("span", { text: "saldo de movimentação" }) }),
    L.kpi({ icone: "armazem", rot: "Capital parado", aoClicar: ir("excesso", null, ["valor", -1]), valor: k.capital, fmt: L.fRc, fmtTitulo: L.fR2, classe: k.capital ? "atencao" : "zero", leg: L.h("span", { text: L.fInt(k.ex.length) + " produtos com excesso em 60 dias" }) }),
    L.kpi({ icone: "dinheiro", rot: "Valor sugerido", aoClicar: ir("estoque_venda", function (f) { f.sugestao = [1]; }, ["valorSug", -1]), valor: k.vSug, fmt: L.fRc, fmtTitulo: L.fR2, leg: L.h("span", { text: "compra para 8 semanas" }) }),
    L.kpi({ icone: "barras", rot: "Venda do ano", aoClicar: ir("performance", function (f, opt) { L.defOpt(opt, "performance", "corte", D === "comprador" ? "comprador" : "fornecedor"); }, ["venda", -1]), valor: k.venda, fmt: L.fRc, fmtTitulo: L.fR2, classe: "violeta", leg: L.h("span", { text: k.margem == null ? "sem venda no ano" : "margem de " + L.fPct(k.margem, 1) }) })));
  if (!n && !k.vb.length) { raiz.appendChild(L.estadoVazio("Nada neste recorte", "Este item não tem produto nem verba na carga atual.")); return raiz; }

  var g = L.h("div", { class: "grade" });
  var porProd = k.rup.slice().sort(function (a, b) { return (a.dias == null ? 1e9 : a.dias) - (b.dias == null ? 1e9 : b.dias); }).filter(function (r) { return r.ruptura; }).slice(0, 10);
  var pUrg = L.painel({ titulo: "Produtos em ruptura mais críticos", sub: "menos dias de venda em estoque · clique para abrir o relatório do produto", classe: "c-6" });
  L.rankingDim(pUrg.corpo, "produto", porProd.map(function (r) { return { k: r.codprod, rot: r.desc, valor: r.dias == null ? 0 : r.dias, r: r }; }), { fmt: function (v) { return L.fNum(v, 1) + " dias"; }, pct: false, cor: function () { return C.perigo; }, vazio: "Nenhum produto em ruptura.",
    dica: function (x) { return { titulo: x.rot, linhas: [{ rot: "Dias de venda", val: L.fNum(x.r.dias, 1) }, { rot: "Estoque", val: L.fNum(x.r.estCx, 1) + " CX" }, { rot: "Avaria", val: L.fR2(x.r.avaria) }] }; } });
  var pExc = L.painel({ titulo: "Produtos com mais capital parado", sub: "excedente ao preço de tabela · clique para abrir o relatório do produto", classe: "c-6" });
  var exTop = k.ex.slice().sort(function (a, b) { return b.valor - a.valor; }).slice(0, 10);
  L.rankingDim(pExc.corpo, "produto", exTop.map(function (e) { return { k: e.codprod, rot: e.desc, valor: e.valor, e: e }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: k.capital, cor: function (i) { return i === 0 ? C.atencao : C.d[0]; }, vazio: "Nenhum produto com excesso em 60 dias.",
    rotulo: "Capital parado", dica: function (x) { return { titulo: x.rot, linhas: [{ rot: "Capital parado", val: L.fR2(x.e.valor) }, { rot: "Excedente", val: L.fInt(Math.abs(x.e.sug)) + " un" }, { rot: "Disponível", val: L.fInt(x.e.disp) + " un" }] }; } });
  g.appendChild(pUrg); g.appendChild(pExc);
  raiz.appendChild(g);

  if (ent.dim === "comprador") {
    raiz.appendChild(L.h("div", { class: "grade", style: { marginTop: "16px" } }, painelVendaMes("Venda do comprador mês a mês", L.C.fatMesComp.filter(function (x) { return L.compAtivo(x.comp) === +ent.id; }))));
    var porF = fornecedoresDe(es), top = porF.slice().sort(function (a, b) { return b.avaria - a.avaria; }).filter(function (x) { return x.avaria > 0; }).slice(0, 10);
    var g2 = L.h("div", { class: "grade", style: { marginTop: "16px" } });
    var pAv = L.painel({ titulo: "Avaria por fornecedor", sub: "estoque indenizado nas filiais 1, 2, 7 e 8 · clique para abrir o relatório do fornecedor", classe: "c-6" });
    L.rankingDim(pAv.corpo, "fornecedor", top.map(function (x) { return { k: x.k, valor: x.avaria }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: k.avaria, rotulo: "Avaria" });
    var topR = porF.slice().sort(function (a, b) { return b.rup - a.rup; }).filter(function (x) { return x.rup > 0; }).slice(0, 10);
    var pRp = L.painel({ titulo: "Ruptura por fornecedor", sub: "itens com menos de 7 dias de venda · clique para abrir o relatório do fornecedor", classe: "c-6" });
    L.rankingDim(pRp.corpo, "fornecedor", topR.map(function (x) { return { k: x.k, valor: x.rup }; }), { fmt: L.fInt, total: k.nRup, rotulo: "Itens em ruptura", cor: function (i) { return i === 0 ? C.perigo : C.d[0]; } });
    g2.appendChild(pAv); g2.appendChild(pRp);
    raiz.appendChild(g2);
  }
  raiz.appendChild(L.nota("O relatório mostra o item inteiro, sem os filtros da tela. Ruptura: menos de 7 dias de venda. Cobertura em excesso: acima de 56 dias. Capital parado: excedente de 60 dias ao preço de tabela. Venda: ano corrente, venda normal."));
  return raiz;
}

/* uma linha por fornecedor dentro de um recorte (comprador): produtos, ruptura, excesso, avaria, capital, sugestão, verba */
function fornecedoresDe(es) {
  var m = new Map();
  function g(k) { var x = m.get(k); if (!x) { x = { k: k, n: 0, rup: 0, exc: 0, avaria: 0, capital: 0, sug: 0, verba: 0 }; m.set(k, x); } return x; }
  L.linhas("ruptura", es).forEach(function (r) { var x = g(r.forn == null ? 0 : r.forn); x.n++; if (r.ruptura) x.rup++; if (!r.cobertura) x.exc++; x.avaria += r.avaria || 0; });
  L.linhas("excesso", es).forEach(function (r) { g(r.forn == null ? 0 : r.forn).capital += r.valor; });
  L.linhas("ev", es).forEach(function (r) { if (r.sug > 0) g(r.forn == null ? 0 : r.forn).sug += r.valorSug || 0; });
  L.linhas("verba", es).forEach(function (r) { g(r.cod).verba += r.verba || 0; });
  return Array.from(m.values());
}

/* ============================ PRODUTO: a ficha ============================ */
function resumoProduto(ent, raiz) {
  var p = L.PM.get(+ent.id), C = L.cores();
  if (!p) { raiz.appendChild(L.estadoVazio("Produto fora do painel", "Este produto não consta nas consultas da carga atual.")); return raiz; }
  var r = p.rup, ev = p.ev, ex = p.exc;
  var ir = function (pag, mudar, ordem) { return function () { irPara(pag, "produto", p.cod, mudar, ordem); }; };
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "armazem", rot: "Estoque disponível", aoClicar: ir("compras", null, ["est", -1]), valor: r ? r.estCx : null, fmt: function (v) { return L.fNum(v, 1) + " CX"; }, classe: "heroi", leg: L.h("span", { text: r ? "giro de " + L.fNum(r.giroCx, 3) + " CX/dia" : "fora da consulta de ruptura" }) }),
    L.kpi({ icone: "alerta", rot: "Dias de venda", aoClicar: ir("compras", null, ["dias", 1]), valor: r ? r.dias : null, fmt: function (v) { return L.fNum(v, 1); }, classe: r && r.ruptura ? "perigo" : "ok", leg: L.h("span", { text: r ? (r.ruptura ? "em ruptura (menos de 7 dias)" : "sem ruptura") : "—" }) }),
    L.kpi({ icone: "medidor", rot: "Cobertura", aoClicar: ir("estoque_venda", null, ["cob", 1]), valor: ev ? ev.cob : null, fmt: function (v) { return L.fNum(v, 1) + " sem"; }, classe: ev && ev.cob > 8 ? "atencao" : "ok", leg: L.h("span", { text: ev ? (ev.cob == null ? "sem venda suficiente para calcular" : "meta de compra: 8 semanas") : "fora da consulta de estoque x venda" }) }),
    L.kpi({ icone: "carteira", rot: "Sugestão de compra", aoClicar: ir("sugestao", function (f, opt) { L.defOpt(opt, "sugestao", "visao", "produto"); }, ["valor", -1]), valor: ev && ev.sug > 0 ? ev.valorSug : 0, fmt: L.fRc, fmtTitulo: L.fR2, classe: ev && ev.sug > 0 ? "ok" : "zero", leg: L.h("span", { text: ev && ev.sug > 0 ? L.fInt(ev.sug) + " un · 8 semanas" : "sem sugestão" }) }),
    L.kpi({ icone: "armazem", rot: "Capital parado", aoClicar: ir("excesso", null, ["valor", -1]), valor: ex ? ex.valor : 0, fmt: L.fRc, fmtTitulo: L.fR2, classe: ex ? "atencao" : "zero", leg: L.h("span", { text: ex ? L.fInt(Math.abs(ex.sug)) + " un acima de 60 dias" : "sem excesso em 60 dias" }) }),
    L.kpi({ icone: "devolucao", rot: "Avaria", aoClicar: ir("compras", null, ["avaria", -1]), valor: r ? r.avaria : p.avaria, fmt: L.fRc, fmtTitulo: L.fR2, classe: (r ? r.avaria : p.avaria) ? "atencao" : "zero", leg: L.h("span", { text: "filiais 1, 2, 7 e 8" }) })));
  var g = L.h("div", { class: "grade" });
  var pSem = L.painel({ titulo: "Venda das últimas 9 semanas", sub: "unidades por semana · a atual está em curso", classe: "c-6" }), bSem = L.h("div");
  pSem.corpo.appendChild(bSem);
  if (ev && ev.vendaTot > 0) {
    var SEM = [8, 7, 6, 5, 4, 3, 2, 1, 0];
    L.graf.colunas(bSem, { categorias: SEM.map(function (i) { return { rot: i === 0 ? "atual" : "-" + i }; }), altura: 240, fmt: L.fInt,
      series: [{ nome: "Unidades", valores: SEM.map(function (i) { return ev.semanas[i] || 0; }), cor: C.d[0] }], corBarra: function (c) { return SEM[c] === 0 ? C.d[7] : C.d[0]; },
      dica: function (c) { return { titulo: SEM[c] === 0 ? "Semana atual" : "Há " + SEM[c] + (SEM[c] === 1 ? " semana" : " semanas"), linhas: [{ rot: "Unidades", val: L.fInt(ev.semanas[SEM[c]] || 0) }] }; } });
  } else bSem.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda no período</b>O produto não vendeu nas 9 semanas da consulta." }));
  var pCob = L.painel({ titulo: "O que cada consulta diz", sub: "a ficha do produto, consulta a consulta", classe: "c-6" });
  var lista = L.h("div", { class: "ficha" });
  function linha(rot, val) { lista.appendChild(L.h("div", { class: "ficha-l" }, L.h("span", { text: rot }), L.h("b", { class: "num", html: val }))); }
  linha("Situação do produto", L.tagAtivo(p.ativo));
  linha("Ruptura", r ? L.tagSimNao(r.ruptura, "perigo") : "não consta");
  linha("Cobertura de 56 dias", r ? L.tagCob(r.cobertura) : "não consta");
  linha("Média aparada (venda semanal)", ev && ev.media != null ? L.esc(L.fNum(ev.media, 1)) + " un" : "—");
  linha("Preço de venda", ev ? L.esc(L.fR2(ev.preco)) : "—");
  linha("Pendente de recebimento", ev && ev.pendente ? L.esc(L.fInt(ev.pendente)) + " un" : "—");
  linha("Comprador", L.esc(L.nomeComprador(p.comp)));
  linha("Fornecedor", L.esc(L.nomeFornec(p.forn)));
  pCob.corpo.appendChild(lista);
  g.appendChild(pSem); g.appendChild(pCob);
  raiz.appendChild(g);

  var t = L.tabela({
    titulo: "Sugestão por filial — " + p.desc, arquivo: "compras-produto-" + p.cod, aba: "Por filial", porPagina: 0, linhas: p.sugp, busca: false, ordem: { id: "filial", desc: false }, filtrosTexto: function () { return [["Produto", p.cod + " · " + p.desc], ["Posição", "carga de " + L.fDataHora(L.META.geradoEm)]]; },
    colunas: [
      { id: "filial", titulo: "Filial", tipo: "inteiro", valor: function (x) { return x.filial; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "volume", titulo: "Volume líq. 3m", tipo: "inteiro", valor: function (x) { return x.volume; } },
      { id: "giro", titulo: "Giro/dia", tipo: "num2", valor: function (x) { return x.giro; }, fmt: function (v) { return L.fNum(v, 3); }, somar: false, exportarTipo: "moeda" },
      { id: "disp", titulo: "Disponível", tipo: "inteiro", valor: function (x) { return x.disp; } },
      { id: "sug", titulo: "Sugestão (un)", tipo: "inteiro", valor: function (x) { return x.sug; } },
      { id: "preco", titulo: "Preço", tipo: "moeda", valor: function (x) { return x.preco; }, somar: false },
      { id: "valor", titulo: "Valor", tipo: "moeda", valor: function (x) { return x.valor; } }],
    totais: function () { return [{ rot: "Filiais", valor: String(p.sugp.length), pri: true }, { rot: "Sugestão", valor: L.fInt(L.soma(p.sugp, "sug")) + " un" }, { rot: "Valor", valor: L.fR2(L.soma(p.sugp, "valor")) }]; },
    vazio: "O produto não tem sugestão por filial na carga atual.",
  });
  raiz.appendChild(L.grade(L.painel({ titulo: "Sugestão por filial", sub: "consulta por produto: filiais 1, 7 e 12 · baseada nos 3 meses fechados anteriores", classe: "c-12", semPad: true, corpo: t })));
  return raiz;
}

/* ============================ FATURAMENTO: mês, departamento, seção, estado, supervisor ============================ */
function resumoFaturamento(ent, raiz) {
  var F = L.C, C = L.cores();
  if (ent.dim === "mes") {
    var s = String(ent.id), ym = s.slice(0, 4) + "-" + s.slice(4);
    var i = F.fatMes.findIndex(function (m) { return m.mes === ym; }), m = F.fatMes[i], ant = i > 0 ? F.fatMes[i - 1] : null;
    if (!m) { raiz.appendChild(L.estadoVazio("Mês fora da base", "Esse mês não consta no faturamento da carga atual.")); return raiz; }
    var irM = function () { irPara("metricas", "mes", ent.id, function (f, opt) { L.defOpt(opt, "metricas", "visao", "meses"); }, ["mes", -1]); };
    raiz.appendChild(L.kpis(
      L.kpi({ icone: "dinheiro", rot: "Venda", aoClicar: irM, valor: m.venda, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: [L.delta({ atual: m.venda, base: ant && ant.venda }), L.h("span", { text: ant ? "contra " + L.fMesLongo(ant.mes) : "primeiro mês da base" })] }),
      L.kpi({ icone: "barras", rot: "Lucro", aoClicar: irM, valor: m.lucro, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: [L.delta({ atual: m.lucro, base: ant && ant.lucro }), L.h("span", { text: "venda menos CMV" })] }),
      L.kpi({ icone: "percent", rot: "Margem", aoClicar: irM, valor: m.margem, fmt: function (v) { return L.fPct(v, 1); }, classe: "violeta", leg: [L.delta({ atual: m.margem, base: ant && ant.margem, pp: true }), L.h("span", { text: "pontos percentuais" })] }),
      L.kpi({ icone: "caixa", rot: "Pedidos", aoClicar: irM, valor: m.pedidos, fmt: L.fInt, leg: [L.delta({ atual: m.pedidos, base: ant && ant.pedidos }), L.h("span", { text: "pedidos de venda normal" })] }),
      L.kpi({ icone: "pessoas", rot: "Positivação", aoClicar: irM, valor: m.posit, fmt: L.fInt, leg: [L.delta({ atual: m.posit, base: ant && ant.posit }), L.h("span", { text: "clientes somados por dia" })] }),
      L.kpi({ icone: "relogio", rot: "Custo da mercadoria", aoClicar: irM, valor: m.cmv, fmt: L.fRc, fmtTitulo: L.fR2, leg: L.h("span", { text: "CMV do mês" }) })));
    var p = L.painel({ titulo: "O ano, mês a mês", sub: "a coluna em ouro é o mês deste relatório · clique para abrir outro mês", classe: "c-12" }), b = L.h("div");
    p.corpo.appendChild(b);
    L.graf.colunas(b, { categorias: F.fatMes.map(function (x) { return { rot: L.fMesAno(x.mes) }; }), altura: 260, fmt: L.fRc, tipo: "moeda",
      series: [{ nome: "Venda", valores: F.fatMes.map(function (x) { return x.venda; }), cor: C.d[0] }], corBarra: function (c) { return c === i ? C.ouro : C.d[0]; },
      dica: function (c) { var y = F.fatMes[c]; return { titulo: L.fMesLongo(y.mes), linhas: [{ rot: "Venda", val: L.fR2(y.venda) }, { rot: "Lucro", val: L.fR2(y.lucro) }, { rot: "Margem", val: L.fPct(y.margem, 1) }] }; },
      aoClicar: function (c) { L.abrirDossie({ dim: "mes", id: +F.fatMes[c].mes.replace("-", "") }, true); } });
    raiz.appendChild(L.grade(p));
    return raiz;
  }
  // departamento, seção, estado, supervisor
  var fonte = ent.dim === "depto" ? F.fatDepto : ent.dim === "secao" ? F.fatSec : ent.dim === "uf" ? F.fatUf.map(function (u, k) { return Object.assign({ cod: k }, u); }) : F.fatSup;
  var nomeDe = function (y) { return ent.dim === "uf" ? y.uf : L.titulo(y.nome); };
  var ordenado = fonte.slice().sort(function (a, b) { return b.venda - a.venda; });
  var pos = ordenado.findIndex(function (y) { return y.cod === +ent.id; }), me = ordenado[pos];
  if (!me) { raiz.appendChild(L.estadoVazio("Fora da base", "Este item não consta no faturamento da carga atual.")); return raiz; }
  var nomeItem = nomeEnt(ent);
  var irD = function (ordem) {
    return function () {
      if (ent.dim === "superv") irPara("performance", null, null, function (f, opt) { L.defOpt(opt, "performance", "corte", "supervisor"); }, ordem, nomeItem);
      else irPara("metricas", null, null, function (f, opt) { L.defOpt(opt, "metricas", "visao", ent.dim === "depto" ? "departamento" : ent.dim === "secao" ? "secao" : "estado"); }, ordem, nomeItem);
    };
  };
  var totalV = L.soma(fonte, "venda"), totalL = L.soma(fonte, "lucro");
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "dinheiro", rot: "Venda", aoClicar: irD(["venda", -1]), valor: me.venda, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: L.h("span", { text: L.fPct(L.pct(me.venda, totalV), 1) + " da venda de " + periodo() }) }),
    L.kpi({ icone: "barras", rot: "Lucro", aoClicar: irD(["lucro", -1]), valor: me.lucro, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: L.h("span", { text: L.fPct(L.pct(me.lucro, totalL), 1) + " do lucro" }) }),
    L.kpi({ icone: "percent", rot: "Margem", aoClicar: irD(["margem", -1]), valor: me.venda ? me.lucro / me.venda : null, fmt: function (v) { return L.fPct(v, 1); }, classe: "violeta", leg: L.h("span", { text: "média geral: " + L.fPct(L.pct(totalL, totalV), 1) }) }),
    L.kpi({ icone: "estrela", rot: "Posição", aoClicar: irD(["venda", -1]), valor: pos + 1, fmt: function (v) { return v + "º"; }, leg: L.h("span", { text: "de " + ordenado.length + " por venda" }) })));
  var pr = L.painel({ titulo: "Onde está entre os demais", sub: "venda do período · o item deste relatório em ouro · clique para abrir outro", classe: "c-12" });
  L.rankingDim(pr.corpo, ent.dim, ordenado.slice(0, 20).map(function (y) { return { k: y.cod, rot: nomeDe(y), valor: y.venda, y: y }; }), { fmt: L.fRc, fmtCheio: L.fR2, total: totalV, rotulo: "Venda", cor: function (i, x) { return x.rot === nomeDe(me) ? L.cores().ouro : L.cores().d[0]; },
    dica: function (x) { return { titulo: x.rot, linhas: [{ rot: "Venda", val: L.fR2(x.valor) }, { rot: "Lucro", val: L.fR2(x.y.lucro) }], extra: '<div class="dica-sub">Margem de ' + L.esc(L.fPct(L.pct(x.y.lucro, x.y.venda), 1)) + "</div>" }; },
    aoClicar: function (x) { L.abrirDossie({ dim: ent.dim, id: x.k }, true); } });
  raiz.appendChild(L.grade(pr));
  if (ent.dim === "depto") raiz.appendChild(L.h("div", { class: "grade", style: { marginTop: "16px" } }, painelVendaMes("Venda do departamento mês a mês", L.C.fatMesDepto.filter(function (x) { return x.cod === +ent.id; }))));
  return raiz;
}
/* as colunas de venda mês a mês de um recorte (comprador ou departamento): clicar abre o relatório do mês */
function painelVendaMes(titulo, linhas) {
  var porMes = new Map(), C = L.cores();
  linhas.forEach(function (x) { var g = porMes.get(x.mes) || { mes: x.mes, venda: 0, lucro: 0 }; g.venda += x.venda || 0; g.lucro += x.lucro || 0; porMes.set(x.mes, g); });
  var serie = Array.from(porMes.values()).sort(function (a, b) { return a.mes < b.mes ? -1 : 1; });
  var p = L.painel({ titulo: titulo, sub: "venda de cada mês do ano · clique na coluna para abrir o relatório do mês", classe: "c-12" }), b = L.h("div");
  p.corpo.appendChild(b);
  if (!serie.length) { b.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda no ano</b>Este item não tem venda mês a mês na carga atual." })); return p; }
  L.graf.colunas(b, { categorias: serie.map(function (m) { return { rot: L.fMesAno(m.mes) }; }), altura: 240, fmt: L.fRc, tipo: "moeda",
    series: [{ nome: "Venda", valores: serie.map(function (m) { return m.venda; }), cor: C.d[0] }],
    dica: function (c) { var m = serie[c]; return { titulo: L.fMesLongo(m.mes), linhas: [{ rot: "Venda", val: L.fR2(m.venda), cor: C.d[0] }, { rot: "Lucro", val: L.fR2(m.lucro), cor: C.ok }], extra: '<div class="dica-sub">Margem de ' + L.esc(L.fPct(L.pct(m.lucro, m.venda), 1)) + "</div>" }; },
    aoClicar: function (c) { L.abrirDossie({ dim: "mes", id: +serie[c].mes.replace("-", "") }, true); } });
  return p;
}
function periodo() {
  var m = L.C.fatMes; if (!m.length) return "sem dados";
  var a = L.fMesAno(m[0].mes), b = L.fMesAno(m[m.length - 1].mes); return a === b ? a : a + " – " + b;
}

/* ============================ PRODUTOS, FORNECEDORES, VERBA ============================ */
function abaProdutos(ent, es) {
  var lin = L.linhas("ruptura", es);
  var t = L.tabelaRuptura(lin, { titulo: "Produtos — " + nomeEnt(ent), ordem: { id: "dias", desc: false }, filtrosTexto: function () { return [["Relatório", ROT[ent.dim] + ": " + nomeEnt(ent)], ["Posição", "carga de " + L.fDataHora(L.META.geradoEm)]]; },
    aoClicar: function (r) { L.abrirDossie({ dim: "produto", id: r.codprod }, true); } });
  return L.grade(L.painel({ titulo: "Produtos do recorte", sub: L.fInt(lin.length) + " produtos · ruptura, cobertura e avaria de cada um · clique para abrir o produto", classe: "c-12", semPad: true, corpo: t }));
}
function abaFornecedores(ent, es) {
  var lin = fornecedoresDe(es).map(function (x) { return Object.assign({ forn: x.k }, x); });
  var t = L.tabela({
    titulo: "Fornecedores — " + nomeEnt(ent), arquivo: "compras-fornecedores-" + nomeEnt(ent).toLowerCase().replace(/\W+/g, "-"), aba: "Fornecedores", porPagina: 25, linhas: lin, ordem: { id: "avaria", desc: true },
    buscaDica: "Buscar fornecedor…", buscaTexto: function (x) { return L.nomeDe("fornecedor", x.forn); }, filtrosTexto: function () { return [["Relatório", "Comprador: " + nomeEnt(ent)], ["Posição", "carga de " + L.fDataHora(L.META.geradoEm)]]; },
    colunas: [
      { id: "nome", titulo: "Fornecedor", tipo: "texto", valor: function (x) { return L.nomeDe("fornecedor", x.forn); } },
      { id: "n", titulo: "Produtos", tipo: "inteiro", valor: function (x) { return x.n; } },
      { id: "rup", titulo: "Em ruptura", tipo: "inteiro", valor: function (x) { return x.rup; } },
      { id: "exc", titulo: "Em excesso", tipo: "inteiro", valor: function (x) { return x.exc; } },
      { id: "avaria", titulo: "Avaria", tipo: "moeda", valor: function (x) { return x.avaria; }, barra: true, corBarra: "rgba(255,107,116,.18)" },
      { id: "capital", titulo: "Capital parado", tipo: "moeda", valor: function (x) { return x.capital; } },
      { id: "sug", titulo: "Valor sugerido", tipo: "moeda", valor: function (x) { return x.sug; } },
      { id: "verba", titulo: "Verba", tipo: "moeda", valor: function (x) { return x.verba; } }],
    totais: function (res) { var l = res.todas || res.linhas; return [{ rot: "Fornecedores", valor: L.fInt(l.length), pri: true }, { rot: "Em ruptura", valor: L.fInt(L.soma(l, "rup")) }, { rot: "Avaria", valor: L.fR2(L.soma(l, "avaria")) }, { rot: "Capital parado", valor: L.fR2(L.soma(l, "capital")) }, { rot: "Valor sugerido", valor: L.fR2(L.soma(l, "sug")) }, { rot: "Verba", valor: L.fR2(L.soma(l, "verba")) }]; },
    aoClicar: function (x) { L.abrirDossie({ dim: "fornecedor", id: x.forn }, true); }, vazio: "Nenhum fornecedor neste recorte.",
  });
  return L.grade(L.painel({ titulo: "Fornecedores da carteira", sub: L.fInt(lin.length) + " fornecedores · clique para abrir o relatório do fornecedor", classe: "c-12", semPad: true, corpo: t }));
}
function abaVerba(ent, es) {
  var lin = L.linhas("verba", es);
  var t = L.tabela({
    titulo: "Verba — " + nomeEnt(ent), arquivo: "compras-verba-" + nomeEnt(ent).toLowerCase().replace(/\W+/g, "-"), aba: "Verba", porPagina: 25, linhas: lin, ordem: { id: "saldo", desc: false },
    buscaDica: "Buscar fornecedor…", buscaTexto: function (v) { return v.cod + " " + v.nome; }, filtrosTexto: function () { return [["Relatório", ROT[ent.dim] + ": " + nomeEnt(ent)], ["Posição", "carga de " + L.fDataHora(L.META.geradoEm)]]; },
    colunas: [
      { id: "nome", titulo: "Fornecedor principal", tipo: "texto", valor: function (v) { return L.titulo(v.nome); } },
      { id: "verba", titulo: "Verba (saldo mov.)", tipo: "moeda", valor: function (v) { return v.verba; } },
      { id: "avaria", titulo: "Avaria", tipo: "moeda", valor: function (v) { return v.avaria; } },
      { id: "saldo", titulo: "Saldo", tipo: "moeda", valor: function (v) { return v.saldo; }, classe: function (v) { return v < 0 ? "neg" : "pos"; } },
      { id: "vencidas", titulo: "Vencidas", tipo: "moeda", valor: function (v) { return v.vencidas; } },
      { id: "avencer", titulo: "A vencer", tipo: "moeda", valor: function (v) { return v.avencer; } }],
    totais: function (res) { var l = res.todas || res.linhas; return [{ rot: "Fornecedores", valor: L.fInt(l.length), pri: true }, { rot: "Verba", valor: L.fR2(L.soma(l, "verba")) }, { rot: "Avaria", valor: L.fR2(L.soma(l, "avaria")) }, { rot: "Saldo", valor: L.fR2(L.soma(l, "saldo")) }, { rot: "Vencidas", valor: L.fR2(L.soma(l, "vencidas")) }, { rot: "A vencer", valor: L.fR2(L.soma(l, "avencer")) }]; },
    aoClicar: function (v) { L.abrirDossie({ dim: "fornecedor", id: v.cod }, true); }, vazio: "Nenhum fornecedor principal com verba neste recorte.",
  });
  return L.grade(L.painel({ titulo: "Verba e avaria dos fornecedores principais", sub: L.fInt(lin.length) + " fornecedores principais · clique para abrir o relatório", classe: "c-12", semPad: true, corpo: t }));
}

})();
