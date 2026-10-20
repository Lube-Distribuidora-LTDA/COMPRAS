/* =============================================================================
 * pag-notas.js — SOBRE OS DADOS: de onde vem cada número, as regras que valem e como o painel
 * se atualiza. O texto que antes ficava em cada tela (e atrapalhava a leitura) mora aqui.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.registrarPagina({
  id: "notas", grupo: "Sistema", menu: "Sobre os dados", icone: "info",
  titulo: "Notas técnicas desta versão", olho: "Origem, regras e atualização",
  filtros: [], mais: [],
  render: render,
});

var NOTAS = [
  "<strong>Origem:</strong> todas as telas leem o projeto DATA WAREHOUSE no Supabase, alimentado a partir do Oracle/WinThor. As consultas rápidas rodam 4x ao dia; o faturamento, 1x por dia de madrugada.",
  "<strong>Verba:</strong> o cartão de verba da tela Compras usa a consulta oficial de saldo de verba (Consulta3/SALDOMOV). Nas primeiras versões deste painel ele somava a coluna de verba da própria consulta de ruptura, que é por fornecedor principal — o valor saía cerca do dobro do real.",
  "<strong>Status ATIVO/FORALINHA:</strong> a coluna OBS2 do WinThor não distingue os dois valores em todos os produtos. Até corrigirmos a origem, quem não é explicitamente FORALINHA é tratado como ativo.",
  "<strong>Avaria:</strong> na tela Compras ela considera as filiais 1, 2, 7 e 8, para todos os produtos. Na tela Verba x avaria ela soma todas as filiais, porque o filtro de filial dessa consulta de origem nunca chega a ser aplicado — mas fica restrita aos fornecedores principais que têm movimentação de verba, por isso o total das duas telas não bate.",
  "<strong>Sugestão por fornecedor:</strong> cada produto da carteira do fornecedor é avaliado ao seu próprio preço de venda, e a sugestão soma o valor de cada item individualmente.",
  "<strong>Margem do faturamento:</strong> a divisão é protegida contra venda zero, evitando distorções no cálculo quando não há venda no período.",
  "<strong>Janela do faturamento:</strong> a base guarda apenas o ano corrente — o ETL lê do Oracle a partir de 1º de janeiro, então a virada do ano limpa o ano anterior sozinha, sem rotina de expurgo. Isso mantém a maior tabela do banco em ~250 mil linhas em vez de 1,6 milhão, mas tem um preço: não há comparação com o ano anterior, e em janeiro o período é curto.",
  "<strong>Compradores que saíram:</strong> não aparecem nos filtros. Produto ou fornecedor que o WinThor ainda não reatribuiu perde só o nome do comprador (aparece como “Sem comprador ativo”); estoque, ruptura, avaria e venda seguem na tela.",
  "<strong>Atualização:</strong> o painel abre na hora com a cópia guardada neste computador e confere por trás se há carga mais nova; quando há, o botão Atualizar (o relógio, no alto) acende. O botão busca a carga mais recente direto do banco, ignorando o cache.",
];

function render(raiz) {
  var M = L.META, c = M.cargas || {};
  var p = L.painel({ titulo: "Notas técnicas", sub: "como ler os números do Central Compras", classe: "c-8" });
  var ul = L.h("ul", { class: "notas-lista" });
  NOTAS.forEach(function (t) { ul.appendChild(L.h("li", { html: t })); });
  p.corpo.appendChild(ul);

  var q = L.painel({ titulo: "Cargas desta tela", sub: "o que está sendo mostrado agora", classe: "c-4" });
  var ficha = L.h("div", { class: "ficha" });
  function linha(rot, val) { ficha.appendChild(L.h("div", { class: "ficha-l" }, L.h("span", { text: rot }), L.h("b", { class: "num", text: val }))); }
  linha("Carga mais antiga em tela", L.fDataHora(M.geradoEm));
  if (c.estoque) linha("Estoque, verba e sugestões", L.fDataHora(c.estoque));
  if (c.faturamento) linha("Faturamento", L.fDataHora(c.faturamento));
  linha("Próxima carga", L.proximaCarga());
  linha("Produtos na carga", L.fInt(L.PM.size));
  linha("Versão do painel", String(window.VERSAO || ""));
  q.corpo.appendChild(ficha);
  raiz.appendChild(L.grade(p, q));
}

})();
