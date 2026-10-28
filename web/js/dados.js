/* =============================================================================
 * dados.js — o motor do navegador do Central Compras.
 *
 * O pacote do painel (compras.painel_dados(), entregue por /api/dados) chega uma vez,
 * fica guardado no navegador (IndexedDB) e, nas visitas seguintes, a tela abre NA HORA
 * com a cópia guardada enquanto a carga mais nova é conferida por trás. Daí em diante
 * todo filtro e toda soma é feito aqui, sobre as linhas que o próprio painel já tem.
 *
 * Conjuntos (L.C.<nome>, arrays de objetos — a mesma base do painel antigo):
 *   ruptura   produtos × ruptura e cobertura (página Compras)
 *   ev        produtos × venda das 9 semanas, cobertura e sugestão (Estoque x venda)
 *   excesso   produtos com sugestão negativa em 60 dias (Excesso de estoque)
 *   sugf      sugestão por fornecedor · sugp: sugestão por produto e filial (Sugestão)
 *   verba     verba, avaria e vencimentos por fornecedor principal (Saldo verba)
 *   avp       avaria por produto
 *   fatMes / fatComp / fatForn / fatDepto / fatSec / fatUf / fatSup   faturamento do ano
 *   novos     produtos cadastrados nos últimos 30 dias, com a marca de foto na pasta FOTOS_ION
 * Todo filtro guarda CÓDIGOS (comprador, fornecedor, produto, mês...), nunca índices:
 * um link copiado continua valendo depois de uma carga nova.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* Compradores que não fazem mais parte da Lube. O ETL já para de trazê-los, mas o filtro
   também vive aqui: o efeito é imediato e o cadastro é carregado por upsert (nunca apaga).
   Produto ou fornecedor que o WinThor ainda não reatribuiu perde só o NOME do comprador
   (vira "Sem comprador ativo"); estoque, ruptura, avaria e venda seguem aparecendo.
   Medido em 2026-10-01: atinge 58 dos 7.231 produtos (0,8%). */
var EXCLUIDOS = { 621: 1, 278: 1, 376: 1, 375: 1, 277: 1, 178: 1 };

/* ------------------------------ nomes ------------------------------ */
var MIN = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, em: 1, a: 1, o: 1, para: 1, com: 1 };
function titulo(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim().split(" ").map(function (w, i) {
    if (!w) return w; if (i && MIN[w]) return w;
    if (/^(wms|nf|rca|sac|cd|ltda|me|epp|sa|s\/a|ba|rj|es|sp|mg|pr|rs|go|mei|icms|pis|st|cofins|cx|un|kg|lt|ii|iii|iv)$/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}
L.titulo = titulo;

/* ------------------------------ carga do pacote ------------------------------ */
var IDB = "compras-lube", LOJA = "pacote";
function idbAbrir() {
  return new Promise(function (ok, erro) {
    if (!window.indexedDB) return erro(new Error("sem IndexedDB"));
    var r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = function () { r.result.createObjectStore(LOJA); };
    r.onsuccess = function () { ok(r.result); }; r.onerror = function () { erro(r.error); };
  });
}
function idbLer() {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var q = db.transaction(LOJA, "readonly").objectStore(LOJA).get("atual");
    q.onsuccess = function () { ok(q.result || null); }; q.onerror = function () { ok(null); };
  }); }).catch(function () { return null; });
}
function idbGravar(obj) {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var tx = db.transaction(LOJA, "readwrite"); tx.objectStore(LOJA).put(obj, "atual");
    tx.oncomplete = function () { ok(true); }; tx.onerror = function () { ok(false); };
  }); }).catch(function () { return false; });
}
/* fotosEm entra na versão: a foto que chega na pasta FOTOS_ION (carga do Trade) tira o produto da tela
   Produtos novos mesmo sem carga nova do Compras */
function versaoDe(J) { return String(J.geradoEm || "") + "|" + String((J.cargas && J.cargas.faturamento) || "") + "|" + String(J.fotosEm || ""); }

/* baixa o pacote; o pooler do banco pode ter uma falha passageira, então tenta mais duas vezes
   antes de mostrar erro a quem está olhando */
function baixar(forcar, aoAviso, tentativas) {
  var url = forcar ? "/api/dados?atualizar=" + Date.now() : "/api/dados";
  var opc = { headers: { Accept: "application/json" } };
  if (forcar) opc.cache = "no-store";
  return fetch(url, opc).then(function (r) {
    return r.json().then(function (corpo) {
      if (r.status === 401) throw new Error("Sua sessão do Painel Lube expirou. Entre de novo pelo portal.");
      if (!r.ok) throw new Error((corpo && corpo.mensagem) || ("HTTP " + r.status));
      return corpo;
    }, function () { throw new Error("A resposta do servidor não veio em JSON (HTTP " + r.status + ")."); });
  }).catch(function (e) {
    if ((tentativas || 0) > 0) {
      if (aoAviso) aoAviso("A conexão com o banco oscilou, tentando de novo…");
      return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return baixar(forcar, aoAviso, tentativas - 1); });
    }
    throw e;
  });
}

/* Abre o painel. Com cópia guardada neste computador, a tela abre NA HORA com ela e a carga do banco é
   conferida por trás (o banco pode levar 20 s para responder; quem abre não espera por isso). Chegou
   carga nova: guarda, e o botão Atualizar acende. Sem cópia (primeira vez) ou com Atualizar, espera o banco. */
L.carregarTudo = function (aoAviso) {
  var aviso = aoAviso || function () {};
  var forcar = /[?&]atualizar=/.test(location.search);
  return (forcar ? Promise.resolve(null) : idbLer()).then(function (copia) {
    if (copia && copia.pacote && copia.versao) {
      L.ORIGEM = "copia";
      setTimeout(function () { conferirPorTras(copia.versao); }, 500);
      return preparar(copia.pacote, copia.versao);
    }
    aviso("Lendo o DATA WAREHOUSE (só na primeira vez neste computador)…");
    return baixar(forcar, aviso, 2).then(function (pac) {
      var v = versaoDe(pac); L.ORIGEM = "banco"; idbGravar({ versao: v, pacote: pac });
      return preparar(pac, v);
    });
  });
};
function conferirPorTras(versaoCopia) {
  baixar(false, null, 0).then(function (pac) {
    var v = versaoDe(pac);
    if (v === versaoCopia) { L.ORIGEM = "copia-ok"; L.emitir("origem"); return; }
    return idbGravar({ versao: v, pacote: pac }).then(function () {
      L.NOVA_CARGA = { gerado_em: pac.geradoEm }; L.emitir("origem");
      L.toast("Chegou a carga das " + L.fDataHora(pac.geradoEm) + ": clique em Atualizar (o relógio, no alto) para ver", "ok");
    });
  }).catch(function () { L.ORIGEM = "offline"; L.emitir("origem"); L.toast("Sem conexão com o servidor agora: mostrando os dados guardados neste computador", "erro"); });
}

/* Lista dos produtos que têm foto (api/fotos). Chega por trás, sem segurar a tela: enquanto não chega, as
   miniaturas tentam a foto mesmo assim e caem no quadradinho cinza se não houver. */
L.carregarFotos = function () {
  return fetch("api/fotos").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (j && Array.isArray(j.cods)) { L.FOTOS = new Set(j.cods.map(Number)); L.emitir("fotos"); }
  }).catch(function () { /* sem a lista, valem as tentativas com queda para o quadradinho */ });
};

/* ------------------------------ preparo das estruturas ------------------------------ */
function preparar(J, versao) {
  var D = L.D = J;
  L.META = { geradoEm: D.geradoEm, cargas: D.cargas || {}, versao: versao };

  // ---- compradores e fornecedores
  var COMP = L.COMP = { nomes: {}, curto: {}, lista: [] };
  Object.keys(D.compradores || {}).forEach(function (k) { if (!EXCLUIDOS[+k]) COMP.nomes[+k] = titulo(D.compradores[k]); });
  var contagem = {};
  Object.keys(COMP.nomes).forEach(function (k) { var p = COMP.nomes[k].split(" ")[0]; contagem[p] = (contagem[p] || 0) + 1; });
  Object.keys(COMP.nomes).forEach(function (k) {
    var partes = COMP.nomes[k].split(" ");
    COMP.curto[k] = contagem[partes[0]] > 1 && partes[1] ? partes[0] + " " + partes[1].charAt(0) + "." : partes[0];
    COMP.lista.push({ cod: +k, nome: COMP.nomes[k] });
  });
  COMP.lista.sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
  var FORN = L.FORN = D.fornecedores || {};
  L.nomeComprador = function (c) { return COMP.nomes[c] || "—"; };
  L.nomeCurto = function (c) { return COMP.curto[c] || "—"; };
  L.nomeFornec = function (c) { var f = FORN[c]; return f && f[0] ? titulo(f[0]) : "—"; };
  L.compAtivo = function (c) { return c != null && COMP.nomes[c] != null ? +c : -1; };

  // ---- produtos (cadastro) e conjuntos
  var PROD = {};
  (D.produtos || []).forEach(function (p) { PROD[p[0]] = { desc: p[1], comp: p[2], fornec: p[3], ativo: p[4] !== "F" }; });
  var prod = function (c) { return PROD[c] || { desc: "—", comp: null, fornec: null, ativo: true }; };
  var C = L.C = {};
  C.ruptura = (D.ruptura || []).map(function (r) {
    var p = prod(r[0]);
    return { codprod: r[0], desc: p.desc, comp: p.comp, forn: p.fornec, ativo: p.ativo, estCx: r[1], giroCx: r[2], dias: r[3], ruptura: !!r[4], cobertura: !!r[5], avaria: r[6] };
  });
  C.ev = (D.ev || []).map(function (r) {
    var p = prod(r[0]);
    return { codprod: r[0], desc: p.desc, comp: p.comp, forn: p.fornec, ativo: p.ativo, disp: r[1], avariaQt: r[2], preco: r[3], pendente: r[4],
      semanas: [r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13]], vendaTot: r[14], media: r[15], cob: r[16], sug: r[17], valorSug: (r[17] || 0) * (r[3] || 0) };
  });
  C.verba = (D.verba || []).map(function (r) {
    return { cod: r[0], forn: r[0], nome: r[1], verba: r[2], entrada: r[3], saida: r[4], vencidas: r[5], avencer: r[6], avaria: r[7], itens: r[8], comp: r[9], saldo: (r[2] || 0) - (r[7] || 0) };
  });
  C.sugf = (D.sugfornec || []).map(function (r) { return { cod: r[0], forn: r[0], nome: r[1], comp: r[2], giro: r[3], disp: r[4], sug: r[5], valor: r[6] }; });
  C.excesso = (D.excesso || []).map(function (r) {
    return { codprod: r[0], desc: r[1], forn: r[2], comp: r[3], giro: r[4], disp: r[5], sug: r[6], preco: r[7], valor: Math.abs(r[8] || 0) };
  });
  C.avp = (D.avariaprod || []).map(function (r) { return { codprod: r[0], desc: r[1], comp: r[2], forn: r[3], valor: r[4] }; });
  C.sugp = (D.sugprod || []).map(function (r) {
    return { filial: r[0], codprod: r[1], desc: r[2], comp: r[3], forn: r[4], volume: r[5], giro: r[6], disp: r[7], sug: r[8], preco: r[9], valor: r[10] };
  });
  var FAT = D.fat || {};
  C.fatMes = (FAT.mes || []).map(function (r) { return { mes: r[0], venda: r[1], cmv: r[2], lucro: r[3], pedidos: r[4], posit: r[5], margem: r[1] ? r[3] / r[1] : null }; });
  C.fatComp = (FAT.comprador || []).map(function (r) {
    return { comp: r[0], venda: r[1], lucro: r[2], pedidos: r[3], posit: r[4], v12: r[5], l12: r[6], margem: r[1] ? r[2] / r[1] : null, margem12: r[5] ? r[6] / r[5] : null };
  });
  C.fatForn = (FAT.fornec || []).map(function (r) { return { cod: r[0], forn: r[0], venda: r[1], lucro: r[2], v12: r[3] }; });
  C.fatDepto = (FAT.depto || []).map(function (r) { return { cod: r[0], nome: r[1], venda: r[2], lucro: r[3], v12: r[4] }; });
  C.fatSec = (FAT.secao || []).map(function (r) { return { cod: r[0], nome: r[1], venda: r[2], lucro: r[3] }; });
  C.fatUf = (FAT.estado || []).map(function (r) { return { uf: r[0], nome: r[0], venda: r[1], lucro: r[2] }; });
  C.fatMesComp = (FAT.mescomp || []).map(function (r) { return { mes: r[0], comp: r[1], venda: r[2], lucro: r[3] }; });
  C.fatMesDepto = (FAT.mesdepto || []).map(function (r) { return { mes: r[0], cod: r[1], venda: r[2], lucro: r[3] }; });
  C.fatSup = (FAT.superv || []).map(function (r) { return { cod: r[0], nome: r[1], venda: r[2], lucro: r[3], v12: r[4] }; });

  /* produtos cadastrados nos últimos 30 dias; foto = o arquivo já está na pasta FOTOS_ION (lista do Trade).
     Os dias contam do cadastro até hoje, em dias de calendário. */
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  var diasAte = function (iso) { if (!iso) return null; var d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); return Math.max(0, Math.round((hoje - d) / 864e5)); };
  L.FOTOS_EM = D.fotosEm || null;
  C.novos = (D.novos || []).map(function (r) {
    return { codprod: r[0], desc: r[1], emb: r[2] || "", forn: r[3], comp: r[4], cadastro: r[5], alteracao: r[6], por: r[7] || "", ativo: r[8] !== "F",
      foto: !!r[9], fotoEm: r[10], dias: diasAte(r[5]), alterado: !!(r[6] && r[5] && r[6].slice(0, 10) > r[5]) };
  });

  /* ---- cadastro único de produto, juntando o que cada consulta sabe dele (relatório do produto) */
  var PM = L.PM = new Map();
  function pm(cod, desc, comp, forn, ativo) {
    var x = PM.get(cod);
    if (!x) { x = { cod: cod, desc: desc, comp: comp, forn: forn, ativo: ativo !== false, rup: null, ev: null, exc: null, avaria: 0, sugp: [] }; PM.set(cod, x); }
    return x;
  }
  C.ruptura.forEach(function (r) { pm(r.codprod, r.desc, r.comp, r.forn, r.ativo).rup = r; });
  C.ev.forEach(function (r) { pm(r.codprod, r.desc, r.comp, r.forn, r.ativo).ev = r; });
  C.excesso.forEach(function (r) { pm(r.codprod, r.desc, r.comp, r.forn, true).exc = r; });
  C.sugp.forEach(function (r) { pm(r.codprod, r.desc, r.comp, r.forn, true).sugp.push(r); });
  C.avp.forEach(function (r) { var x = PM.get(r.codprod); if (x) x.avaria += r.valor || 0; });
  C.novos.forEach(function (r) { pm(r.codprod, r.desc, r.comp, r.forn, r.ativo).novo = r; });

  L.cache.clear();
  construirRegistro();
  return J;
}

/* ------------------------------ registro de dimensões ------------------------------ */
/* Cada dimensão sabe: listar as opções (código + nome), dar o nome de um código e, para uma
   LINHA de qualquer conjunto, qual é o código dela. Linha que não tem aquele campo devolve
   undefined e passa (a dimensão não se aplica a ela). */
L.cache = new Map();
function conj(a) { var s = new Set(); (a || []).forEach(function (x) { s.add(+x); }); return s; }
function sim(c) { return +c ? 1 : 0; }

function construirRegistro() {
  var X = L.DIM = {}, C = L.C;
  function def(k, rot, icone, cfg) { X[k] = Object.assign({ chave: k, rot: rot, icone: icone }, cfg); }
  function binaria(k, rot, icone, campo, tSim, tNao) {
    def(k, rot, icone, {
      todos: function () { return [{ id: 1, t: tSim }, { id: 0, t: tNao }]; },
      nome: function (c) { return +c ? tSim : tNao; },
      de: function (r) { var v = campo(r); return v === undefined ? undefined : (v ? 1 : 0); } });
  }

  def("comprador", "Comprador", "pessoas", {
    todos: function () {
      var o = L.COMP.lista.map(function (c) { return { id: c.cod, t: c.nome, s: "cód. " + c.cod }; });
      o.push({ id: -1, t: "Sem comprador ativo", s: "carteira sem dono" }); return o;
    },
    nome: function (c) { return +c < 0 ? "Sem comprador ativo" : L.nomeComprador(+c); },
    curto: function (c) { return +c < 0 ? "Sem comprador" : L.nomeCurto(+c); },
    de: function (r) { return r.comp === undefined ? undefined : L.compAtivo(r.comp); } });

  def("fornecedor", "Fornecedor", "caixa", {
    todos: function () {
      var cod = new Set();
      ["ruptura", "ev", "excesso", "avp", "sugp", "sugf", "verba", "fatForn", "novos"].forEach(function (n) { C[n].forEach(function (r) { cod.add(r.forn == null ? 0 : r.forn); }); });
      var o = [];
      cod.forEach(function (c) { o.push({ id: c, t: c ? L.nomeFornec(c) : "Sem fornecedor", s: c ? "cód. " + c : "" }); });
      return o.sort(function (a, b) { return a.t.localeCompare(b.t, "pt-BR"); });
    },
    nome: function (c) { return +c ? L.nomeFornec(+c) : "Sem fornecedor"; },
    de: function (r) { return r.forn === undefined ? undefined : (r.forn == null ? 0 : r.forn); } });

  def("produto", "Produto", "etiqueta", {
    todos: function () { var o = []; L.PM.forEach(function (p) { o.push({ id: p.cod, t: p.desc, s: String(p.cod) }); }); return o; },
    nome: function (c) { var p = L.PM.get(+c); return p ? p.desc : "Produto " + c; },
    sub: function (c) { return "cód. " + c; },
    de: function (r) { return r.codprod; } });

  binaria("status", "Situação do produto", "verificar", function (r) { return r.ativo; }, "Ativo", "Fora de linha");
  binaria("ruptura", "Ruptura", "alerta", function (r) { return r.ruptura; }, "Em ruptura", "Sem ruptura");
  binaria("coberturaOk", "Cobertura de 56 dias", "medidor", function (r) { return r.cobertura; }, "Dentro da meta", "Excesso");
  binaria("comCob", "Cobertura calculada", "medidor", function (r) { return r.semanas ? r.cob != null : undefined; }, "Com cobertura calculada", "Sem cobertura calculada");
  binaria("sugestao", "Sugestão de compra", "carteira", function (r) { return r.sug === undefined ? undefined : r.sug > 0; }, "Com sugestão de compra", "Sem sugestão");
  binaria("vendaS", "Venda nas 9 semanas", "tendencia", function (r) { return r.semanas ? r.vendaTot > 0 : undefined; }, "Vendeu nas 9 semanas", "Sem venda em 9 semanas");
  binaria("semGiro", "Giro cadastrado", "pulso", function (r) { return r.giro === undefined ? undefined : !(r.giro > 0); }, "Sem giro (zerado)", "Com giro");
  binaria("saldoVA", "Saldo da verba", "carteira", function (r) { return r.saldo === undefined ? undefined : r.saldo < 0; }, "Negativo", "Positivo");
  binaria("comAvaria", "Avaria", "devolucao", function (r) { return r.avaria === undefined || r.vencidas !== undefined ? undefined : r.avaria > 0; }, "Com avaria (maior que zero)", "Sem avaria");
  binaria("vencida", "Verba vencida", "relogio", function (r) { return r.vencidas === undefined ? undefined : r.vencidas > 0; }, "Com verba vencida", "Sem verba vencida");
  binaria("aVencer", "Verba a vencer", "calendario", function (r) { return r.avencer === undefined ? undefined : r.avencer > 0; }, "Com verba a vencer", "Sem verba a vencer");
  binaria("comSaldo", "Saldo de verba", "dinheiro", function (r) { return r.verba === undefined || r.entrada === undefined ? undefined : r.verba > 0; }, "Com saldo (maior que zero)", "Sem saldo");
  binaria("alterado", "Alteração no cadastro", "prancheta", function (r) { return r.alterado; }, "Alterado depois do cadastro", "Sem alteração depois do cadastro");

  /* há quanto tempo o produto novo foi cadastrado (para quem ainda está sem foto, é o atraso da foto) */
  L.FAIXAS_DIAS = [{ id: 0, nome: "Até 7 dias", max: 7 }, { id: 1, nome: "8 a 15 dias", max: 15 }, { id: 2, nome: "16 a 30 dias", max: 1e9 }];
  L.faixaDias = function (d) { for (var i = 0; i < L.FAIXAS_DIAS.length; i++) if (d <= L.FAIXAS_DIAS[i].max) return i; return 2; };
  def("diasCad", "Tempo desde o cadastro", "relogio", {
    todos: function () { return L.FAIXAS_DIAS.map(function (f) { return { id: f.id, t: f.nome }; }); },
    nome: function (c) { return L.FAIXAS_DIAS[+c] ? L.FAIXAS_DIAS[+c].nome : "—"; },
    de: function (r) { return r.cadastro === undefined ? undefined : L.faixaDias(r.dias || 0); } });

  /* "vendeu na semana N": uma linha pode ter vendido em várias semanas, então o código é uma LISTA */
  def("semana", "Semana com venda", "calendario", {
    todos: function () { var o = [{ id: 0, t: "Vendeu na semana atual (em curso)" }]; for (var i = 1; i < 9; i++) o.push({ id: i, t: "Vendeu há " + i + (i === 1 ? " semana" : " semanas") }); return o; },
    nome: function (c) { return +c === 0 ? "Vendeu na semana atual" : "Vendeu há " + c + (+c === 1 ? " semana" : " semanas"); },
    de: function (r) { if (!r.semanas) return undefined; var o = []; for (var i = 0; i < 9; i++) if ((r.semanas[i] || 0) > 0) o.push(i); return o; } });

  L.FAIXAS_COB = [
    { id: 0, nome: "0 a 2 semanas", min: 0, max: 2 }, { id: 1, nome: "2 a 4 semanas", min: 2, max: 4 }, { id: 2, nome: "4 a 8 semanas", min: 4, max: 8 },
    { id: 3, nome: "8 a 16 semanas", min: 8, max: 16 }, { id: 4, nome: "16 semanas ou mais", min: 16, max: 1e9 }, { id: 5, nome: "Sem cobertura calculada", min: null, max: null },
  ];
  L.faixaCob = function (cob) { if (cob == null) return 5; for (var i = 0; i < 5; i++) if (cob >= L.FAIXAS_COB[i].min && cob < L.FAIXAS_COB[i].max) return i; return 4; };
  def("cobFaixa", "Cobertura (semanas)", "medidor", {
    todos: function () { return L.FAIXAS_COB.map(function (f) { return { id: f.id, t: f.nome }; }); },
    nome: function (c) { return L.FAIXAS_COB[+c] ? L.FAIXAS_COB[+c].nome : "—"; },
    de: function (r) { return r.semanas ? L.faixaCob(r.cob) : undefined; } });

  L.mesAtual = function () { var h = new Date(); return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0"); };
  binaria("mesFechado", "Situação do mês", "calendario", function (r) { return r.mes === undefined ? undefined : r.mes < L.mesAtual(); }, "Só meses fechados", "Mês em curso");
  def("mes", "Mês", "calendario", {
    todos: function () { return C.fatMes.map(function (m) { return { id: +m.mes.replace("-", ""), t: L.fMesLongo(m.mes) }; }).reverse(); },
    nome: function (c) { var s = String(c); return L.fMesLongo(s.slice(0, 4) + "-" + s.slice(4)); },
    de: function (r) { return r.mes === undefined ? undefined : +String(r.mes).replace("-", ""); } });

  /* só para abrir o relatório (não filtram nenhuma tela) */
  def("depto", "Departamento", "camadas", { todos: function () { return C.fatDepto.map(function (d) { return { id: d.cod, t: titulo(d.nome) }; }); },
    nome: function (c) { var x = C.fatDepto.filter(function (d) { return d.cod === +c; })[0]; return x ? titulo(x.nome) : "Departamento " + c; }, de: function (r) { return r.codDepto; } });
  def("secao", "Seção", "etiqueta", { todos: function () { return C.fatSec.map(function (d) { return { id: d.cod, t: titulo(d.nome) }; }); },
    nome: function (c) { var x = C.fatSec.filter(function (d) { return d.cod === +c; })[0]; return x ? titulo(x.nome) : "Seção " + c; }, de: function (r) { return r.codSecao; } });
  def("uf", "Estado", "pino", { todos: function () { return C.fatUf.map(function (d, i) { return { id: i, t: d.uf }; }); },
    nome: function (c) { return C.fatUf[+c] ? C.fatUf[+c].uf : "—"; }, de: function (r) { return r.codUf; } });
  def("superv", "Supervisor", "pessoas", { todos: function () { return C.fatSup.map(function (d) { return { id: d.cod, t: titulo(d.nome) }; }); },
    nome: function (c) { var x = C.fatSup.filter(function (d) { return d.cod === +c; })[0]; return x ? titulo(x.nome) : "Supervisor " + c; }, de: function (r) { return r.codSup; } });

  Object.keys(X).forEach(function (k) {
    var d = X[k]; d.cache = null;
    d.itens = function () { if (!d.cache) d.cache = d.todos().map(function (x) { x.n = L.norm(x.t + " " + (x.s || "") + " " + x.id); return x; }); return d.cache; };
  });
}
L.nomeDe = function (dim, id) { var d = L.DIM[dim]; return d ? d.nome(id) : String(id); };

/* ------------------------------ filtragem ------------------------------ */
/* dimensões que a tela atual sabe aplicar (a faixa de filtros mostra e usa só estas) */
L.dimsDaPagina = function (pag) {
  pag = pag || L.paginaAtual();
  var f = typeof pag.filtros === "function" ? pag.filtros() : (pag.filtros || []);
  var m = typeof pag.mais === "function" ? pag.mais() : (pag.mais || []);
  return f.concat(m);
};
/* spec = { f: filtros } — por padrão, os filtros da tela atual que ela sabe aplicar */
L.spec = function (extra) {
  var aplic = L.dimsDaPagina(), f = {};
  Object.keys(L.estado.filtros || {}).forEach(function (k) { if (aplic.indexOf(k) >= 0 && L.estado.filtros[k] && L.estado.filtros[k].length) f[k] = L.estado.filtros[k].slice(); });
  if (extra && extra.f) for (var k in extra.f) { if (extra.f[k] == null) delete f[k]; else f[k] = extra.f[k].slice(); }
  return { f: f };
};
/* devolve as linhas do conjunto que passam em todos os filtros do spec */
L.linhas = function (conjunto, spec) {
  spec = spec || L.spec();
  var chave = conjunto + "|" + JSON.stringify(spec.f), hit = L.cache.get(chave);
  if (hit) return hit;
  var dims = [];
  Object.keys(spec.f).forEach(function (k) { var d = L.DIM[k]; if (d && spec.f[k] && spec.f[k].length) dims.push([d, conj(spec.f[k])]); });
  var base = L.C[conjunto], res = dims.length ? base.filter(function (r) {
    for (var i = 0; i < dims.length; i++) {
      var v = dims[i][0].de(r);
      if (v === undefined) continue;
      if (Array.isArray(v)) { var achou = false; for (var j = 0; j < v.length && !achou; j++) achou = dims[i][1].has(v[j]); if (!achou) return false; }
      else if (!dims[i][1].has(v)) return false;
    }
    return true;
  }) : base;
  L.cache.set(chave, res); if (L.cache.size > 80) L.cache.delete(L.cache.keys().next().value);
  return res;
};
L.soma = function (linhas, campo) { var s = 0; for (var i = 0; i < linhas.length; i++) s += (typeof campo === "function" ? campo(linhas[i]) : linhas[i][campo]) || 0; return s; };

/* agrupa linhas por uma dimensão e soma o que o chamador pedir */
L.agrupar = function (linhas, dim, acum) {
  var d = L.DIM[dim], m = new Map();
  linhas.forEach(function (r) {
    var k = d.de(r), g = m.get(k);
    if (!g) { g = { k: k, n: 0 }; m.set(k, g); }
    g.n++; acum(g, r);
  });
  return Array.from(m.values());
};

/* texto dos filtros aplicados (planilha e cabeçalho dos relatórios) */
L.descricaoFiltros = function (extra) {
  var out = [], f = L.estado.filtros, aplic = L.dimsDaPagina();
  out.push(["Posição", "carga de " + L.fDataHora(L.META.geradoEm)]);
  Object.keys(f).forEach(function (k) {
    var a = f[k]; if (!a || !a.length || !L.DIM[k] || aplic.indexOf(k) < 0) return;
    var nomes = a.map(function (id) { return L.nomeDe(k, id); });
    out.push([L.DIM[k].rot, nomes.length > 6 ? nomes.slice(0, 6).join("; ") + " e mais " + (nomes.length - 6) : nomes.join("; ")]);
  });
  if (extra) extra.forEach(function (x) { out.push(x); });
  return out;
};

})();
