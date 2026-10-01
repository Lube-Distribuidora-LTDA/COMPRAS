/* =============================================================================
 * agente.js — o assistente da Central Compras.
 *
 * O modelo não recebe os dados: recebe ferramentas. Quando ele pede
 * "os 20 piores em ruptura do comprador Julio", quem executa é este arquivo,
 * em cima do JSON que o painel já carregou. Por isso a resposta é exata (não
 * sai de uma amostra truncada), sai na hora (não há consulta nova no banco) e
 * não manda a base inteira para lugar nenhum — só o recorte que foi pedido.
 *
 * A chave da API não passa por aqui. O navegador fala com /api/agente, e é a
 * função serverless que acrescenta a chave.
 *
 * Uso: Agente.iniciar({ conjuntos, geradoEm }) — ver index.html.
 * ========================================================================== */
(function () {
"use strict";

var MAX_VOLTAS = 6;          /* teto de idas e vindas de ferramenta por pergunta */
var MAX_TENTATIVAS = 2;      /* o serviço às vezes engasga; tenta de novo antes de reclamar */

var conjuntos = null;        /* nome -> array de linhas; só é montado na 1ª pergunta */
var fabrica = null;          /* função que monta os conjuntos, vinda do index.html */
var conversa = [];           /* histórico no formato da API */
var ocupado = false;
var aberto = false;
var ultimaFalha = null;      /* para o botão "Tentar de novo" */

/* ---------------------------------------------------------------------------
 * Consulta aos dados
 * ------------------------------------------------------------------------ */
function normalizar(v) {
  return String(v == null ? "" : v)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();
}

/* "true", "sim", 1 e true são a mesma coisa aqui. Sem isto, um filtro de
   sim/não que não casasse o tipo devolveria lista vazia em silêncio — e o
   assistente responderia "não há nenhum" com toda a convicção. */
function paraBooleano(x) {
  if (typeof x === "boolean") return x;
  var s = normalizar(x);
  if (s === "true" || s === "sim" || s === "1") return true;
  if (s === "false" || s === "nao" || s === "0") return false;
  return null;
}

function comparar(linha, f) {
  var v = linha[f.campo];
  var alvo = f.valor;
  switch (f.operador) {
    case "vazio":      return v == null || v === "";
    case "preenchido": return v != null && v !== "";
    case "contem":     return normalizar(v).indexOf(normalizar(alvo)) !== -1;
  }
  var alvoBool = paraBooleano(alvo);
  if (typeof v === "boolean" || (alvoBool !== null && (v === 0 || v === 1))) {
    var atual = paraBooleano(v);
    if (alvoBool !== null && atual !== null) {
      return f.operador === "!=" ? atual !== alvoBool : atual === alvoBool;
    }
  }
  if (v == null) return false;
  var a = v, b2 = alvo;
  if (typeof v === "number" || (!isNaN(parseFloat(alvo)) && !isNaN(parseFloat(v)))) {
    a = parseFloat(v); b2 = parseFloat(alvo);
    if (isNaN(a) || isNaN(b2)) { a = normalizar(v); b2 = normalizar(alvo); }
  } else { a = normalizar(v); b2 = normalizar(alvo); }
  switch (f.operador) {
    case "=":  return a === b2;
    case "!=": return a !== b2;
    case ">":  return a > b2;
    case ">=": return a >= b2;
    case "<":  return a < b2;
    case "<=": return a <= b2;
  }
  return true;
}

function filtrar(nome, filtros) {
  /* montar custa percorrer ~22 mil linhas: só vale a pena quando alguém pergunta */
  if (!conjuntos) conjuntos = fabrica ? fabrica() : {};
  var base = conjuntos[nome];
  if (!base) {
    throw new Error('Conjunto desconhecido: "' + nome + '". Disponíveis: ' +
                    Object.keys(conjuntos).join(", ") + ".");
  }
  if (!filtros || !filtros.length) return base;
  return base.filter(function (l) {
    return filtros.every(function (f) { return comparar(l, f); });
  });
}

function ordenar(linhas, campo, ordem) {
  if (!campo) return linhas;
  var dir = ordem === "asc" ? 1 : -1;
  return linhas.slice().sort(function (x, y) {
    var a = x[campo], b = y[campo];
    if (a == null && b == null) return 0;
    if (a == null) return 1;            /* vazio sempre por último */
    if (b == null) return -1;
    if (typeof a === "string" || typeof b === "string") {
      return String(a).localeCompare(String(b), "pt-BR") * dir;
    }
    return (a - b) * dir;
  });
}

function enxugar(linhas, campos) {
  if (!campos || !campos.length) return linhas;
  return linhas.map(function (l) {
    var o = {};
    campos.forEach(function (c) { if (c in l) o[c] = l[c]; });
    return o;
  });
}

function ferramentaConsultar(e) {
  var achadas = filtrar(e.conjunto, e.filtros);
  var limite = Math.min(Math.max(parseInt(e.limite, 10) || 20, 1), 200);
  var pagina = ordenar(achadas, e.ordenar_por, e.ordem).slice(0, limite);
  return {
    total: achadas.length,
    mostrando: pagina.length,
    linhas: enxugar(pagina, e.campos)
  };
}

function calcular(linhas, m) {
  var vals = [];
  if (m.funcao !== "contagem") {
    for (var i = 0; i < linhas.length; i++) {
      var v = linhas[i][m.campo];
      if (v != null && v !== "" && !isNaN(v)) vals.push(Number(v));
    }
  }
  switch (m.funcao) {
    case "contagem": return linhas.length;
    case "soma":     return vals.reduce(function (s, v) { return s + v; }, 0);
    case "media":    return vals.length ? vals.reduce(function (s, v) { return s + v; }, 0) / vals.length : null;
    case "minimo":   return vals.length ? Math.min.apply(null, vals) : null;
    case "maximo":   return vals.length ? Math.max.apply(null, vals) : null;
  }
  return null;
}

function ferramentaAgregar(e) {
  var achadas = filtrar(e.conjunto, e.filtros);
  var metricas = (e.metricas || []).map(function (m) {
    return { funcao: m.funcao, campo: m.campo, apelido: m.apelido || (m.funcao + (m.campo ? "_" + m.campo : "")) };
  });
  if (!metricas.length) metricas = [{ funcao: "contagem", apelido: "contagem" }];

  if (!e.agrupar_por) {
    var unico = { linhas_consideradas: achadas.length };
    metricas.forEach(function (m) { unico[m.apelido] = calcular(achadas, m); });
    return unico;
  }

  var grupos = new Map();
  achadas.forEach(function (l) {
    var chave = l[e.agrupar_por];
    var k = (chave == null || chave === "") ? "(sem " + e.agrupar_por + ")" : String(chave);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  });

  var saida = [];
  grupos.forEach(function (ls, k) {
    var linha = {};
    linha[e.agrupar_por] = k;
    linha.linhas = ls.length;
    metricas.forEach(function (m) { linha[m.apelido] = calcular(ls, m); });
    saida.push(linha);
  });

  var por = e.ordenar_por || (metricas[0] && metricas[0].apelido);
  var limite = Math.min(Math.max(parseInt(e.limite, 10) || 30, 1), 200);
  return {
    grupos: grupos.size,
    linhas_consideradas: achadas.length,
    resultado: ordenar(saida, por, e.ordem).slice(0, limite)
  };
}

function ferramentaPlanilha(e) {
  if (!window.Planilha) throw new Error("O gerador de planilha não carregou nesta página.");
  var colunas = (e.colunas || []).filter(function (c) { return c && c.campo && c.titulo; });
  if (!colunas.length) throw new Error("Nenhuma coluna foi informada para a planilha.");

  var achadas = filtrar(e.conjunto, e.filtros);
  var limite = Math.min(Math.max(parseInt(e.limite, 10) || 5000, 1), 20000);
  var linhas = ordenar(achadas, e.ordenar_por, e.ordem).slice(0, limite);
  if (!linhas.length) return { gerou: false, motivo: "O filtro não devolveu nenhuma linha — a planilha não foi gerada." };

  var arquivo = String(e.arquivo || "relatorio.xlsx").replace(/[\\\/:*?"<>|]/g, "-");
  if (!/\.xlsx$/i.test(arquivo)) arquivo += ".xlsx";

  var filtros = (e.descricao_filtros || []).map(function (f) {
    return [String(f[0] == null ? "" : f[0]), String(f[1] == null ? "" : f[1])];
  });
  filtros.push(["Linhas", String(linhas.length) + (achadas.length > linhas.length ? " (de " + achadas.length + ")" : "")]);
  filtros.push(["Gerado em", new Date().toLocaleString("pt-BR")]);

  window.Planilha.baixar({
    arquivo: arquivo,
    titulo: e.titulo || "Relatório",
    aba: (e.titulo || "Dados").slice(0, 28),
    filtros: filtros,
    colunas: colunas.map(function (c) {
      return {
        titulo: c.titulo,
        tipo: c.tipo || "texto",
        valor: function (linha) {
          var v = linha[c.campo];
          /* percentual vem 0–1 na base e a planilha espera 0–100 */
          if (c.tipo === "percentual" && typeof v === "number" && Math.abs(v) <= 1) return v * 100;
          if (typeof v === "boolean") return v ? "Sim" : "Não";
          return v;
        }
      };
    }),
    linhas: linhas
  });

  return { gerou: true, arquivo: arquivo, linhas: linhas.length, total_sem_limite: achadas.length };
}

function executar(nome, entrada) {
  if (nome === "consultar") return ferramentaConsultar(entrada || {});
  if (nome === "agregar") return ferramentaAgregar(entrada || {});
  if (nome === "gerar_planilha") return ferramentaPlanilha(entrada || {});
  throw new Error('Ferramenta desconhecida: "' + nome + '".');
}

/* ---------------------------------------------------------------------------
 * Interface
 * ------------------------------------------------------------------------ */
var elBotao, elPainel, elLista, elEntrada, elEnviar, elStatus;

function cria(tag, classe, texto) {
  var e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}

function escapar(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Markdown bem curto: negrito, itálico, código e lista. O texto é escapado
   ANTES de virar HTML — ordem invertida aqui seria um buraco de XSS. */
function formatar(texto) {
  var linhas = escapar(texto).split("\n");
  var saida = [], lista = null;
  function fecharLista() { if (lista) { saida.push("<ul>" + lista.join("") + "</ul>"); lista = null; } }

  linhas.forEach(function (l) {
    var item = l.match(/^\s*[-*•]\s+(.*)$/) || l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (item) {
      if (!lista) lista = [];
      lista.push("<li>" + enfeitar(item[1]) + "</li>");
      return;
    }
    fecharLista();
    if (l.trim()) saida.push("<p>" + enfeitar(l) + "</p>");
  });
  fecharLista();
  return saida.join("");
}

function enfeitar(l) {
  return l
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function desenhar() {
  elLista.innerHTML = "";
  conversa.forEach(function (m) {
    var texto = textoDe(m);
    if (!texto) return;
    if (texto === "__FALHOU__") { elLista.appendChild(cartaoErro()); return; }
    var bolha = cria("div", "ag-msg ag-" + (m.role === "user" ? "eu" : "ele"));
    if (m.role === "user") bolha.textContent = texto;
    else bolha.innerHTML = formatar(texto);
    elLista.appendChild(bolha);
  });
  elLista.scrollTop = elLista.scrollHeight;
}

/* Só o texto interessa na tela: blocos de ferramenta ficam na conversa, mas
   não viram bolha. */
function textoDe(m) {
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return "";
  return m.content.filter(function (b) { return b.type === "text"; })
                  .map(function (b) { return b.text; }).join("\n").trim();
}

function cartaoErro() {
  var c = cria("div", "ag-erro");
  c.appendChild(cria("p", null, ultimaFalha || "Não consegui responder agora."));
  var b = cria("button", "ag-retry", "Tentar de novo");
  b.type = "button";
  b.addEventListener("click", function () {
    /* tira o marcador de falha e repete a última pergunta */
    while (conversa.length && textoDe(conversa[conversa.length - 1]) === "__FALHOU__") conversa.pop();
    var ultima = null;
    for (var i = conversa.length - 1; i >= 0; i--) {
      if (conversa[i].role === "user") { ultima = conversa.splice(i)[0]; break; }
    }
    desenhar();
    if (ultima) perguntar(textoDe(ultima));
  });
  c.appendChild(b);
  return c;
}

function status(texto) {
  elStatus.textContent = texto || "";
  elStatus.classList.toggle("ativo", !!texto);
  if (texto) elLista.scrollTop = elLista.scrollHeight;
}

/* ---------------------------------------------------------------------------
 * Conversa
 * ------------------------------------------------------------------------ */
function chamar(mensagens) {
  return fetch("/api/agente", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mensagens: mensagens })
  }).then(function (r) {
    return r.json().then(function (corpo) {
      if (!r.ok) throw new Error((corpo && corpo.mensagem) || ("HTTP " + r.status));
      return corpo;
    }, function () { throw new Error("A resposta do servidor não veio em JSON (HTTP " + r.status + ")."); });
  });
}

var RECADO = {
  consultar: "consultando os dados…",
  agregar: "somando os números…",
  gerar_planilha: "montando a planilha…"
};

function perguntar(texto) {
  if (ocupado) return;
  ocupado = true;
  ultimaFalha = null;
  elEnviar.disabled = true;

  conversa.push({ role: "user", content: texto });
  desenhar();
  status("Pensando…");

  var voltas = 0, tentativas = 0;

  function rodada() {
    chamar(conversa).then(function (resposta) {
      tentativas = 0;
      conversa.push({ role: "assistant", content: resposta.conteudo });

      var pedidos = (resposta.conteudo || []).filter(function (b) { return b.type === "tool_use"; });
      if (resposta.motivo_parada === "tool_use" && pedidos.length) {
        if (++voltas > MAX_VOLTAS) {
          falhar("A pergunta exigiu consultas demais. Tente algo mais específico.");
          return;
        }
        desenhar();
        status(RECADO[pedidos[0].name] || "consultando…");

        var resultados = pedidos.map(function (p) {
          try {
            return { type: "tool_result", tool_use_id: p.id, content: JSON.stringify(executar(p.name, p.input)) };
          } catch (erro) {
            return {
              type: "tool_result", tool_use_id: p.id, is_error: true,
              content: "Erro: " + (erro && erro.message ? erro.message : String(erro))
            };
          }
        });
        conversa.push({ role: "user", content: resultados });
        /* devolve o resultado ao modelo para ele compor a resposta */
        setTimeout(rodada, 0);
        return;
      }

      ocupado = false;
      elEnviar.disabled = false;
      status("");
      desenhar();
    }).catch(function (erro) {
      if (++tentativas < MAX_TENTATIVAS) {
        status("Pensando… (nova tentativa " + (tentativas + 1) + "/" + MAX_TENTATIVAS + ")");
        setTimeout(rodada, 1200);
        return;
      }
      falhar(erro && erro.message ? erro.message : String(erro));
    });
  }

  function falhar(motivo) {
    ocupado = false;
    elEnviar.disabled = false;
    status("");
    ultimaFalha = motivo;
    conversa.push({ role: "assistant", content: "__FALHOU__" });
    desenhar();
  }

  rodada();
}

/* ---------------------------------------------------------------------------
 * Montagem
 * ------------------------------------------------------------------------ */
var SUGESTOES = [
  "Quais produtos estão em ruptura e valem mais avaria?",
  "Qual comprador tem mais capital parado em excesso?",
  "Como foi a venda e a margem dos últimos 6 meses?",
  "Gere uma planilha dos fornecedores com saldo de verba negativo"
];

function abrir() {
  aberto = true;
  elPainel.classList.add("aberto");
  elBotao.classList.add("aberto");
  elPainel.setAttribute("aria-hidden", "false");
  setTimeout(function () { elEntrada.focus(); }, 120);
}

function fechar() {
  aberto = false;
  elPainel.classList.remove("aberto");
  elBotao.classList.remove("aberto");
  elPainel.setAttribute("aria-hidden", "true");
}

function montarInterface() {
  elBotao = cria("button", "ag-fab");
  elBotao.type = "button";
  elBotao.title = "Assistente da Central Compras";
  elBotao.setAttribute("aria-label", "Abrir o assistente");
  elBotao.innerHTML = '<span class="ag-fab-ico" aria-hidden="true">✦</span>';
  elBotao.addEventListener("click", function () { aberto ? fechar() : abrir(); });

  elPainel = cria("section", "ag-painel");
  elPainel.setAttribute("aria-label", "Assistente da Central Compras");
  elPainel.setAttribute("aria-hidden", "true");

  var cab = cria("header", "ag-cab");
  var tit = cria("div");
  tit.appendChild(cria("div", "ag-titulo", "Assistente"));
  tit.appendChild(cria("div", "ag-sub", "Pergunte sobre os números ou peça um relatório"));
  cab.appendChild(tit);
  var fecharBtn = cria("button", "ag-fechar", "×");
  fecharBtn.type = "button";
  fecharBtn.title = "Fechar";
  fecharBtn.setAttribute("aria-label", "Fechar o assistente");
  fecharBtn.addEventListener("click", fechar);
  cab.appendChild(fecharBtn);
  elPainel.appendChild(cab);

  elLista = cria("div", "ag-lista");
  elPainel.appendChild(elLista);

  elStatus = cria("div", "ag-status");
  elPainel.appendChild(elStatus);

  var chips = cria("div", "ag-chips");
  SUGESTOES.forEach(function (s) {
    var b = cria("button", "ag-chip", s);
    b.type = "button";
    b.addEventListener("click", function () {
      if (ocupado) return;
      chips.remove();
      perguntar(s);
    });
    chips.appendChild(b);
  });

  var abertura = cria("div", "ag-msg ag-ele");
  abertura.innerHTML = formatar(
    "Olá! Eu leio os dados deste painel e respondo sobre eles.\n\n" +
    "Posso cruzar ruptura, estoque, verba, avaria, excesso, sugestão de compra e faturamento — " +
    "e **gerar planilhas em Excel** já formatadas, com os filtros escritos por extenso.\n\n" +
    "Pergunte à vontade, ou comece por uma destas:");
  elLista.appendChild(abertura);
  elLista.appendChild(chips);

  var rodape = cria("form", "ag-rodape");
  elEntrada = document.createElement("input");
  elEntrada.type = "text";
  elEntrada.className = "ag-entrada";
  elEntrada.placeholder = "Ex.: quanto de capital parado tem o Julio?";
  elEntrada.autocomplete = "off";
  elEnviar = cria("button", "ag-enviar");
  elEnviar.type = "submit";
  elEnviar.title = "Enviar";
  elEnviar.setAttribute("aria-label", "Enviar pergunta");
  elEnviar.innerHTML = "↑";
  rodape.appendChild(elEntrada);
  rodape.appendChild(elEnviar);
  rodape.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = elEntrada.value.trim();
    if (!t || ocupado) return;
    elEntrada.value = "";
    var c = elPainel.querySelector(".ag-chips");
    if (c) c.remove();
    perguntar(t);
  });
  elPainel.appendChild(rodape);

  document.body.appendChild(elPainel);
  document.body.appendChild(elBotao);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && aberto) fechar();
  });
}

/* ---------------------------------------------------------------------------
 * Entrada do módulo
 * ------------------------------------------------------------------------ */
function iniciar(ctx) {
  fabrica = ctx && typeof ctx.montarConjuntos === "function" ? ctx.montarConjuntos : null;
  montarInterface();
}

window.Agente = { iniciar: iniciar };

})();
