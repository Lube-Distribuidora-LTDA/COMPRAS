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

const { Pool } = require("pg");

const OBRIGATORIAS = ["SUPABASE_DB_HOST", "SUPABASE_DB_USER", "SUPABASE_DB_PASSWORD"];

/*
 * Reaproveita a conexão entre chamadas "quentes" da função serverless.
 *
 * Antes, cada requisição abria um Client novo e fechava no final — ou seja,
 * toda carga do painel abria uma conexão física nova através do pooler do
 * Supabase (porta 6543). Isso sobrecarrega o auth_query do pooler (a
 * verificação de senha que ele faz a cada conexão nova) e foi a causa de
 * falhas intermitentes observadas em produção:
 *   error: (EAUTHQUERY) auth_query secret check timed out
 * Mantendo um Pool no escopo do módulo, instâncias "quentes" da função
 * reaproveitam a mesma conexão em vez de abrir outra a cada acesso.
 */
let pool = null;
function obterPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT || 6543),
      database: process.env.SUPABASE_DB_NAME || "postgres",
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 25000,
      connectionTimeoutMillis: 10000,
      application_name: "painel-compras",
      max: 1,
      idleTimeoutMillis: 50000,
    });
    // Se a conexão ociosa cair sozinha (o pooler reciclou, rede oscilou),
    // descarta o Pool: a próxima chamada cria um do zero.
    pool.on("error", (e) => {
      console.error("Conexão Postgres ociosa caiu:", e && e.message);
      pool = null;
    });
  }
  return pool;
}

async function consultarComRetentativa(tentativas) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await obterPool().query("SELECT compras.painel_dados() AS painel");
    } catch (e) {
      ultimoErro = e;
      pool = null; // a conexão pode estar em estado ruim — descarta e recria
      if (i < tentativas - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
      }
    }
  }
  throw ultimoErro;
}

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

  try {
    const r = await consultarComRetentativa(3);
    const painel = r.rows[0] && r.rows[0].painel;
    if (!painel) throw new Error("A consulta não devolveu dados.");

    // O conteúdo muda no máximo 4x ao dia (o ETL roda às 08h, 12h, 18h e 00h),
    // então vale guardar no CDN: só o primeiro acesso de cada janela toca o banco.
    // O botão "Atualizar" do painel manda ?atualizar=<hora>, que ignora esse cache.
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
  }
};
