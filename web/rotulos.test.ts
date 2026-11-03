import { describe, expect, it } from 'bun:test';
import type { Processo } from './api';
import { agruparPorEmpresa, contar, dataBr, filtrarProcessos, nomeDoResponsavel, textoAndamento, type Filtros } from './rotulos';

const processo = (over: Partial<Processo>): Processo => ({
  id: '1',
  numero: null,
  empresaNome: 'Empresa Exemplo Ltda',
  empresaCadastroId: null,
  empresaDocumento: null,
  reclamante: null,
  tipoId: null,
  tipoNome: null,
  etapaId: '1',
  etapaNome: 'Novo',
  prazo: null,
  situacaoPrazo: 'SEM_PRAZO',
  responsavel: null,
  origem: 'MANUAL',
  andamento: null,
  emails: 0,
  novoEmail: false,
  descartadoEm: null,
  descartadoPor: null,
  criadoEm: '2026-10-23T12:00:00Z',
  criadoPor: 'ana@example.com',
  ...over,
});

const SEM: Filtros = { semResponsavel: false, meus: false, novoEmail: false, busca: '' };
const ANA = 'ana@example.com';

const ps = [
  processo({ id: '1', etapaId: '1', numero: '0001234-56.2026.5.04.0001', reclamante: 'José Conceição', situacaoPrazo: 'VENCIDO', responsavel: ANA }),
  processo({ id: '2', etapaId: '2', empresaNome: 'Comércio Modelo S.A.', situacaoPrazo: 'PROXIMO' }),
  processo({ id: '3', etapaId: '2', empresaNome: 'EMPRESA EXEMPLO LTDA', empresaCadastroId: '9', situacaoPrazo: 'NO_PRAZO' }),
];
const ids = (l: Processo[]) => l.map((p) => p.id);

describe('filtrarProcessos', () => {
  it('por aba: etapa, todos e vencendo (vencido + vence logo)', () => {
    expect(ids(filtrarProcessos(ps, { tipo: 'etapa', id: '2' }, SEM, ANA))).toEqual(['2', '3']);
    expect(ids(filtrarProcessos(ps, { tipo: 'todos' }, SEM, ANA))).toEqual(['1', '2', '3']);
    expect(ids(filtrarProcessos(ps, { tipo: 'vencendo' }, SEM, ANA))).toEqual(['1', '2']);
  });
  it('sem responsável e meus processos', () => {
    expect(ids(filtrarProcessos(ps, { tipo: 'todos' }, { ...SEM, semResponsavel: true }, ANA))).toEqual(['2', '3']);
    expect(ids(filtrarProcessos(ps, { tipo: 'todos' }, { ...SEM, meus: true }, ANA))).toEqual(['1']);
    expect(ids(filtrarProcessos(ps, { tipo: 'todos' }, { ...SEM, meus: true }, null))).toEqual([]);
  });
  it('busca sem acento por reclamante, empresa e número com ou sem pontuação', () => {
    const t = { tipo: 'todos' } as const;
    expect(ids(filtrarProcessos(ps, t, { ...SEM, busca: 'conceicao' }, ANA))).toEqual(['1']);
    expect(ids(filtrarProcessos(ps, t, { ...SEM, busca: 'comercio' }, ANA))).toEqual(['2']);
    expect(ids(filtrarProcessos(ps, t, { ...SEM, busca: '00012345620' }, ANA))).toEqual(['1']);
    expect(ids(filtrarProcessos(ps, t, { ...SEM, busca: '1234-56' }, ANA))).toEqual(['1']);
  });
});

describe('agruparPorEmpresa', () => {
  it('junta o mesmo nome sem diferença de maiúsculas; cadastrada se algum estiver vinculado', () => {
    const g = agruparPorEmpresa(ps);
    expect(g.map((x) => [x.empresa, x.cadastrada, ids(x.processos)])).toEqual([
      ['Empresa Exemplo Ltda', true, ['1', '3']],
      ['Comércio Modelo S.A.', false, ['2']],
    ]);
  });
});

describe('rótulos', () => {
  it('nome do responsável, data e contagem', () => {
    expect(nomeDoResponsavel('ana.souza@example.com')).toBe('Ana Souza');
    expect(dataBr('2026-10-30')).toBe('30/10/2026');
    expect(contar(1, 'processo')).toBe('1 processo');
    expect(contar(3, 'processo')).toBe('3 processos');
  });
});

describe('andamento no tribunal', () => {
  const a = { encontrado: true, situacao: 'Liquidação iniciada', situacaoEm: '2026-08-25', ultimaMovimentacao: '2026-09-16', orgao: 'VT', consultadoEm: '2026-10-24T12:00:00Z', erro: null };
  it('situação e data; não consultado e não encontrado ficam apagados', () => {
    expect(textoAndamento(a)).toEqual({ situacao: 'Liquidação iniciada', data: '25/08/2026', apagado: false });
    expect(textoAndamento(null)).toEqual({ situacao: 'Ainda não consultado', data: null, apagado: true });
    expect(textoAndamento({ ...a, consultadoEm: null, encontrado: false, situacao: null, erro: 'DataJud respondeu 503' }).situacao).toBe('Ainda não consultado');
    expect(textoAndamento({ ...a, encontrado: false, situacao: null }).situacao).toBe('Não encontrado no DataJud');
  });
  it('a busca acha pela situação', () => {
    const ps = [processo({ id: '1', andamento: a }), processo({ id: '2' })];
    const f: Filtros = { semResponsavel: false, meus: false, novoEmail: false, busca: 'liquidacao' };
    expect(filtrarProcessos(ps, { tipo: 'todos' }, f, null).map((p) => p.id)).toEqual(['1']);
  });
});

describe('selo novo e-mail', () => {
  it('o filtro mostra só os com e-mail novo', () => {
    const ps = [processo({ id: '1', novoEmail: true, emails: 2 }), processo({ id: '2', emails: 1 })];
    expect(filtrarProcessos(ps, { tipo: 'todos' }, { ...SEM, novoEmail: true }, null).map((p) => p.id)).toEqual(['1']);
    expect(filtrarProcessos(ps, { tipo: 'todos' }, SEM, null)).toHaveLength(2);
  });
});
