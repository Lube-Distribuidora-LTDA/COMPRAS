/**
 * /api/fotos — a lista dos códigos de produto que têm miniatura (trade.produto_miniatura).
 *
 * O painel usa para saber, antes de pedir a foto, quais produtos têm uma — assim não sai
 * uma requisição por produto sem foto. ~7 mil números, poucos KB. Cache curto no navegador de
 * quem entrou (a lista só muda quando a carga do Trade traz foto nova).
 */
"use strict";
const { consultar, json, semConfiguracao } = require("./_db");

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const r = await consultar("SELECT codprod FROM trade.produto_miniatura WHERE webp IS NOT NULL ORDER BY codprod");
    json(res, 200, { cods: r.rows.map((x) => x.codprod) }, { "Cache-Control": "private, max-age=900" });
  } catch (e) {
    console.error("[fotos]", (e && e.message) || e);
    json(res, 503, { erro: "lista de fotos indisponível agora" });
  }
};
