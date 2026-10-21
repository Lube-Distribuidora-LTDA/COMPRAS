/* =============================================================================
 * comum.js — peças que as telas dividem: formatos, as escolhas de cada tela, o "clique que
 * leva à planilha já filtrada" (com Voltar), o clique que abre o relatório e as etiquetas.
 *
 * Duas formas de clique, como nos outros painéis da Lube:
 *   · número, rosca ou barra de SITUAÇÃO (ruptura, excesso, verba vencida...) → aplica o filtro
 *     correspondente e leva à planilha da tela (ou a outra tela), com "Voltar";
 *   · barra, ponto ou linha de uma PESSOA/COISA (comprador, fornecedor, produto, mês, departamento)
 *     → abre o relatório dela (Ctrl+clique aplica como filtro).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ formatos ------------------------------ */
L.fR = function (v) { return L.fBRL(v, 0); };
L.fR2 = function (v) { return L.fBRL(v, 2); };
L.fRc = function (v) { return L.fAbrev(v, true); };
L.fQ = function (v) { return v == null || isNaN(v) ? "—" : L.fNum(v, Math.abs(v % 1) > 0.0005 ? (Math.abs(v) < 10 ? 2 : 1) : 0); };
L.fDias = function (v) { return v == null || isNaN(v) ? "—" : L.fNum(v, 1); };
L.pct = function (a, b) { return b ? a / b : null; };

/* ------------------------------ escolhas de cada tela ------------------------------ */
/* L.opt("estoque", "visao", "produto") → valor atual (cada tela guarda as suas) */
L.opt = function (pagina, chave, padrao) {
  var o = L.estado.opt[pagina];
  return o && o[chave] != null ? o[chave] : padrao;
};
L.setOpt = function (pagina, chave, valor) {
  (L.estado.opt[pagina] = L.estado.opt[pagina] || {})[chave] = valor;
  L.sincronizarHash && L.sincronizarHash();
  L.emitir("filtros");
};

/* ordem inicial da tabela: a que o clique pediu (uma vez só) ou a padrão da tela */
L.ordemTabela = function (padrao) {
  var o = L.estado.ordem; L.estado.ordem = null;
  return o ? { id: o[0], desc: o[1] !== 1 } : padrao;
};

/* texto que o clique pediu na busca da tabela (uma vez só): usado onde o item não tem filtro próprio */
L.buscaTabela = function () { var b = L.estado.busca; L.estado.busca = null; return b || ""; };

/* ------------------------------ planilha já filtrada, com Voltar ------------------------------ */
function copiar(o) { return JSON.parse(JSON.stringify(o || {})); }
L.fotoDaTela = function () { return { pagina: L.estado.pagina, filtros: copiar(L.estado.filtros), opt: copiar(L.estado.opt), y: window.pageYOffset }; };

/* mudar(filtros, opt) altera só o que foi clicado; o resto fica como estava.
   o = { pagina: outra tela como destino, ordem: [coluna, 1 crescente | -1 decrescente] }
   Outra tela parte do padrão dela, mas leva o comprador (e o fornecedor, se a tela souber usá-lo). */
L.irTabela = function (mudar, o) {
  o = o || {};
  var antes = L.fotoDaTela(), destino = o.pagina || L.estado.pagina;
  if (destino !== L.estado.pagina) {
    var f = L.estado.filtros, novo = {};
    var aplic = L.dimsDaPagina(L.paginas[destino]);
    ["comprador", "fornecedor"].forEach(function (k) { if (f[k] && aplic.indexOf(k) >= 0) novo[k] = f[k].slice(); });
    L.estado.filtros = novo;
  }
  if (mudar) mudar(L.estado.filtros, L.estado.opt);
  L.estado.voltar = antes;
  L.estado.ordem = o.ordem || null;
  L.estado.busca = o.busca || null;
  L.estado.rolarPara = "tabela-principal";
  L.dica.esconder();
  if (destino !== L.estado.pagina) L.irPara(destino); else { L.sincronizarHash(); L.atualizarFaixa(); L.emitir("filtros"); }
};
L.voltar = function () {
  var v = L.estado.voltar; if (!v) return;
  L.estado.voltar = null;
  L.estado.filtros = copiar(v.filtros); L.estado.opt = copiar(v.opt);
  L.estado.rolarY = v.y; L.estado.rolarPara = null; L.estado.ordem = null; L.estado.busca = null;
  L.dica.esconder();
  if (v.pagina !== L.estado.pagina) L.irPara(v.pagina); else { L.sincronizarHash(); L.atualizarFaixa(); L.emitir("filtros"); }
};
/* atalhos para o mudar() mais comum */
L.so = function (f, dim, id) { f[dim] = [+id]; };

/* ------------------------------ clique que abre o relatório ------------------------------ */
/* abre o relatório do item; Ctrl+clique aplica como filtro (se a tela tem esse filtro) */
L.clique = function (dim, id, ev, extra) {
  var filtraveis = L.dimsDaPagina();
  if (ev && (ev.ctrlKey || ev.metaKey) && L.DIM[dim] && filtraveis.indexOf(dim) >= 0) { L.alternarFiltro(dim, id); L.toast("Filtro: " + L.nomeDe(dim, id)); return; }
  L.abrirDossie(Object.assign({ dim: dim, id: id }, extra || {}), !!(L.dossieAberto && L.dossieAberto()));
};

/* ------------------------------ etiquetas e cartões ------------------------------ */
L.tagSimNao = function (v, tipoSim) { return v ? L.tag("Sim", tipoSim || "perigo") : L.tag("Não", "neutro"); };
L.tagAtivo = function (ativo) { return ativo ? L.tag("Ativo", "ok") : L.tag("Fora de linha", "perigo"); };
L.tagCob = function (dentro) { return dentro ? L.tag("Dentro da meta", "neutro") : L.tag("Excesso", "atencao"); };
L.tagSaldo = function (v) { return v < 0 ? L.tag("Negativo", "perigo") : L.tag("Positivo", "ok"); };
L.corSaldo = function (v) { return v < 0 ? L.cssVar("--perigo") : L.cssVar("--ok"); };

/* cartão de KPI que, ao clique, leva à planilha: k({ ..., ir: [mudar, opções] }) */
L.kpiIr = function (cfg) {
  if (cfg.ir) { var ir = cfg.ir; cfg.aoClicar = function () { L.irTabela(ir[0], ir[1]); }; if (!cfg.ajuda) cfg.ajuda = "Clique para ver na planilha, já filtrado"; }
  return L.kpi(cfg);
};

/* dica (tooltip) de uma linha de ranking: título + linhas + clique */
L.dicaLinhas = function (titulo, linhas, extra) { return { titulo: titulo, linhas: linhas, extra: extra ? '<div class="dica-sub">' + L.esc(extra) + "</div>" : "" }; };

/* barras de ranking por uma dimensão (comprador, fornecedor, produto...): clique abre o relatório */
L.rankingDim = function (corpo, dim, itens, cfg) {
  cfg = cfg || {};
  var box = L.h("div"); corpo.appendChild(box);
  if (!itens.length) { box.appendChild(L.h("div", { class: "vazio", html: "<b>Nada para mostrar</b>" + L.esc(cfg.vazio || "Nenhum item com os filtros atuais.") })); return box; }
  L.graf.barras(box, {
    itens: itens.map(function (x) { return { rot: x.rot != null ? x.rot : L.nomeDe(dim, x.k), valor: x.valor, cor: x.cor }; }),
    total: cfg.total, pct: cfg.pct, fmt: cfg.fmt || L.fRc, linhaH: cfg.linhaH || 28,
    cor: cfg.cor || function (i) { return i === 0 ? L.cores().ouro : L.cores().d[0]; },
    dica: function (i) { var x = itens[i]; return cfg.dica ? cfg.dica(x, i) : { titulo: x.rot != null ? x.rot : L.nomeDe(dim, x.k), linhas: [{ rot: cfg.rotulo || "Valor", val: (cfg.fmtCheio || cfg.fmt || L.fRc)(x.valor) }] }; },
    aoClicar: function (i, s, ev) { if (cfg.aoClicar) cfg.aoClicar(itens[i], ev); else L.clique(dim, itens[i].k, ev); },
  });
  return box;
};

/* controle segmentado de uma escolha da tela (visão, ranking, coluna): L.segOpt("sugestao","visao",[[valor,rótulo]...],padrao) */
L.segOpt = function (pagina, chave, opcoes, padrao) {
  var atual = L.opt(pagina, chave, padrao), seg = L.h("div", { class: "seg" });
  opcoes.forEach(function (o) { seg.appendChild(L.h("button", { type: "button", class: atual === o[0] ? "on" : "", text: o[1], onclick: function () { L.setOpt(pagina, chave, o[0]); } })); });
  return seg;
};
/* faixa "Visão  [Por fornecedor | Por produto]" logo abaixo dos filtros */
L.barraVisao = function (rotulo, seg) { return L.h("div", { class: "barra-visao" }, L.h("span", { class: "fx-rot", text: rotulo }), seg); };
/* mudar() que troca uma escolha da tela */
L.defOpt = function (opt, pagina, chave, valor) { (opt[pagina] = opt[pagina] || {})[chave] = valor; };

/* o painel da planilha principal da tela: é para onde os cliques em números rolam */
L.painelTabela = function (titulo, sub, tabela, acoes) {
  return L.grade(L.painel({ titulo: titulo, sub: sub, classe: "c-12", semPad: true, corpo: tabela, acoes: acoes, id: "tabela-principal" }));
};

L.estadoVazio = function (titulo, msg) { return L.h("div", { class: "vazio grande", html: "<b>" + L.esc(titulo) + "</b>" + L.esc(msg || "") }); };

})();
