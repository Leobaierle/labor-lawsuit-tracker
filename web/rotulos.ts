import type { Andamento, Processo, SituacaoPrazo } from './api';

/** Aba da tela: uma etapa (pelo id) ou uma das visões fixas. */
export type Aba = { tipo: 'etapa'; id: string } | { tipo: 'todos' } | { tipo: 'vencendo' } | { tipo: 'descartados' };

export type Filtros = { semResponsavel: boolean; meus: boolean; novoEmail: boolean; busca: string };

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Processos da aba, com os filtros do topo. A busca olha número (com ou sem pontuação), empresa, reclamante e o
 * andamento no tribunal.
 */
export const filtrarProcessos = (processos: Processo[], aba: Aba, f: Filtros, eu: string | null): Processo[] => {
  const termo = semAcento(f.busca.trim());
  const digitos = f.busca.replace(/\D/g, '');
  return processos.filter((p) => {
    if (aba.tipo === 'etapa' && p.etapaId !== aba.id) return false;
    if (aba.tipo === 'vencendo' && p.situacaoPrazo !== 'VENCIDO' && p.situacaoPrazo !== 'PROXIMO') return false;
    if (f.semResponsavel && p.responsavel) return false;
    if (f.meus && (!eu || p.responsavel !== eu)) return false;
    if (f.novoEmail && !p.novoEmail) return false;
    if (!termo) return true;
    return (
      semAcento(p.empresaNome).includes(termo) ||
      semAcento(p.reclamante ?? '').includes(termo) ||
      semAcento(p.andamento?.situacao ?? '').includes(termo) ||
      (p.numero ?? '').includes(f.busca.trim()) ||
      (digitos.length >= 4 && (p.numero ?? '').replace(/\D/g, '').includes(digitos))
    );
  });
};

/** Agrupa por empresa (mesmo nome, sem diferença de maiúsculas e acentos), na ordem em que vieram. */
export const agruparPorEmpresa = (processos: Processo[]) => {
  const grupos = new Map<string, { empresa: string; cadastrada: boolean; processos: Processo[] }>();
  for (const p of processos) {
    const chave = semAcento(p.empresaNome);
    const g = grupos.get(chave) ?? { empresa: p.empresaNome, cadastrada: false, processos: [] };
    g.processos.push(p);
    g.cadastrada ||= p.empresaCadastroId != null;
    grupos.set(chave, g);
  }
  return [...grupos.values()];
};

/** "ana.souza@example.com" → "Ana Souza". */
export const nomeDoResponsavel = (email: string) =>
  email
    .split('@')[0]!
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(' ');

/** "2026-10-30" → "30/10/2026". */
export const dataBr = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

export const TEXTO_PRAZO: Record<SituacaoPrazo, string> = {
  SEM_PRAZO: '',
  VENCIDO: 'vencido',
  PROXIMO: 'vence logo',
  NO_PRAZO: '',
};

export const COR_PRAZO: Record<SituacaoPrazo, string> = {
  SEM_PRAZO: 'text-muted-foreground',
  VENCIDO: 'font-semibold text-red-700',
  PROXIMO: 'font-semibold text-amber-700',
  NO_PRAZO: 'text-body',
};

/** "123" processos → "123 processos"; 1 → "1 processo". */
export const contar = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

/** Andamento no tribunal em uma linha: situação e a data do movimento que a definiu. */
export const textoAndamento = (a: Andamento | null): { situacao: string; data: string | null; apagado: boolean } => {
  if (!a || (a.consultadoEm == null && a.erro)) return { situacao: 'Ainda não consultado', data: null, apagado: true };
  if (!a.encontrado) return { situacao: 'Não encontrado no DataJud', data: null, apagado: true };
  return { situacao: a.situacao ?? '—', data: a.situacaoEm ? dataBr(a.situacaoEm) : null, apagado: false };
};
