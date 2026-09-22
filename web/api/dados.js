/**
 * /api/dados — entrega ao painel todo o conteúdo do BI Compras.
 *
 * A consulta acontece aqui, no servidor da Vercel: a senha do banco fica numa
 * variável de ambiente e nunca chega ao navegador. As tabelas do Supabase estão
 * com Row Level Security ligado e sem políticas, então a chave pública não lê
 * nada — só esta função, que conecta com credencial de servidor, enxerga os dados.
 *
 * Toda a consulta mora no banco, na função `compras.painel_dados()` (ver
 * db/painel_dados.sql). Aqui é só encanamento.
 *
 * Variáveis de ambiente necessárias (Settings › Environment Variables):
 *   SUPABASE_DB_HOST      aws-0-sa-east-1.pooler.supabase.com
 *   SUPABASE_DB_PORT      6543   (transaction pooler — o indicado para serverless)
 *   SUPABASE_DB_NAME      postgres
 *   SUPABASE_DB_USER      postgres.<id-do-projeto>
 *   SUPABASE_DB_PASSWORD  a senha do projeto DATA WAREHOUSE
 */

const { Client } = require("pg");

const OBRIGATORIAS = ["SUPABASE_DB_HOST", "SUPABASE_DB_USER", "SUPABASE_DB_PASSWORD"];

module.exports = async function handler(req, res) {
  const faltando = OBRIGATORIAS.filter((v) => !process.env[v]);
  if (faltando.length) {
    res.status(500).json({
      erro: "configuracao_incompleta",
      mensagem:
        "Faltam variáveis de ambiente no projeto da Vercel: " + faltando.join(", ") +
        ". Cadastre em Settings › Environment Variables e publique de novo.",
    });
    return;
  }

  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 6543),
    database: process.env.SUPABASE_DB_NAME || "postgres",
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 25000,
    connectionTimeoutMillis: 10000,
    application_name: "painel-compras",
  });

  try {
    await client.connect();
    const r = await client.query("SELECT compras.painel_dados() AS painel");
    const painel = r.rows[0] && r.rows[0].painel;
    if (!painel) throw new Error("A consulta não devolveu dados.");

    // O conteúdo muda no máximo 4x ao dia (o ETL roda às 08h, 12h, 18h e 00h),
    // então vale guardar no CDN: só o primeiro acesso de cada janela toca o banco.
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(painel));
  } catch (e) {
    console.error("Falha ao consultar o Supabase:", e);
    res.status(502).json({
      erro: "falha_no_banco",
      mensagem:
        "Não consegui ler o DATA WAREHOUSE. Confira as variáveis de ambiente e se a porta " +
        (process.env.SUPABASE_DB_PORT || 6543) + " (transaction pooler) está correta.",
      detalhe: String(e && e.message ? e.message : e),
    });
  } finally {
    try { await client.end(); } catch (_) { /* conexão já encerrada */ }
  }
};
