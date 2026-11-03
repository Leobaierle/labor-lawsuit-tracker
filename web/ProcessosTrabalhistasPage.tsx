import { Mail, Plus, Search, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { cn } from '../../lib/cn';
import { usePainel, type ItemLista, type Painel, type Processo } from './api';
import { EmailDialogo } from './EmailDialogo';
import { ListasDialogo } from './ListasDialogo';
import { ProcessoDialogo } from './ProcessoDialogo';
import { pegarRetorno } from './retornoEmail';
import {
  agruparPorEmpresa,
  contar,
  COR_PRAZO,
  dataBr,
  filtrarProcessos,
  nomeDoResponsavel,
  TEXTO_PRAZO,
  textoAndamento,
  type Aba,
  type Filtros,
} from './rotulos';

const CAMPO =
  'h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent-strong))]';

const mesmaAba = (a: Aba, b: Aba) => a.tipo === b.tipo && (a.tipo !== 'etapa' || a.id === (b as { id: string }).id);

const BotaoAba = ({ ativa, onClick, children, alerta }: { ativa: boolean; onClick: () => void; children: React.ReactNode; alerta?: boolean }) => (
  <button
    type="button"
    role="tab"
    aria-selected={ativa}
    onClick={onClick}
    className={cn(
      '-mb-px flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors',
      ativa ? 'border-accent-strong text-accent-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      alerta && !ativa && 'text-red-700',
    )}
  >
    {children}
  </button>
);

const Contagem = ({ n }: { n: number }) => (
  <span className="rounded-full bg-background px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{n}</span>
);

const Filtro = ({ ligado, onClick, children }: { ligado: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    aria-pressed={ligado}
    onClick={onClick}
    className={cn(
      'h-10 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors',
      ligado ? 'border-accent-strong bg-accent text-accent-foreground' : 'border-border bg-card text-body hover:bg-background',
    )}
  >
    {children}
  </button>
);

const CelulaAndamento = ({ p }: { p: Processo }) => {
  const a = textoAndamento(p.andamento);
  return (
    <td className="px-4 py-2" title={p.andamento?.orgao ?? undefined}>
      <span className={cn('block truncate', a.apagado ? 'text-muted-foreground' : 'text-body')}>{a.situacao}</span>
      {a.data && <span className="block text-[12px] tabular-nums text-muted-foreground">{a.data}</span>}
    </td>
  );
};

const Tabela = ({ processos, mostrarEtapa, onAbrir }: { processos: Processo[]; mostrarEtapa: boolean; onAbrir: (p: Processo) => void }) => (
  <div className="space-y-4">
    {agruparPorEmpresa(processos).map((g) => (
      <section key={g.empresa} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border bg-background px-4 py-2">
          <h2 className="text-sm font-semibold text-foreground">{g.empresa}</h2>
          {!g.cadastrada && <span className="text-[12px] text-muted-foreground">não cadastrada</span>}
          <span className="ml-auto text-[12px] text-muted-foreground">{contar(g.processos.length, 'processo')}</span>
        </header>
        <div className="overflow-x-auto">
          {/* larguras fixas + pelo menos 10rem para o reclamante: abaixo disso a tabela rola na horizontal */}
          <table className={cn('w-full table-fixed text-sm', mostrarEtapa ? 'min-w-[1100px]' : 'min-w-[930px]')}>
            <colgroup>
              <col className="w-[14.5rem]" />
              <col />
              {mostrarEtapa && <col className="w-[11rem]" />}
              <col className="w-[13.5rem]" />
              <col className="w-[10rem]" />
              <col className="w-[10rem]" />
            </colgroup>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-semibold">Nº do processo</th>
                <th className="px-4 py-2 font-semibold">Reclamante e tipo</th>
                {mostrarEtapa && <th className="px-4 py-2 font-semibold">Etapa</th>}
                <th className="px-4 py-2 font-semibold">Andamento no tribunal</th>
                <th className="px-4 py-2 font-semibold">Prazo</th>
                <th className="px-4 py-2 font-semibold">Responsável</th>
              </tr>
            </thead>
            <tbody>
              {g.processos.map((p) => (
                <tr
                  key={p.id}
                  tabIndex={0}
                  onClick={() => onAbrir(p)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onAbrir(p))}
                  className="cursor-pointer border-t border-border hover:bg-background focus-visible:bg-background focus-visible:outline-none"
                >
                  <td className="whitespace-nowrap px-4 py-2 font-medium tabular-nums text-foreground">
                    {p.numero ?? <span className="text-muted-foreground">sem número</span>}
                    {p.novoEmail && (
                      <span className="mt-0.5 block w-fit rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900">novo e-mail</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="block truncate text-body">{p.reclamante ?? '—'}</span>
                    {p.tipoNome && <span className="block truncate text-[12px] text-muted-foreground">{p.tipoNome}</span>}
                  </td>
                  {mostrarEtapa && <td className="px-4 py-2 text-body">{p.etapaNome}</td>}
                  <CelulaAndamento p={p} />
                  <td className={cn('whitespace-nowrap px-4 py-2 tabular-nums', COR_PRAZO[p.situacaoPrazo])}>
                    {p.prazo ? dataBr(p.prazo) : '—'}
                    {TEXTO_PRAZO[p.situacaoPrazo] && <span className="ml-1.5 text-[12px]">{TEXTO_PRAZO[p.situacaoPrazo]}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {p.responsavel ? (
                      <span className="text-body">{nomeDoResponsavel(p.responsavel)}</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[12px] font-semibold text-amber-900">Sem responsável</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ))}
  </div>
);

const Vazio = ({ children }: { children: React.ReactNode }) => (
  <section className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{children}</section>
);

const Conteudo = ({
  painel,
  descartados,
  aba,
  filtros,
  onAbrir,
}: {
  painel: Painel;
  descartados: Processo[] | null;
  aba: Aba;
  filtros: Filtros;
  onAbrir: (p: Processo) => void;
}) => {
  const base = aba.tipo === 'descartados' ? (descartados ?? []) : painel.processos;
  const lista = filtrarProcessos(base, aba, filtros, painel.eu);
  if (aba.tipo === 'descartados' && !descartados) return <div aria-busy="true" className="h-40 animate-pulse rounded-xl border border-border bg-card" />;
  if (lista.length === 0) {
    const filtrando = filtros.busca.trim() || filtros.meus || filtros.semResponsavel || filtros.novoEmail;
    return (
      <Vazio>
        {filtrando
          ? 'Nenhum processo com esses filtros.'
          : aba.tipo === 'descartados'
            ? 'Nenhum processo descartado.'
            : aba.tipo === 'vencendo'
              ? 'Nenhum prazo vencido ou vencendo nos próximos 3 dias úteis.'
              : 'Nenhum processo aqui.'}
      </Vazio>
    );
  }
  return <Tabela processos={lista} mostrarEtapa={aba.tipo !== 'etapa'} onAbrir={onAbrir} />;
};

export const ProcessosTrabalhistasPage = () => {
  const [recarga, setRecarga] = useState(0);
  const estado = usePainel(false, recarga);
  const [aba, setAba] = useState<Aba | null>(null);
  const descartadosEstado = usePainel(true, recarga, aba?.tipo === 'descartados');
  const [filtros, setFiltros] = useState<Filtros>({ semResponsavel: false, meus: false, novoEmail: false, busca: '' });
  const [aberto, setAberto] = useState<Processo | 'novo' | null>(null);
  const [listas, setListas] = useState(false);
  // volta do login da Microsoft ("Conectar meu e-mail"): abre as caixas para concluir
  const [retornoEmail, setRetornoEmail] = useState(pegarRetorno);
  const [caixas, setCaixas] = useState(retornoEmail != null);

  const painel = estado.tipo === 'pronto' ? estado.dados : null;
  const abaAtual: Aba = aba ?? (painel?.etapas[0] ? { tipo: 'etapa', id: painel.etapas[0].id } : { tipo: 'todos' });
  const recarregar = () => setRecarga((r) => r + 1);

  const contagens = useMemo(() => {
    const porEtapa = new Map<string, number>();
    let vencendo = 0;
    let novoEmail = 0;
    for (const p of painel?.processos ?? []) {
      porEtapa.set(p.etapaId, (porEtapa.get(p.etapaId) ?? 0) + 1);
      if (p.situacaoPrazo === 'VENCIDO' || p.situacaoPrazo === 'PROXIMO') vencendo++;
      if (p.novoEmail) novoEmail++;
    }
    return { porEtapa, vencendo, novoEmail };
  }, [painel]);

  const descartados = descartadosEstado.tipo === 'pronto' && aba?.tipo === 'descartados' ? descartadosEstado.dados.processos : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Trabalhista</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Processos trabalhistas</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-body">
            Um processo por linha, agrupado por empresa. Etapa, prazo, tipo e responsável são do DP. O robô lê as caixas conectadas
            de hora em hora: e-mail com número de processo entra na linha do tempo, e número novo vira processo em “Novo”.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setCaixas(true)}>
            <Mail className="h-4 w-4" aria-hidden />
            Caixas de e-mail
          </Button>
          <Button variant="outline" size="sm" onClick={() => setListas(true)} disabled={!painel}>
            <Settings2 className="h-4 w-4" aria-hidden />
            Etapas e tipos
          </Button>
          <Button size="sm" onClick={() => setAberto('novo')} disabled={!painel}>
            <Plus className="h-4 w-4" aria-hidden />
            Novo processo
          </Button>
        </div>
      </div>

      {estado.tipo === 'carregando' && (
        <div aria-busy="true" aria-label="Carregando os processos" className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      )}

      {estado.tipo === 'erro' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <p className="font-semibold">Não foi possível carregar os processos.</p>
          <p className="mt-1">{estado.mensagem}</p>
        </div>
      )}

      {painel && (
        <>
          <div role="tablist" aria-label="Abas dos processos" className="flex gap-x-1 overflow-x-auto border-b border-border lg:flex-wrap lg:overflow-visible">
            {painel.etapas.map((e: ItemLista) => (
              <BotaoAba key={e.id} ativa={mesmaAba(abaAtual, { tipo: 'etapa', id: e.id })} onClick={() => setAba({ tipo: 'etapa', id: e.id })}>
                {e.nome}
                <Contagem n={contagens.porEtapa.get(e.id) ?? 0} />
              </BotaoAba>
            ))}
            <span className="mx-1 my-3 w-px shrink-0 bg-border" aria-hidden />
            <BotaoAba ativa={abaAtual.tipo === 'todos'} onClick={() => setAba({ tipo: 'todos' })}>
              Todos
              <Contagem n={painel.processos.length} />
            </BotaoAba>
            <BotaoAba ativa={abaAtual.tipo === 'vencendo'} onClick={() => setAba({ tipo: 'vencendo' })} alerta={contagens.vencendo > 0}>
              Vencendo
              <Contagem n={contagens.vencendo} />
            </BotaoAba>
            <BotaoAba ativa={abaAtual.tipo === 'descartados'} onClick={() => setAba({ tipo: 'descartados' })}>
              Descartados
            </BotaoAba>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <span className="sr-only">Buscar processo</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                className={cn(CAMPO, 'pl-9')}
                placeholder="Buscar por número, empresa ou reclamante"
                value={filtros.busca}
                onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
              />
            </label>
            <Filtro ligado={filtros.semResponsavel} onClick={() => setFiltros({ ...filtros, semResponsavel: !filtros.semResponsavel, meus: false })}>
              Sem responsável
            </Filtro>
            <Filtro ligado={filtros.meus} onClick={() => setFiltros({ ...filtros, meus: !filtros.meus, semResponsavel: false })}>
              Meus processos
            </Filtro>
            <Filtro ligado={filtros.novoEmail} onClick={() => setFiltros({ ...filtros, novoEmail: !filtros.novoEmail })}>
              Novo e-mail{contagens.novoEmail > 0 && ` (${contagens.novoEmail})`}
            </Filtro>
          </div>

          {descartadosEstado.tipo === 'erro' && aba?.tipo === 'descartados' ? (
            <p className="text-sm text-red-800">{descartadosEstado.mensagem}</p>
          ) : (
            <Conteudo painel={painel} descartados={descartados} aba={abaAtual} filtros={filtros} onAbrir={setAberto} />
          )}

          {aberto && (
            <ProcessoDialogo
              key={aberto === 'novo' ? 'novo' : aberto.id}
              processo={aberto === 'novo' ? null : aberto}
              etapas={painel.etapas}
              tipos={painel.tipos}
              responsaveis={painel.responsaveis}
              eu={painel.eu}
              onFechar={() => setAberto(null)}
              onSalvo={recarregar}
              onVisto={recarregar}
            />
          )}
          {listas && <ListasDialogo etapas={painel.etapas} tipos={painel.tipos} onFechar={() => setListas(false)} onAlteradas={recarregar} />}
        </>
      )}
      {caixas && (
        <EmailDialogo
          eu={painel?.eu ?? null}
          retorno={retornoEmail}
          onFechar={() => {
            setCaixas(false);
            setRetornoEmail(null); // o código da Microsoft vale uma vez só
          }}
        />
      )}
    </div>
  );
};
