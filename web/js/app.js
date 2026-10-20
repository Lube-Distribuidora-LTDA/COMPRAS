/* =============================================================================
 * app.js — inicialização, menu, rotas, link da visão, busca global, tema, modo apresentação,
 * o botão Atualizar e o assistente.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var tokRender = 0;

/* ------------------------------ horário da próxima carga ------------------------------ */
/* Horários em que o dado fica pronto, de Brasília. As tarefas da VM disparam 10 minutos antes
   (07:50, 11:50, 17:50 e 23:50) — conferido em compras.controle_carga. Se o agendamento mudar,
   esta lista precisa acompanhar. */
L.proximaCarga = function () {
  var HORAS = [0, 8, 12, 18];
  var partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date());
  var m = {}; partes.forEach(function (p) { m[p.type] = p.value; });
  var agora = (+m.hour % 24) * 60 + (+m.minute), alvo, amanha = false;
  for (var i = 0; i < HORAS.length; i++) { if (HORAS[i] * 60 > agora) { alvo = HORAS[i]; break; } }
  if (alvo === undefined) { alvo = HORAS[0]; amanha = true; }
  return (amanha ? "amanhã " : "hoje ") + String(alvo).padStart(2, "0") + ":00";
};

/* ------------------------------ hash (link da visão) ------------------------------ */
function estadoHash() {
  var o = { f: L.estado.filtros };
  if (Object.keys(L.estado.opt).length) o.o = L.estado.opt;
  return "#/" + L.estado.pagina + "?e=" + encodeURIComponent(JSON.stringify(o));
}
L.sincronizarHash = L.debounce(function () { try { history.replaceState(null, "", estadoHash()); } catch (e) {} }, 150);
function lerHash() {
  var m = /^#\/([\w-]+)(?:\?e=(.*))?$/.exec(location.hash || ""), out = { pagina: null, e: null };
  if (!m) return out;
  out.pagina = m[1];
  try { if (m[2]) out.e = JSON.parse(decodeURIComponent(m[2])); } catch (e) {}
  return out;
}

/* ------------------------------ menu ------------------------------ */
function construirMenu() {
  var nav = L.limpar(L.$("menu-itens")), grupos = [], vistos = {};
  L.ordemPaginas.forEach(function (id) { var g = L.paginas[id].grupo; if (!vistos[g]) { vistos[g] = 1; grupos.push(g); } });
  grupos.forEach(function (g) {
    nav.appendChild(L.h("div", { class: "grupo-menu", text: g }));
    L.ordemPaginas.filter(function (id) { return L.paginas[id].grupo === g; }).forEach(function (id) {
      var p = L.paginas[id];
      nav.appendChild(L.h("button", { class: "item-menu", type: "button", "data-p": id, html: L.ic(p.icone) + "<span>" + L.esc(p.menu || p.titulo) + "</span>",
        onclick: function () { L.estado.voltar = null; L.estado.rolarPara = null; L.irPara(id); document.body.classList.remove("menu-aberto"); } }));
    });
  });
  rodape();
}
function rodape() {
  var M = L.META, c = M.cargas || {};
  var tit = [];
  if (c.estoque) tit.push("Estoque, verba e sugestões: " + L.fDataHora(c.estoque));
  if (c.faturamento) tit.push("Faturamento: " + L.fDataHora(c.faturamento));
  var o = L.ORIGEM === "copia" ? " · cópia deste computador, conferindo…" : L.ORIGEM === "copia-ok" ? " · cópia deste computador (a mais recente)" : L.ORIGEM === "offline" ? " · <b>sem conexão</b>" : "";
  L.$("menu-rodape").innerHTML =
    '<div title="' + L.esc(tit.join("\n")) + '"><span class="vivo"></span>Última carga <b>' + L.esc(L.fDataHora(M.geradoEm)) + "</b></div>" +
    "<div>Próxima carga <b>" + L.esc(L.proximaCarga()) + "</b>" + (L.NOVA_CARGA ? " · <b>há carga nova: clique em Atualizar</b>" : o) + "</div>" +
    "<div>" + L.fInt(L.PM.size) + " produtos · " + L.fInt(L.C.verba.length) + " fornecedores com verba</div>" +
    '<div class="versao">versão ' + L.esc(window.VERSAO || "") + "</div>";
}
function marcarMenu() { document.querySelectorAll(".item-menu").forEach(function (b) { b.classList.toggle("ativo", b.dataset.p === L.estado.pagina); }); }

/* ------------------------------ rotas e renderização ------------------------------ */
L.irPara = function (id) {
  if (!L.paginas[id]) return;
  var mudou = L.estado.pagina !== id;
  L.estado.pagina = id;
  try { localStorage.setItem("compras-aba", id); } catch (e) {}
  if (L.dossieAberto && L.dossieAberto()) L.fecharDossie();
  L.construirFiltros(); marcarMenu();
  L.sincronizarHash();
  renderizar();
  if (!L.estado.rolarPara && L.estado.rolarY == null) window.scrollTo({ top: 0 });
  void mudou;
};
function rolarDepois() {
  var alvo = L.estado.rolarPara, y = L.estado.rolarY;
  L.estado.rolarPara = null; L.estado.rolarY = null;
  if (alvo) {
    var el = L.$(alvo); if (!el) return;
    var cab = L.$("topo"), fx = L.$("faixa-filtros");
    var desloc = (cab ? cab.offsetHeight : 0) + (fx ? fx.offsetHeight : 0) + 14;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - desloc), behavior: "smooth" });
    el.classList.remove("piscar"); void el.offsetWidth; el.classList.add("piscar");
  } else if (y != null) {
    window.scrollTo({ top: y });
  }
}
function renderizar() {
  if (!L.C) return;
  var pag = L.paginaAtual(), tok = ++tokRender, cont = L.$("conteudo");
  L.$("titulo").textContent = pag.titulo; L.$("olho").textContent = pag.olho || "";
  document.title = pag.menu + " — Central Compras · Lube";
  L.fila.length = 0;
  var raiz = L.h("div", { class: "pagina" });
  // a tela é montada fora do documento e entra de uma vez (o cálculo leva milissegundos)
  setTimeout(function () {
    if (tok !== tokRender) return;
    try {
      pag.render(raiz);
      L.limpar(cont); cont.appendChild(raiz);
      L.executarFila();
      L.atualizarFaixa();
      rolarDepois();
    } catch (e) {
      console.error(e);
      L.limpar(cont); cont.appendChild(L.erroTela("Não foi possível montar esta tela", (e && e.message) || String(e)));
    }
  }, 0);
}
L.ouvir("filtros", function () { L.atualizarFaixa(); renderizar(); });

/* ------------------------------ busca global ------------------------------ */
function iniciarBusca() {
  var inp = L.$("busca-global"), box = L.$("busca-box"), pop = null;
  var tipos = [["produto", "Produtos"], ["fornecedor", "Fornecedores"], ["comprador", "Compradores"], ["depto", "Departamentos"], ["secao", "Seções"]];
  function fechar() { if (pop) { pop.remove(); pop = null; } }
  function buscar() {
    var q = L.norm(inp.value).split(/\s+/).filter(Boolean);
    fechar();
    if (!q.length) return;
    var grupos = [];
    tipos.forEach(function (t) {
      var itens = L.DIM[t[0]].itens(), achou = [];
      for (var i = 0; i < itens.length && achou.length < 6; i++) { var n = itens[i].n; if (q.every(function (x) { return n.indexOf(x) >= 0; })) achou.push(itens[i]); }
      if (achou.length) grupos.push([t, achou]);
    });
    pop = L.h("div", { class: "pop", style: { width: "440px", maxHeight: "72vh" } });
    var lista = L.h("div", { class: "pop-lista" }), primeiro = null;
    if (!grupos.length) lista.appendChild(L.h("div", { class: "pop-vazio", text: "Nada encontrado para “" + inp.value + "”" }));
    grupos.forEach(function (g) {
      lista.appendChild(L.h("div", { class: "grupo-menu", style: { padding: "10px 10px 4px" }, text: g[0][1] }));
      g[1].forEach(function (x) {
        var tx = L.h("span", { class: "tx", title: x.t }); tx.innerHTML = L.destacar(x.t, q);
        var b = L.h("button", { class: "pop-item", type: "button", onclick: function () {
          fechar(); inp.value = ""; inp.blur();
          L.abrirDossie({ dim: g[0][0], id: x.id });
        } }, tx, x.s ? L.h("span", { class: "cn", text: x.s.length > 26 ? x.s.slice(0, 25) + "…" : x.s }) : null);
        if (!primeiro) primeiro = b;
        lista.appendChild(b);
      });
    });
    pop.appendChild(lista); pop._primeiro = primeiro;
    var r = box.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - 448, r.left)) + "px"; pop.style.top = (r.bottom + 6) + "px";
    document.body.appendChild(pop);
  }
  inp.addEventListener("input", L.debounce(buscar, 120));
  inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && pop && pop._primeiro) pop._primeiro.click(); if (ev.key === "Escape") { fechar(); inp.value = ""; inp.blur(); } });
  document.addEventListener("mousedown", function (ev) { if (pop && !pop.contains(ev.target) && !box.contains(ev.target)) fechar(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { ev.preventDefault(); inp.focus(); } });
}

/* ------------------------------ tema, apresentação, link, atualizar ------------------------------ */
function aplicarTema(t) {
  document.documentElement.setAttribute("data-tema", t);
  try { localStorage.setItem("compras-tema", t); } catch (e) {}
  L.estado.tema = t;
  L.$("btn-tema").innerHTML = L.ic(t === "escuro" ? "sol" : "lua");
  setTimeout(L.redesenharTudo, 30);
}
function apresentar(on) {
  L.estado.apresentando = on;
  document.body.classList.toggle("apresentando", on);
  if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(function () {});
  setTimeout(L.redesenharTudo, 120);
}
function navegarPaginas(d) { var i = L.ordemPaginas.indexOf(L.estado.pagina) + d; if (i >= 0 && i < L.ordemPaginas.length) L.irPara(L.ordemPaginas[i]); }
L.ouvir("origem", function () { rodape(); L.$("btn-atualizar").classList.toggle("novo", !!L.NOVA_CARGA); });
/* O "Atualizar" faz uma coisa de cada vez: se a carga nova já foi baixada por trás, abre ela; se não, vai direto no
   banco (?atualizar=), ignorando o cache do navegador e da borda da Vercel. */
function atualizarDados() {
  var b = L.$("btn-atualizar"); b.classList.add("girando");
  if (L.NOVA_CARGA) { L.toast("Abrindo a carga das " + L.fDataHora(L.NOVA_CARGA.gerado_em) + "…", "ok"); setTimeout(function () { location.reload(); }, 400); return; }
  L.toast("Buscando a carga mais recente no banco…", "ok");
  setTimeout(function () { location.href = location.pathname + "?atualizar=" + Date.now() + (location.hash || ""); }, 300);
}

/* ------------------------------ assistente (Claude + relatórios em Excel) ------------------------------ */
/* Entrega ao agente os mesmos dados que as telas usam, com o nome do comprador e do fornecedor já resolvidos —
   o modelo raciocina sobre "JULIO CESAR", não sobre o código 799. Monta só quando alguém pergunta algo. */
function iniciarAgente() {
  if (!window.Agente) return;
  window.Agente.iniciar({
    montarConjuntos: function () {
      var F = L.C;
      function pessoa(c) { var n = L.nomeComprador(c); return n === "—" ? null : n; }
      function forn(c) { var n = L.nomeFornec(c); return n === "—" ? null : n; }
      return {
        ruptura: F.ruptura.map(function (r) { return { codprod: r.codprod, desc: r.desc, comprador: pessoa(r.comp), fornecedor: forn(r.forn), ativo: r.ativo, estCx: r.estCx, giroCx: r.giroCx, dias: r.dias, ruptura: r.ruptura, cobertura: r.cobertura, avaria: r.avaria }; }),
        estoque_venda: F.ev.map(function (r) { return { codprod: r.codprod, desc: r.desc, comprador: pessoa(r.comp), fornecedor: forn(r.forn), disp: r.disp, preco: r.preco, pendente: r.pendente, vendaTot: r.vendaTot, media: r.media, cob: r.cob, sug: r.sug, valorSug: r.valorSug }; }),
        verba: F.verba.map(function (v) { return { cod: v.cod, nome: v.nome, comprador: pessoa(v.comp), verba: v.verba, entrada: v.entrada, saida: v.saida, vencidas: v.vencidas, avencer: v.avencer, avaria: v.avaria, itens: v.itens, saldo: v.saldo }; }),
        sugestao_fornecedor: F.sugf.map(function (f) { return { cod: f.cod, nome: f.nome, comprador: pessoa(f.comp), giro: f.giro, disp: f.disp, sug: f.sug, valor: f.valor }; }),
        excesso: F.excesso.map(function (e) { return { codprod: e.codprod, desc: e.desc, comprador: pessoa(e.comp), fornecedor: forn(e.forn), giro: e.giro, disp: e.disp, sug: e.sug, preco: e.preco, valor: e.valor }; }),
        avaria_produto: F.avp.map(function (a) { return { codprod: a.codprod, desc: a.desc, comprador: pessoa(a.comp), fornecedor: forn(a.forn), valor: a.valor }; }),
        sugestao_produto: F.sugp.map(function (p) { return { filial: p.filial, codprod: p.codprod, desc: p.desc, comprador: pessoa(p.comp), fornecedor: forn(p.forn), volume: p.volume, giro: p.giro, disp: p.disp, sug: p.sug, preco: p.preco, valor: p.valor }; }),
        faturamento_mes: F.fatMes.map(function (m) { return { mes: m.mes, venda: m.venda, cmv: m.cmv, lucro: m.lucro, pedidos: m.pedidos, posit: m.posit, margem: m.margem }; }),
        faturamento_comprador: F.fatComp.map(function (c) { return { comprador: pessoa(c.comp), venda: c.venda, lucro: c.lucro, pedidos: c.pedidos, posit: c.posit, v12: c.v12, l12: c.l12, margem: c.margem, margem12: c.margem12 }; }),
        faturamento_fornecedor: F.fatForn.map(function (f) { return { fornecedor: forn(f.cod), venda: f.venda, lucro: f.lucro, v12: f.v12 }; }),
        faturamento_departamento: F.fatDepto.map(function (d) { return { nome: d.nome, venda: d.venda, lucro: d.lucro, v12: d.v12 }; }),
        faturamento_secao: F.fatSec.map(function (s) { return { nome: s.nome, venda: s.venda, lucro: s.lucro }; }),
        faturamento_estado: F.fatUf.map(function (u) { return { uf: u.uf, venda: u.venda, lucro: u.lucro }; }),
        faturamento_supervisor: F.fatSup.map(function (s) { return { nome: s.nome, venda: s.venda, lucro: s.lucro, v12: s.v12 }; }),
      };
    },
  });
}

/* ------------------------------ início ------------------------------ */
function iniciar() {
  L.$("ic-busca").innerHTML = L.ic("busca");
  L.$("btn-menu").innerHTML = L.ic("menu");
  L.$("btn-apresentar").innerHTML = L.ic("maximizar");
  L.$("btn-link").innerHTML = L.ic("link");
  L.$("btn-atualizar").innerHTML = L.ic("relogio");
  aplicarTema(document.documentElement.getAttribute("data-tema") || "escuro");
  L.$("btn-tema").addEventListener("click", function () { aplicarTema(L.estado.tema === "escuro" ? "claro" : "escuro"); });
  L.$("btn-menu").addEventListener("click", function () { document.body.classList.toggle("menu-aberto"); });
  L.$("btn-apresentar").addEventListener("click", function () { apresentar(!L.estado.apresentando); });
  L.$("btn-link").addEventListener("click", function () {
    var url = location.href.split("#")[0] + estadoHash();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { L.toast("Link desta visão copiado (filtros juntos)", "ok"); }, function () { L.toast("Não foi possível copiar o link", "erro"); });
  });
  L.$("btn-atualizar").addEventListener("click", atualizarDados);
  document.addEventListener("keydown", function (ev) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if ((ev.key === "f" || ev.key === "F") && !ev.ctrlKey && !ev.metaKey) { if (!L.dossieAberto()) apresentar(!L.estado.apresentando); }
    if (L.estado.apresentando && !L.dossieAberto()) { if (ev.key === "ArrowRight") navegarPaginas(1); if (ev.key === "ArrowLeft") navegarPaginas(-1); }
  });
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && L.estado.apresentando) { L.estado.apresentando = false; document.body.classList.remove("apresentando"); setTimeout(L.redesenharTudo, 120); } });
  setInterval(function () { if (L.C) rodape(); }, 60000);

  var cont = L.$("conteudo"), espera = L.espera("Lendo o DATA WAREHOUSE…");
  L.limpar(cont).appendChild(espera);
  var aviso = function (t) { var x = espera.querySelector(".espera-txt div"); if (x) x.textContent = t; };
  L.carregarTudo(aviso).then(function () {
    construirMenu(); iniciarBusca();
    var h = lerHash(), salva = null;
    try { salva = localStorage.getItem("compras-aba"); } catch (e) {}
    L.estado.pagina = h.pagina && L.paginas[h.pagina] ? h.pagina : (salva && L.paginas[salva] ? salva : L.ordemPaginas[0]);
    if (h.e) { L.estado.filtros = h.e.f || {}; L.estado.opt = h.e.o || {}; }
    L.construirFiltros(); marcarMenu();
    renderizar();
    iniciarAgente();
  }).catch(function (e) {
    console.error(e);
    L.limpar(cont).appendChild(L.erroTela("Não foi possível carregar os dados", ((e && e.message) || String(e)) + " · Se isto acabou de ser publicado, confira as variáveis de ambiente do projeto na Vercel."));
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
