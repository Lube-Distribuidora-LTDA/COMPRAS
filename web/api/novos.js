/**
 * /api/novos — a lista da tela Produtos novos, lida na hora (sem passar pelo pacote do painel).
 *
 * Os cadastros vêm da carga do Compras (compras.fato_produto_novo, 4x ao dia); a foto vem do
 * agente de fotos do Trade, que lê a pasta FOTOS_ION a cada 5 minutos (trade.produto_imagem).
 * A tela chama esta rota ao abrir e a cada 5 minutos: a foto que entra na pasta tira o produto da
 * lista sem esperar carga nenhuma e sem baixar de novo o pacote inteiro do painel.
 * Mesmo formato da chave "novos" de compras.painel_dados(). ~250 linhas, poucos KB, nunca em cache.
 */
"use strict";
const { consultar, json, semConfiguracao } = require("./_db");

const SQL = `
SELECT json_build_object(
  'novos', (SELECT coalesce(json_agg(json_build_array(
      n.codprod, coalesce(n.descricao,'—'), n.embalagem, n.codfornec, n.codcomprador,
      to_char(n.dtcadastro, 'YYYY-MM-DD'), to_char(n.dtultalter, 'YYYY-MM-DD"T"HH24:MI:SS'),
      n.cadastrado_por, CASE WHEN n.status = 'FORALINHA' THEN 'F' ELSE 'A' END,
      CASE WHEN i.codprod IS NULL THEN 0 ELSE 1 END,
      to_char(i.modificado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'))
      ORDER BY n.dtcadastro DESC, n.codprod), '[]'::json)
    FROM compras.fato_produto_novo n
    LEFT JOIN trade.produto_imagem i ON i.codprod = n.codprod),
  'fotosEm', (SELECT to_char(max(executado_em) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')
                FROM trade.controle_carga WHERE status = 'OK' AND consulta IN ('fotos_imagens', 'imagens')),
  'cadastrosEm', (SELECT to_char(max(executado_em) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')
                    FROM compras.controle_carga WHERE status = 'OK' AND consulta = 'produto_novo')
) AS j`;

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const r = await consultar(SQL);
    json(res, 200, r.rows[0].j, { "Cache-Control": "no-store" });
  } catch (e) {
    console.error("[novos]", (e && e.message) || e);
    json(res, 503, { erro: "lista de produtos novos indisponível agora" });
  }
};
