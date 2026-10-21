/* =============================================================================
 * pag-compras.js — COMPRAS: ruptura e cobertura de estoque.
 *   Ruptura compara a necessidade de 7 dias de venda com o estoque disponível.
 *   Cobertura usa 56 dias (8 semanas): acima disso o item entra como excesso.
 *   A verba vem da consulta oficial de saldo de verba (Consulta3/SALDOMOV).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "compras", grupo: "Estoque e compras", menu: "Compras", icone: "home",
  titulo: "Ruptura e cobertura de estoque", olho: "Página 01 · Compras",
  filtros: ["comprador", "fornecedor", "status", "ruptura", "coberturaOk"], mais: ["comAvaria", "produto"],
  render: render,
});

/* colunas da planilha de produtos (a mesma lista serve ao relatório de comprador e fornecedor) */
L.colunasRuptura = function () {
  return [
    { id: "desc", titulo: "Descrição", tipo: "texto", valor: function (r) { return r.desc; } },
    { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (r) { return r.codprod; }, fmt: function (v) { return String(v); }, somar: false },
    { id: "comp", titulo: "Comprador", tipo: "texto", valor: function (r) { return L.nomeComprador(r.comp); } },
    { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (r) { return L.nomeFornec(r.forn); }, essencial: false },
    { id: "est", titulo: "Est. disp. (CX)", tipo: "num", valor: function (r) { return r.estCx; }, fmt: function (v) { return L.fNum(v, 1); }, exportarTipo: "moeda" },
    { id: "giro", titulo: "Giro/dia (CX)", tipo: "num2", valor: function (r) { return r.giroCx; }, fmt: function (v) { return L.fNum(v, 3); }, exportarTipo: "moeda", somar: false, essencial: false },
    { id: "dias", titulo: "Dias de venda", tipo: "num", valor: function (r) { return r.dias; }, fmt: L.fDias, exportarTipo: "moeda", somar: false },
    { id: "status", titulo: "Status", tipo: "tag", valor: function (r) { return r.ativo ? "Ativo" : "Fora de linha"; }, fmt: function (v, r) { return { html: L.tagAtivo(r.ativo) }; }, ordVal: function (r) { return r.ativo ? 1 : 0; } },
    { id: "rup", titulo: "Ruptura", tipo: "tag", valor: function (r) { return r.ruptura ? "Sim" : "Não"; }, fmt: function (v, r) { return { html: L.tagSimNao(r.ruptura, "perigo") }; }, ordVal: function (r) { return r.ruptura ? 1 : 0; } },
    { id: "cob", titulo: "Cobertura", tipo: "tag", valor: function (r) { return r.cobertura ? "Dentro da meta" : "Excesso"; }, fmt: function (v, r) { return { html: L.tagCob(r.cobertura) }; }, ordVal: function (r) { return r.cobertura ? 1 : 0; } },
    { id: "avaria", titulo: "Avaria", tipo: "moeda", valor: function (r) { return r.avaria; }, barra: true, corBarra: "rgba(255,107,116,.18)", dica: "Estoque indenizado nas filiais 1, 2, 7 e 8" },
  ];
};
L.tabelaRuptura = function (linhas, cfg) {
  return L.tabela(Object.assign({
    titulo: "Detalhe por produto — ruptura e cobertura", arquivo: "compras-ruptura-cobertura", aba: "Produtos", porPagina: 25,
    ordem: L.ordemTabela({ id: "est", desc: true }), linhas: linhas, colunas: L.colunasRuptura(),
    buscaDica: "Buscar produto por código, nome ou fornecedor…",
    buscaTexto: function (r) { return r.codprod + " " + r.desc + " " + L.nomeFornec(r.forn); },
    totais: function (res) {
      var l = res.todas || res.linhas, rup = 0, exc = 0, av = 0;
      l.forEach(function (r) { if (r.ruptura) rup++; if (!r.cobertura) exc++; av += r.avaria || 0; });
      return [{ rot: "Itens", valor: L.fInt(l.length), pri: true }, { rot: "Em ruptura", valor: L.fInt(rup) }, { rot: "Em excesso", valor: L.fInt(exc) }, { rot: "Avaria", valor: L.fR2(av) }];
    },
    foto: function (r) { return r.codprod; }, fotoColuna: "desc",
    aoClicar: function (r, ev) { L.clique("produto", r.codprod, ev); },
    vazio: "Nenhum produto com os filtros atuais.",
  }, cfg || {}));
};

function render(raiz) {
  var spec = L.spec(), lin = L.linhas("ruptura", spec), verbas = L.linhas("verba", spec);
  var total = lin.length, ativos = 0, rup = 0, exc = 0, avaria = 0;
  lin.forEach(function (r) { if (r.ativo) ativos++; if (r.ruptura) rup++; if (!r.cobertura) exc++; avaria += r.avaria || 0; });
  var verba = L.soma(verbas, "verba");
  var irRup = [function (f) { f.ruptura = [1]; }, { ordem: ["dias", 1] }], irExc = [function (f) { f.coberturaOk = [0]; }, { ordem: ["dias", -1] }];

  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "devolucao", rot: "Avaria", valor: avaria, fmt: L.fRc, fmtTitulo: L.fR2, classe: "heroi", leg: L.h("span", { text: "estoque indenizado · filiais 1, 2, 7 e 8" }), ir: [function (f) { f.comAvaria = [1]; }, { ordem: ["avaria", -1] }] }),
    L.kpiIr({ icone: "verificar", rot: "Total ativos", valor: ativos, fmt: L.fInt, leg: L.h("span", { text: "itens que não estão fora de linha" }), ajuda: "A coluna OBS2 do WinThor não distingue os dois valores em todos os produtos. Quem não é explicitamente FORALINHA entra como ativo.", ir: [function (f) { f.status = [1]; }] }),
    L.kpiIr({ icone: "caixa", rot: "Total de itens", valor: total, fmt: L.fInt, leg: L.h("span", { text: "produtos de revenda na carga" }), ir: [null] }),
    L.kpiIr({ icone: "alerta", rot: "Itens c/ ruptura", valor: rup, fmt: L.fInt, classe: rup ? "perigo" : "zero", leg: L.h("span", { text: "menos de 7 dias de venda em estoque" }), ir: irRup }),
    L.kpiIr({ icone: "carteira", rot: "Verba", valor: verba, fmt: L.fRc, fmtTitulo: L.fR2, classe: "ok", leg: L.h("span", { text: "saldo de movimentação por fornecedor" }), ajuda: "Vem da consulta oficial de saldo de verba (Consulta3/SALDOMOV). Clique para abrir o Saldo verba.", aoClicar: function () { L.irTabela(null, { pagina: "saldo_verba", ordem: ["verba", -1] }); } }),
    L.kpiIr({ icone: "armazem", rot: "Cobertura excesso", valor: exc, fmt: L.fInt, classe: exc ? "atencao" : "zero", leg: L.h("span", { text: "estoque acima de 56 dias de venda" }), ir: irExc }),
    L.kpiIr({ icone: "percent", rot: "% excesso estoque", valor: L.pct(exc, total), fmt: function (v) { return L.fPct(v, 1); }, classe: exc ? "atencao" : "zero", leg: L.h("span", { text: "sobre os itens filtrados" }), ir: irExc }),
    L.kpiIr({ icone: "percent", rot: "% ruptura", valor: L.pct(rup, total), fmt: function (v) { return L.fPct(v, 1); }, classe: rup ? "perigo" : "zero", leg: L.h("span", { text: "sobre os itens filtrados" }), ir: irRup })));

  if (!total) { raiz.appendChild(L.estadoVazio("Nada com estes filtros", "Limpe algum filtro para ver os produtos.")); return; }

  // ---------------- roscas: ruptura e cobertura
  function rosca(titulo, sub, fat, centro, dim, ordens) {
    var p = L.painel({ titulo: titulo, sub: sub, classe: "c-6" }), b = L.h("div");
    p.corpo.appendChild(b);
    var ir = function (i) { L.irTabela(function (f) { f[dim] = [fat[i].alvo]; }, ordens && ordens[i] ? { ordem: ordens[i] } : null); };
    L.graf.rosca(b, { fatias: fat.map(function (x, i) { return { rot: x.rot, valor: x.valor, cor: x.cor, corTexto: x.corTexto, idxOriginal: i }; }), altura: 240, fmt: L.fInt, centro: centro,
      dica: function (i, s, f, tot) { return { titulo: fat[i].rot, linhas: [{ rot: "Itens", val: L.fInt(fat[i].valor) + " (" + L.fPct(fat[i].valor / tot, 1) + ")" }, { rot: "Avaria", val: L.fR2(fat[i].avaria) }] }; },
      aoClicar: function (i) { ir(i); } });
    p.corpo.appendChild(L.graf.legendaLista(fat.map(function (x) { return { rot: x.rot, valor: x.valor, cor: x.cor }; }), L.fInt, function (i) { ir(i); }));
    return p;
  }
  var C = L.cores(), avRup = 0, avExc = 0;
  lin.forEach(function (r) { if (r.ruptura) avRup += r.avaria || 0; if (!r.cobertura) avExc += r.avaria || 0; });
  var pRup = rosca("Ruptura de venda", "necessidade de 7 dias de venda contra o estoque disponível · clique para ver os itens",
    [{ rot: "Ruptura", valor: rup, cor: C.perigo, alvo: 1, avaria: avRup, corTexto: "#fff" }, { rot: "Sem ruptura", valor: total - rup, cor: C.ok, alvo: 0, avaria: avaria - avRup, corTexto: "#0b1533" }],
    { valor: L.fPct(L.pct(rup, total), 0), titulo: "em ruptura" }, "ruptura", [["dias", 1], null]);
  var pCob = rosca("Cobertura de estoque", "necessidade de 56 dias (8 semanas) contra o estoque disponível · clique para ver os itens",
    [{ rot: "Excesso", valor: exc, cor: C.atencao, alvo: 0, avaria: avExc, corTexto: "#0b1533" }, { rot: "Dentro da meta", valor: total - exc, cor: C.ok, alvo: 1, avaria: avaria - avExc, corTexto: "#0b1533" }],
    { valor: L.fPct(L.pct(exc, total), 0), titulo: "em excesso" }, "coberturaOk", [["dias", -1], null]);
  raiz.appendChild(L.grade(pRup, pCob));

  // ---------------- por comprador
  var porComp = L.agrupar(lin, "comprador", function (g, r) { g.rup = (g.rup || 0) + (r.ruptura ? 1 : 0); g.exc = (g.exc || 0) + (r.cobertura ? 0 : 1); g.avaria = (g.avaria || 0) + (r.avaria || 0); });
  var verbaComp = {}; L.agrupar(verbas, "comprador", function (g, v) { g.v = (g.v || 0) + (v.verba || 0); }).forEach(function (g) { verbaComp[g.k] = g.v || 0; });
  var pRC = L.painel({ titulo: "Ruptura por comprador", sub: "itens com menos de 7 dias de venda · clique para abrir o relatório do comprador", classe: "c-6" });
  L.rankingDim(pRC.corpo, "comprador", porComp.filter(function (g) { return g.rup > 0; }).sort(function (a, b) { return b.rup - a.rup; }).slice(0, 10).map(function (g) { return { k: g.k, valor: g.rup, avaria: g.avaria, n: g.n }; }), {
    fmt: L.fInt, total: rup, rotulo: "Itens em ruptura", cor: function (i) { return i === 0 ? C.perigo : C.d[0]; },
    dica: function (x) { return { titulo: L.nomeDe("comprador", x.k), linhas: [{ rot: "Itens em ruptura", val: L.fInt(x.valor) + " de " + L.fInt(x.n) }, { rot: "Avaria", val: L.fR2(x.avaria) }] }; } });
  var pAC = L.painel({ titulo: "Avaria por comprador", sub: "estoque indenizado nas filiais 1, 2, 7 e 8 · clique para abrir o relatório do comprador", classe: "c-6" });
  L.rankingDim(pAC.corpo, "comprador", porComp.filter(function (g) { return g.avaria > 0; }).sort(function (a, b) { return b.avaria - a.avaria; }).slice(0, 10).map(function (g) { return { k: g.k, valor: g.avaria }; }), {
    fmt: L.fRc, fmtCheio: L.fR2, total: avaria, rotulo: "Avaria", cor: function (i) { return i === 0 ? C.ouro : C.d[0]; } });
  raiz.appendChild(L.grade(pRC, pAC));

  // ---------------- matriz por comprador
  var linhasM = porComp.map(function (g) { return { k: g.k, itens: g.n, pctExc: L.pct(g.exc, g.n) || 0, pctRup: L.pct(g.rup, g.n) || 0, rup: g.rup, exc: g.exc, avaria: g.avaria, verba: verbaComp[g.k] || 0, saldo: (verbaComp[g.k] || 0) - g.avaria }; });
  var tM = L.tabela({
    titulo: "Matriz por comprador", arquivo: "compras-matriz-comprador", aba: "Matriz", porPagina: 0, linhas: linhasM, ordem: { id: "itens", desc: true }, busca: false, exportar: true,
    colunas: [
      { id: "comp", titulo: "Comprador", tipo: "texto", valor: function (x) { return L.nomeDe("comprador", x.k); } },
      { id: "itens", titulo: "Itens", tipo: "inteiro", valor: function (x) { return x.itens; } },
      { id: "pe", titulo: "% Excesso", tipo: "pct", valor: function (x) { return x.pctExc; }, barra: true, corBarra: "rgba(255,179,64,.22)", somar: false, dica: "Itens com cobertura acima de 56 dias" },
      { id: "pr", titulo: "% Ruptura", tipo: "pct", valor: function (x) { return x.pctRup; }, barra: true, corBarra: "rgba(255,107,116,.22)", somar: false, dica: "Itens com menos de 7 dias de venda" },
      { id: "avaria", titulo: "Avaria", tipo: "moeda", valor: function (x) { return x.avaria; } },
      { id: "verba", titulo: "Verba", tipo: "moeda", valor: function (x) { return x.verba; } },
      { id: "saldo", titulo: "Saldo", tipo: "moeda", valor: function (x) { return x.saldo; }, classe: function (v) { return v < 0 ? "neg" : "pos"; }, dica: "Verba menos avaria. Negativo = a avaria já consumiu a verba." },
    ],
    totais: function () { return [{ rot: "Compradores", valor: String(linhasM.length), pri: true }, { rot: "Itens", valor: L.fInt(total) }, { rot: "Avaria", valor: L.fR2(avaria) }, { rot: "Verba", valor: L.fR2(verba) }, { rot: "Saldo", valor: L.fR2(verba - avaria) }]; },
    aoClicar: function (x, ev) { L.clique("comprador", x.k, ev); },
  });
  raiz.appendChild(L.grade(L.painel({ titulo: "Matriz por comprador", sub: "saldo é a verba do fornecedor menos a avaria · clique na linha para abrir o relatório do comprador", classe: "c-12", semPad: true, corpo: tM })));

  // ---------------- detalhe
  raiz.appendChild(L.painelTabela("Detalhe por produto", "base completa: " + L.fInt(L.C.ruptura.length) + " produtos · clique na linha para abrir o relatório do produto · Ctrl+clique filtra", L.tabelaRuptura(lin, {
    filtrosTexto: function () { return L.descricaoFiltros(); } })));
  raiz.appendChild(L.nota("Ruptura: menos de 7 dias de venda em estoque (única definição usada). Cobertura: 56 dias — acima disso o item entra como excesso. A verba vem da consulta oficial de saldo de verba, por fornecedor principal."));
}

})();
