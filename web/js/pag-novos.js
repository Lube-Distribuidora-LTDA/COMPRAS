/* =============================================================================
 * pag-novos.js — PRODUTOS NOVOS: o que foi cadastrado no WinThor nos últimos 30 dias e
 * ainda não tem foto na pasta FOTOS_ION.
 *   · a lista vem da carga do Compras (PCPRODUT.DTCADASTRO, revenda, não excluído);
 *   · a foto vem da lista da pasta FOTOS_ION que a carga do Trade lê várias vezes ao dia.
 *     Quando o arquivo da foto entra na pasta, o produto sai desta tela na próxima carga do
 *     Trade (continua visível em "Já com foto", para conferência).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "novos", grupo: "Estoque e compras", menu: "Produtos novos", icone: "estrela",
  titulo: "Produtos novos sem foto", olho: "Cadastros dos últimos 30 dias",
  filtros: ["comprador", "fornecedor", "diasCad"], mais: ["alterado", "status", "produto"],
  render: render,
});

/* Lista viva: ao abrir a tela e a cada 5 minutos com ela aberta, relê api/novos (o agente de fotos do Trade
   roda a cada 5 minutos). Só redesenha se algo mudou e se ninguém está digitando na busca. */
var RELER_MS = 5 * 60 * 1000, lendo = false;
function reler(forcar) {
  if (lendo || L.estado.pagina !== "novos" || document.hidden) return;
  if (!forcar && L.NOVOS_LIDOS_EM && Date.now() - L.NOVOS_LIDOS_EM < 60 * 1000) return;
  lendo = true;
  L.atualizarNovos().then(function (mudou) {
    lendo = false;
    var hora = L.$("novos-lidos"); if (hora) hora.textContent = textoLeitura();
    if (!mudou || L.estado.pagina !== "novos") return;
    if (mudou.ganharam) L.toast(mudou.ganharam === 1 ? "1 produto ganhou foto e saiu da lista" : mudou.ganharam + " produtos ganharam foto e saíram da lista", "ok");
    var foco = document.activeElement;
    if (foco && /INPUT|TEXTAREA/.test(foco.tagName) && L.$("conteudo").contains(foco)) { L.NOVOS_LIDOS_EM = 0; return; }   // tenta de novo na próxima volta
    L.emitir("filtros");
  });
}
setInterval(function () { reler(true); }, RELER_MS);
document.addEventListener("visibilitychange", function () { if (!document.hidden) reler(false); });
function textoLeitura() {
  var p = [];
  if (L.FOTOS_EM) p.push("pasta de fotos lida às " + L.fDataHora(L.FOTOS_EM).slice(-5));
  if (L.NOVOS_LIDOS_EM) p.push("conferido aqui às " + new Date(L.NOVOS_LIDOS_EM).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  return p.length ? p.join(" · ") + " · atualiza sozinho a cada 5 minutos" : "atualiza sozinho a cada 5 minutos";
}

var MOSTRAR = [["pend", "Sem foto (pendentes)"], ["foto", "Já com foto"], ["todos", "Todos os cadastrados"]];
function mostrar(valor) { return function (f, opt) { L.defOpt(opt, "novos", "mostrar", valor); }; }
function junto(a, b) { return function (f, opt) { a(f, opt); if (b) b(f, opt); }; }

function render(raiz) {
  var modo = L.opt("novos", "mostrar", "pend");
  var base = L.linhas("novos");
  var pend = base.filter(function (r) { return !r.foto; }), comFoto = base.filter(function (r) { return r.foto; });
  var lin = modo === "foto" ? comFoto : modo === "todos" ? base : pend;
  var atrasados = pend.filter(function (r) { return r.dias > 7; });
  var maisAntigo = pend.reduce(function (m, r) { return !m || r.dias > m.dias ? r : m; }, null);
  var alterados = pend.filter(function (r) { return r.alterado; });
  var ordDias = ["dias", -1];

  setTimeout(function () { reler(false); }, 0);
  var bv = L.barraVisao("Mostrar", L.segOpt("novos", "mostrar", MOSTRAR, "pend"));
  bv.appendChild(L.h("span", { id: "novos-lidos", class: "novos-lidos", text: textoLeitura() }));
  raiz.appendChild(bv);
  raiz.appendChild(L.kpis(
    L.kpiIr({ icone: "imagem", rot: "Sem foto", valor: pend.length, fmt: L.fInt, classe: "heroi", leg: L.h("span", { text: "saem daqui quando a foto entra na pasta FOTOS_ION" }), ir: [mostrar("pend"), { ordem: ordDias }] }),
    L.kpiIr({ icone: "estrela", rot: "Cadastrados em 30 dias", valor: base.length, fmt: L.fInt, leg: L.h("span", { text: "produtos de revenda novos no WinThor" }), ir: [mostrar("todos"), { ordem: ["cad", -1] }] }),
    L.kpiIr({ icone: "verificar", rot: "Já com foto", valor: comFoto.length, fmt: L.fInt, classe: comFoto.length ? "ok" : "zero", leg: L.h("span", { text: L.fPct(L.pct(comFoto.length, base.length), 0) + " dos cadastrados" }), ir: [mostrar("foto"), { ordem: ["fotoEm", -1] }] }),
    L.kpiIr({ icone: "alerta", rot: "Sem foto há mais de 7 dias", valor: atrasados.length, fmt: L.fInt, classe: atrasados.length ? "perigo" : "zero", leg: L.h("span", { text: "cadastrados há mais de uma semana" }), ir: [junto(mostrar("pend"), function (f) { f.diasCad = [1, 2]; }), { ordem: ordDias }] }),
    L.kpiIr({ icone: "relogio", rot: "Mais antigo sem foto", valor: maisAntigo ? maisAntigo.dias : null, fmt: function (v) { return v == null ? "—" : L.fInt(v) + (v === 1 ? " dia" : " dias"); }, classe: maisAntigo && maisAntigo.dias > 7 ? "atencao" : "zero", leg: L.h("span", { text: maisAntigo ? L.titulo(maisAntigo.desc) : "nenhum pendente" }), ir: [mostrar("pend"), { ordem: ordDias }] }),
    L.kpiIr({ icone: "prancheta", rot: "Pendentes já alterados", valor: alterados.length, fmt: L.fInt, classe: alterados.length ? "atencao" : "zero", leg: L.h("span", { text: "cadastro mexido depois do dia do cadastro" }), ir: [junto(mostrar("pend"), function (f) { f.alterado = [1]; }), { ordem: ["alt", -1] }] })));

  if (!base.length) { raiz.appendChild(L.estadoVazio("Nenhum produto novo", "Nenhum produto de revenda foi cadastrado nos últimos 30 dias com os filtros atuais.")); notaRodape(raiz); return; }

  var C = L.cores();
  // ---------------- cadastros por dia (empilhado: sem foto x com foto)
  var dias = [], porDia = {};
  for (var i = 30; i >= 0; i--) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); var iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); dias.push(iso); porDia[iso] = { sem: 0, com: 0 }; }
  base.forEach(function (r) { var x = porDia[r.cadastro]; if (x) { if (r.foto) x.com++; else x.sem++; } });
  var pDia = L.painel({ titulo: "Cadastros por dia", sub: "produtos cadastrados em cada dia, separados pela foto · clique na coluna para ver os produtos do dia", classe: "c-12" }), bDia = L.h("div");
  pDia.corpo.appendChild(bDia);
  var irDia = function (c, s) { L.irTabela(mostrar(s === 1 ? "foto" : s === 0 ? "pend" : "todos"), { ordem: ["desc", 1], busca: L.fData(dias[c]) }); };
  L.graf.colunas(bDia, { categorias: dias.map(function (x) { return { rot: x.slice(8, 10) + "/" + x.slice(5, 7) }; }), altura: 220, modo: "empilhado", fmt: L.fInt,
    series: [{ nome: "Sem foto", valores: dias.map(function (x) { return porDia[x].sem; }), cor: C.perigo }, { nome: "Com foto", valores: dias.map(function (x) { return porDia[x].com; }), cor: C.ok }],
    dica: function (c) { var x = porDia[dias[c]]; return { titulo: L.fData(dias[c]), linhas: [{ rot: "Sem foto", val: L.fInt(x.sem), cor: C.perigo }, { rot: "Com foto", val: L.fInt(x.com), cor: C.ok }, { rot: "Cadastrados", val: L.fInt(x.sem + x.com) }] }; },
    aoClicar: function (c, s) { irDia(c, s); } });
  pDia.corpo.appendChild(L.graf.legenda([{ rot: "Sem foto", cor: C.perigo }, { rot: "Com foto", cor: C.ok }]));
  raiz.appendChild(L.grade(pDia));

  // ---------------- pendentes por comprador e por fornecedor (clique filtra a planilha)
  function ranking(dim, titulo, sub) {
    var p = L.painel({ titulo: titulo, sub: sub, classe: "c-6" });
    var grupos = L.agrupar(pend, dim, function () {}).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
    L.rankingDim(p.corpo, dim, grupos.map(function (g) { return { k: g.k, valor: g.n }; }), {
      fmt: L.fInt, total: pend.length, rotulo: "Sem foto", vazio: "Nenhum produto novo sem foto com os filtros atuais.",
      cor: function (i) { return i === 0 ? C.perigo : C.d[0]; },
      aoClicar: function (x) { L.irTabela(junto(mostrar("pend"), function (f) { f[dim] = [x.k]; }), { ordem: ordDias }); } });
    return p;
  }
  raiz.appendChild(L.grade(
    ranking("comprador", "Sem foto por comprador", "clique para ver os produtos do comprador"),
    ranking("fornecedor", "Sem foto por fornecedor", "os 10 fornecedores com mais produtos sem foto · clique para ver os produtos")));

  // ---------------- planilha
  var rotDias = modo === "pend" ? "Dias sem foto" : "Dias desde o cadastro";
  var t = L.tabela({
    titulo: "Produtos novos", arquivo: "compras-produtos-novos", aba: "Produtos novos", porPagina: 25,
    linhas: lin, ordem: L.ordemTabela({ id: "dias", desc: true }), buscaInicial: L.buscaTabela(),
    buscaDica: "Buscar por código, nome, fornecedor, quem cadastrou ou data (dd/mm/aaaa)…",
    buscaTexto: function (r) { return r.codprod + " " + r.desc + " " + L.nomeFornec(r.forn) + " " + r.por + " " + L.fData(r.cadastro); },
    colunas: [
      { id: "desc", titulo: "Descrição", tipo: "texto", valor: function (r) { return r.desc; } },
      { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (r) { return r.codprod; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "emb", titulo: "Embalagem", tipo: "texto", valor: function (r) { return r.emb; }, essencial: false },
      { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (r) { return L.nomeFornec(r.forn); } },
      { id: "comp", titulo: "Comprador", tipo: "texto", valor: function (r) { return L.nomeComprador(r.comp); } },
      { id: "por", titulo: "Cadastrado por", tipo: "texto", valor: function (r) { return r.por ? L.titulo(r.por) : "—"; }, essencial: false },
      { id: "cad", titulo: "Cadastro", tipo: "texto", valor: function (r) { return r.cadastro || ""; }, fmt: function (v) { return L.fData(v); }, exp: function (r) { return L.fData(r.cadastro); } },
      { id: "alt", titulo: "Última alteração", tipo: "texto", valor: function (r) { return r.alteracao || ""; }, fmt: function (v) { return v ? L.fDataHora(v) : "—"; }, exp: function (r) { return r.alteracao ? L.fDataHora(r.alteracao) : ""; } },
      { id: "foto", titulo: "Foto", tipo: "tag", valor: function (r) { return r.foto ? "Na pasta" : "Sem foto"; }, fmt: function (v, r) { return { html: r.foto ? L.tag("Na pasta", "ok") : L.tag("Sem foto", "perigo") }; }, ordVal: function (r) { return r.foto ? 1 : 0; } },
      { id: "fotoEm", titulo: "Foto salva em", tipo: "texto", valor: function (r) { return r.fotoEm || ""; }, fmt: function (v) { return v ? L.fDataHora(v) : "—"; }, exp: function (r) { return r.fotoEm ? L.fDataHora(r.fotoEm) : ""; }, essencial: modo !== "pend" },
      { id: "dias", titulo: rotDias, tipo: "inteiro", valor: function (r) { return r.dias; }, somar: false, classe: function (v, r) { return !r.foto && v > 7 ? "neg" : ""; }, dica: "Dias de calendário desde o cadastro no WinThor" },
    ],
    totais: function (res) {
      var l = res.todas || res.linhas, sem = 0; l.forEach(function (r) { if (!r.foto) sem++; });
      return [{ rot: "Produtos", valor: L.fInt(l.length), pri: true }, { rot: "Sem foto", valor: L.fInt(sem) }, { rot: "Com foto", valor: L.fInt(l.length - sem) }];
    },
    foto: function (r) { return r.codprod; }, fotoColuna: "desc",
    aoClicar: function (r, ev) { L.clique("produto", r.codprod, ev); },
    vazio: modo === "pend" ? "Nenhum produto novo sem foto: todos os cadastros dos últimos 30 dias já têm foto na pasta FOTOS_ION." : "Nenhum produto com os filtros atuais.",
    filtrosTexto: function () { return L.descricaoFiltros([["Mostrar", MOSTRAR.filter(function (o) { return o[0] === modo; })[0][1]]]); },
  });
  raiz.appendChild(L.painelTabela(modo === "pend" ? "Produtos novos sem foto" : modo === "foto" ? "Produtos novos que já têm foto" : "Todos os produtos novos",
    "cadastrados nos últimos 30 dias: " + L.fInt(L.C.novos.length) + " produtos · clique na linha para abrir o relatório do produto", t));
  notaRodape(raiz);
}

function notaRodape(raiz) {
  raiz.appendChild(L.nota("Produtos de revenda cadastrados no WinThor nos últimos 30 dias (data de cadastro do produto); a lista de cadastros vem com as cargas do Compras (07:50, 11:50, 17:50 e 23:50)" +
    (L.CADASTROS_EM ? ", a última às " + L.fDataHora(L.CADASTROS_EM) : "") + ". A foto é conferida pelo nome do arquivo na pasta FOTOS_ION (código do produto) pelo agente de fotos do Trade, que lê a pasta a cada 5 minutos das 6h às 20h" +
    (L.FOTOS_EM ? " — última leitura: " + L.fDataHora(L.FOTOS_EM) : "") + ". Esta tela confere de novo a cada 5 minutos enquanto está aberta: quando a foto entra na pasta, o produto sai da lista de pendentes sozinho."));
}

})();
