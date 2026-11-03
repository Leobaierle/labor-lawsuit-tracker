import { EntradaInvalida, textoObrigatorio } from "./dominio.ts";
import type { Executor, ProcessosPool } from "./pgClient.ts";
import { withTransaction } from "./pgClient.ts";

/** As duas listas que o DP edita pelo site: etapas (as abas) e tipos de processo. */
export type Lista = "ETAPA" | "TIPO";

export type ItemLista = {
  id: number;
  nome: string;
  ordem: number;
  /** só etapa: processos nela não contam prazo */
  encerra: boolean;
  /** processos não descartados com este item */
  processos: number;
};

const TABELA: Record<Lista, { tabela: "etapa" | "tipo"; coluna: "etapa_id" | "tipo_id"; nome: string }> = {
  ETAPA: { tabela: "etapa", coluna: "etapa_id", nome: "etapa" },
  TIPO: { tabela: "tipo", coluna: "tipo_id", nome: "tipo" },
};

export const listarItens = async (db: Executor, lista: Lista): Promise<ItemLista[]> => {
  const t = TABELA[lista];
  const { rows } = await db.query(
    `SELECT i.id, i.nome, i.ordem, ${lista === "ETAPA" ? "i.encerra" : "false"} AS encerra,
            (SELECT count(*) FROM dp_processos_trabalhistas.processo p
              WHERE p.${t.coluna} = i.id AND p.descartado_em IS NULL)::int AS processos
       FROM dp_processos_trabalhistas.${t.tabela} i
      WHERE i.arquivada_em IS NULL
      ORDER BY i.ordem, i.id`,
  );
  return rows.map((r) => ({ id: Number(r.id), nome: r.nome, ordem: r.ordem, encerra: r.encerra, processos: r.processos }));
};

const nomeRepetido = (e: unknown, lista: Lista, nome: string): never => {
  if ((e as { code?: string }).code === "23505") throw new EntradaInvalida(`Já existe ${TABELA[lista].nome} "${nome}"`);
  throw e;
};

const exigirItem = async (db: Executor, lista: Lista, id: number) => {
  const { rows } = await db.query(
    `SELECT id, ordem FROM dp_processos_trabalhistas.${TABELA[lista].tabela} WHERE id = $1 AND arquivada_em IS NULL FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new EntradaInvalida(`${TABELA[lista].nome} ${id} não existe (ou foi removida)`);
  return { id: Number(rows[0].id), ordem: rows[0].ordem as number };
};

/** Etapa nova entra antes da primeira que encerra (ex.: antes de "Encerrado"); tipo novo vai para o fim. */
export const criarItem = async (pool: ProcessosPool, autor: string, lista: Lista, nome: string): Promise<ItemLista[]> =>
  withTransaction(pool, autor, async (c) => {
    const n = textoObrigatorio("Nome", nome, 60);
    const t = TABELA[lista].tabela;
    await c.query(`LOCK TABLE ${t} IN SHARE ROW EXCLUSIVE MODE`);
    const { rows } = await c.query(
      lista === "ETAPA"
        ? `SELECT COALESCE(min(ordem) FILTER (WHERE encerra), max(ordem) + 1, 1) AS ordem FROM etapa WHERE arquivada_em IS NULL`
        : `SELECT COALESCE(max(ordem) + 1, 1) AS ordem FROM tipo WHERE arquivada_em IS NULL`,
    );
    const ordem = rows[0].ordem as number;
    await c.query(`UPDATE ${t} SET ordem = ordem + 1 WHERE arquivada_em IS NULL AND ordem >= $1`, [ordem]);
    await c.query(`INSERT INTO ${t} (nome, ordem) VALUES ($1, $2)`, [n, ordem]).catch((e) => nomeRepetido(e, lista, n));
    return listarItens(c, lista);
  });

export const renomearItem = async (pool: ProcessosPool, autor: string, lista: Lista, id: number, nome: string): Promise<ItemLista[]> =>
  withTransaction(pool, autor, async (c) => {
    const n = textoObrigatorio("Nome", nome, 60);
    await exigirItem(c, lista, id);
    await c.query(`UPDATE ${TABELA[lista].tabela} SET nome = $2 WHERE id = $1`, [id, n]).catch((e) => nomeRepetido(e, lista, n));
    return listarItens(c, lista);
  });

/** Troca de lugar com o vizinho de cima (-1) ou de baixo (+1); na ponta, não faz nada. */
export const moverItem = async (pool: ProcessosPool, autor: string, lista: Lista, id: number, direcao: -1 | 1): Promise<ItemLista[]> =>
  withTransaction(pool, autor, async (c) => {
    const t = TABELA[lista].tabela;
    await c.query(`LOCK TABLE ${t} IN SHARE ROW EXCLUSIVE MODE`);
    const itens = await listarItens(c, lista);
    const i = itens.findIndex((x) => x.id === id);
    if (i < 0) throw new EntradaInvalida(`${TABELA[lista].nome} ${id} não existe (ou foi removida)`);
    const vizinho = itens[i + direcao];
    if (!vizinho) return itens;
    // renumera tudo na ordem nova: ordens repetidas ou com buracos se resolvem aqui
    const nova = itens.map((x) => x.id);
    [nova[i], nova[i + direcao]] = [vizinho.id, id];
    await c.query(
      `UPDATE ${t} SET ordem = v.ordem FROM unnest($1::bigint[]) WITH ORDINALITY AS v(id, ordem) WHERE ${t}.id = v.id`,
      [nova],
    );
    return listarItens(c, lista);
  });

/** Remove da tela (arquiva). Só sem processos nela; e sempre sobra ao menos uma etapa. */
export const arquivarItem = async (pool: ProcessosPool, autor: string, lista: Lista, id: number): Promise<ItemLista[]> =>
  withTransaction(pool, autor, async (c) => {
    await exigirItem(c, lista, id);
    const itens = await listarItens(c, lista);
    const item = itens.find((x) => x.id === id)!;
    if (item.processos > 0) {
      throw new EntradaInvalida(
        `"${item.nome}" tem ${item.processos} processo${item.processos > 1 ? "s" : ""} — mude ${item.processos > 1 ? "eles" : "ele"} antes de remover`,
      );
    }
    if (lista === "ETAPA" && itens.length === 1) throw new EntradaInvalida("Precisa sobrar ao menos uma etapa");
    await c.query(`UPDATE ${TABELA[lista].tabela} SET arquivada_em = now() WHERE id = $1`, [id]);
    return listarItens(c, lista);
  });
