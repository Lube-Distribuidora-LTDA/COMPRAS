/**
 * _db.js — conexão com o DATA WAREHOUSE para as rotas das FOTOS (arquivo com "_" no começo não
 * vira rota na Vercel). A rota /api/dados tem a sua própria conexão, que não foi mexida.
 *
 * Mesmas variáveis de ambiente do /api/dados (SUPABASE_DB_*), cadastradas pelo Júlio. Um Pool pequeno e
 * reaproveitado entre chamadas "quentes": a tela pede dezenas de miniaturas de uma vez, e abrir uma conexão
 * nova para cada uma (através do pooler) é o que faz o pooler engasgar. Se a conexão cair, o Pool é
 * descartado e a próxima chamada cria outro.
 */
"use strict";
const { Pool } = require("pg");
try { require("dns").setDefaultResultOrder("ipv4first"); } catch (_) { /* Node antigo */ }

const OBRIGATORIAS = ["SUPABASE_DB_HOST", "SUPABASE_DB_USER", "SUPABASE_DB_PASSWORD"];

/* valor colado na tela da Vercel costuma vir com espaço nas pontas ou com as aspas do ENV */
function limpo(v) { return String(v == null ? "" : v).trim().replace(/^"(.*)"$/, "$1").trim(); }

let pool = null;
function obterPool() {
  if (!pool) {
    pool = new Pool({
      host: limpo(process.env.SUPABASE_DB_HOST),
      port: Number(limpo(process.env.SUPABASE_DB_PORT) || 6543),
      database: limpo(process.env.SUPABASE_DB_NAME) || "postgres",
      user: limpo(process.env.SUPABASE_DB_USER),
      password: limpo(process.env.SUPABASE_DB_PASSWORD),
      ssl: { rejectUnauthorized: false },
      statement_timeout: 15000,
      connectionTimeoutMillis: 10000,
      application_name: "painel-compras-fotos",
      max: 3,
      idleTimeoutMillis: 50000,
    });
    pool.on("error", (e) => { console.error("Conexão ociosa caiu:", e && e.message); pool = null; });
  }
  return pool;
}

/* uma consulta SIMPLES (sem parâmetros: o pooler de transação não gosta de comando preparado).
   Quem chama monta o SQL só com valores já validados. Se a conexão estiver ruim, refaz uma vez. */
async function consultar(sql) {
  let ultimoErro;
  for (let i = 0; i < 2; i++) {
    try { return await obterPool().query(sql); }
    catch (e) { ultimoErro = e; pool = null; }
  }
  throw ultimoErro;
}

function faltandoVariaveis() { return OBRIGATORIAS.filter((v) => !process.env[v]); }

function json(res, status, obj, cabecalhos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const k in (cabecalhos || {})) res.setHeader(k, cabecalhos[k]);
  res.end(JSON.stringify(obj));
}

/* resposta padrão quando falta variável de ambiente (nunca vai para cache) */
function semConfiguracao(res) {
  const faltando = faltandoVariaveis();
  if (!faltando.length) return false;
  json(res, 500, { erro: "configuracao_incompleta", mensagem: "Faltam variáveis de ambiente no projeto da Vercel: " + faltando.join(", ") });
  return true;
}

module.exports = { consultar, json, semConfiguracao };
