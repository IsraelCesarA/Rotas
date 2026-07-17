const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'db.kzuigeqiajplvnyilppu.supabase.co',
  database: 'postgres',
  password: 'Monitoramento2026',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

async function criarTabelaFaltante() {
  try {
    console.log("Criando tabela alocacao_frota no Supabase...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alocacao_frota (
        id_linha INTEGER,
        data_alocacao VARCHAR(20),
        hora_saida_prog VARCHAR(10),
        veiculo_alocado VARCHAR(50),
        hora_saida_real VARCHAR(10),
        situacao VARCHAR(50)
      );
    `);
    console.log("✅ Sucesso! Tabela criada. A sua API do Vercel vai voltar a funcionar agora mesmo!");
  } catch (error) {
    console.error("❌ Erro:", error.message);
  } finally {
    pool.end();
  }
}

criarTabelaFaltante();
