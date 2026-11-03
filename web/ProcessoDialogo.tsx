import { ExternalLink, Landmark, Loader2, Mail, Paperclip } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { cn } from '../../lib/cn';
import { Dialogo } from '../importacao-xml/Dialogo';
import {
  alterarProcesso,
  buscarEmpresas,
  criarProcesso,
  descartarProcesso,
  marcarVisto,
  restaurarProcesso,
  useHistorico,
  useLinhaDoTempo,
  type Andamento,
  type DadosProcesso,
  type EmpresaSugestao,
  type ItemLista,
  type Processo,
} from './api';
import { dataBr, nomeDoResponsavel, textoAndamento } from './rotulos';

const CAMPO =
  'h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent-strong))]';

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Form = {
  numero: string;
  empresaNome: string;
  empresaCadastroId: string | null;
  empresaDocumento: string | null;
  reclamante: string;
  tipoId: string;
  etapaId: string;
  prazo: string;
  responsavel: string;
};

const formDe = (p: Processo | null, etapaInicial: string): Form => ({
  numero: p?.numero ?? '',
  empresaNome: p?.empresaNome ?? '',
  empresaCadastroId: p?.empresaCadastroId ?? null,
  empresaDocumento: p?.empresaDocumento ?? null,
  reclamante: p?.reclamante ?? '',
  tipoId: p?.tipoId ?? '',
  etapaId: p?.etapaId ?? etapaInicial,
  prazo: p?.prazo ?? '',
  responsavel: p?.responsavel ?? '',
});

/** Form → dados da API; na alteração, só o que mudou. Campo vazio vira null (limpa). */
const dadosDe = (f: Form, original: Form | null): DadosProcesso => {
  const valores: DadosProcesso = {
    numero: f.numero.trim() || null,
    empresaNome: f.empresaNome,
    empresaCadastroId: f.empresaCadastroId,
    empresaDocumento: f.empresaDocumento,
    reclamante: f.reclamante.trim() || null,
    tipoId: f.tipoId || null,
    etapaId: f.etapaId,
    prazo: f.prazo || null,
    responsavel: f.responsavel.trim() || null,
  };
  if (!original) return valores;
  const antes = dadosDe(original, null);
  return Object.fromEntries(
    Object.entries(valores).filter(([k, v]) => antes[k as keyof DadosProcesso] !== v),
  ) as DadosProcesso;
};

/** Campo de empresa: sugere as do cadastro central; digitar à mão desfaz o vínculo ("não cadastrada"). */
const CampoEmpresa = ({ form, setForm }: { form: Form; setForm: (f: Form) => void }) => {
  const [sugestoes, setSugestoes] = useState<EmpresaSugestao[]>([]);
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (!aberto || form.empresaCadastroId || form.empresaNome.trim().length < 2) {
      setSugestoes([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      buscarEmpresas(form.empresaNome, ctrl.signal).then(setSugestoes).catch(() => setSugestoes([]));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [form.empresaNome, form.empresaCadastroId, aberto]);

  return (
    <label className="relative block space-y-1 sm:col-span-2">
      <span className="text-xs font-medium text-muted-foreground">Empresa (reclamada) *</span>
      <input
        className={CAMPO}
        value={form.empresaNome}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onChange={(e) => setForm({ ...form, empresaNome: e.target.value, empresaCadastroId: null, empresaDocumento: null })}
        placeholder="Nome, sigla ou CNPJ"
        autoComplete="off"
      />
      {aberto && sugestoes.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg">
          {sugestoes.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-background"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setForm({ ...form, empresaNome: s.nome, empresaCadastroId: s.id, empresaDocumento: s.documento });
                  setAberto(false);
                }}
              >
                {s.sigla && <span className="font-semibold text-foreground">{s.sigla}</span>}
                <span className="text-body">{s.nome}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="block text-[12px] text-muted-foreground">
        {form.empresaCadastroId
          ? 'Vinculada ao cadastro de empresas.'
          : form.empresaNome.trim()
            ? 'Não cadastrada — fica com o nome como está. Escolha uma sugestão para vincular.'
            : ' '}
      </span>
    </label>
  );
};

const Historico = ({ id, recarga }: { id: string; recarga: number }) => {
  const estado = useHistorico(id, recarga);
  if (estado.tipo !== 'pronto') return <p className="text-muted-foreground">{estado.tipo === 'erro' ? estado.mensagem : 'Carregando…'}</p>;
  return (
    <ol className="space-y-2">
      {estado.dados.map((e, i) => (
        <li key={i} className="text-[13px]">
          <span className="text-muted-foreground">
            {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(e.em))} ·{' '}
            {e.autor.includes('@') ? nomeDoResponsavel(e.autor) : e.autor}
          </span>{' '}
          {e.acao === 'INSERT' ? (
            <span className="text-body">cadastrou o processo</span>
          ) : (
            <span className="text-body">
              {e.mudancas
                .map((m) =>
                  m.campo === 'Descartado'
                    ? m.depois
                      ? 'marcou como “não é processo”'
                      : 'restaurou dos descartados'
                    : `${m.campo}: ${m.antes ? (m.campo === 'Prazo' ? dataBr(m.antes) : m.antes) : '—'} → ${
                        m.depois ? (m.campo === 'Prazo' ? dataBr(m.depois) : m.depois) : '—'
                      }`,
                )
                .join(' · ')}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
};

const dataHoraBr = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

/** Só leitura: vem do DataJud (CNJ), uma consulta por semana. Não muda a etapa, que é do DP. */
const AndamentoTribunal = ({ andamento }: { andamento: Andamento | null }) => {
  const a = textoAndamento(andamento);
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-3 text-[13px]">
      <p className="flex items-start gap-2">
        <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          <span className={cn('font-semibold', a.apagado ? 'text-muted-foreground' : 'text-foreground')}>{a.situacao}</span>
          {a.data && <span className="text-muted-foreground"> · {a.data}</span>}
          {andamento?.orgao && <span className="block text-body">{andamento.orgao}</span>}
          {andamento?.ultimaMovimentacao && (
            <span className="block text-muted-foreground">Última movimentação: {dataBr(andamento.ultimaMovimentacao)}</span>
          )}
        </span>
      </p>
      <p className="mt-2 text-[12px] text-muted-foreground">
        {andamento?.consultadoEm ? `Consultado no DataJud (CNJ) em ${dataHoraBr(andamento.consultadoEm)}. ` : ''}
        Atualiza sozinho uma vez por semana; os tribunais mandam as movimentações ao DataJud com algumas semanas de atraso.
        {andamento?.erro && <span className="block text-amber-800">Última tentativa falhou: {andamento.erro}</span>}
      </p>
    </div>
  );
};

/**
 * Linha do tempo dos e-mails. Ao carregar, se havia e-mail novo, tira o selo do processo (para todos) — os e-mails
 * novos continuam marcados nesta abertura.
 */
const LinhaDoTempo = ({ processo, onVisto }: { processo: Processo; onVisto: () => void }) => {
  const estado = useLinhaDoTempo(processo.id);
  const emails = estado.tipo === 'pronto' ? estado.dados : null;
  useEffect(() => {
    if (emails?.some((e) => e.novo)) void marcarVisto(processo.id).then(onVisto, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails]);
  if (estado.tipo !== 'pronto') return <p className="text-[13px] text-muted-foreground">{estado.tipo === 'erro' ? estado.mensagem : 'Carregando…'}</p>;
  if (estado.dados.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-[13px] text-muted-foreground">
        <Mail className="h-4 w-4 shrink-0" aria-hidden />
        {processo.origem === 'MANUAL'
          ? 'Cadastrado à mão. Quando chegar e-mail com o número deste processo numa caixa conectada, ele aparece aqui.'
          : 'Nenhum e-mail ainda. O robô lê as caixas conectadas de hora em hora.'}
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {estado.dados.map((e) => (
        <li key={e.id} className={cn('rounded-xl border px-3 py-2 text-[13px]', e.novo ? 'border-sky-300 bg-sky-50' : 'border-border bg-background')}>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="tabular-nums text-muted-foreground">{dataHoraBr(e.recebidoEm)}</span>
            <span className="font-semibold text-foreground">{e.deNome ?? e.deEmail ?? '—'}</span>
            {e.novo && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900">novo</span>}
            {e.link && (
              <a href={e.link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-accent-strong hover:underline">
                Abrir no Outlook
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </p>
          <p className="mt-0.5 font-medium text-foreground">{e.assunto || '(sem assunto)'}</p>
          {e.resumo && <p className="mt-1 line-clamp-4 whitespace-pre-line text-body">{e.resumo}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
            {e.anexos.length > 0 ? (
              e.anexos.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-body">
                  <Paperclip className="h-3 w-3" aria-hidden />
                  {a}
                </span>
              ))
            ) : (
              <span>Sem anexos</span>
            )}
            <span className="ml-auto">
              {e.caixa} · {e.pasta}
            </span>
          </p>
        </li>
      ))}
    </ol>
  );
};

/** Cadastro (sem `processo`) ou edição de um processo, com a linha do tempo e o histórico. */
export const ProcessoDialogo = ({
  processo,
  etapas,
  tipos,
  responsaveis,
  eu,
  onFechar,
  onSalvo,
  onVisto,
}: {
  processo: Processo | null;
  etapas: ItemLista[];
  tipos: ItemLista[];
  responsaveis: string[];
  eu: string | null;
  onFechar: () => void;
  onSalvo: (p: Processo) => void;
  /** tirou o selo "novo e-mail": a lista recarrega */
  onVisto?: () => void;
}) => {
  const original = processo ? formDe(processo, '') : null;
  const [form, setForm] = useState<Form>(() => formDe(processo, etapas[0]?.id ?? ''));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const descartado = processo?.descartadoEm != null;
  const etapaRemovida = processo && !etapas.some((e) => e.id === processo.etapaId);

  const executar = async (fn: () => Promise<Processo>, fechar: boolean) => {
    setSalvando(true);
    setErro(null);
    try {
      const p = await fn();
      onSalvo(p);
      if (fechar) onFechar();
      else setRecarga((r) => r + 1);
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setSalvando(false);
    }
  };

  const salvar = () => {
    if (!form.empresaNome.trim()) {
      setErro('Informe a empresa.');
      return;
    }
    const dados = dadosDe(form, original);
    if (processo && Object.keys(dados).length === 0) return onFechar();
    void executar(() => (processo ? alterarProcesso(processo.id, dados) : criarProcesso(dados)), true);
  };

  return (
    <Dialogo
      largura="max-w-3xl"
      onFechar={onFechar}
      titulo={processo ? (processo.numero ?? 'Processo sem número') : 'Novo processo'}
      rodape={
        <>
          {processo && !descartado && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-red-700"
              disabled={salvando}
              onClick={() => void executar(() => descartarProcesso(processo.id), true)}
            >
              Não é processo
            </Button>
          )}
          {processo && descartado && (
            <Button variant="outline" size="sm" className="mr-auto" disabled={salvando} onClick={() => void executar(() => restaurarProcesso(processo.id), true)}>
              Restaurar
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          {!descartado && (
            <Button size="sm" onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {processo ? 'Salvar' : 'Cadastrar'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {erro && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {erro}
          </p>
        )}
        {descartado && (
          <p className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-body">
            Marcado como “não é processo” por {nomeDoResponsavel(processo!.descartadoPor ?? '')}. Restaure para voltar a editar.
          </p>
        )}

        <fieldset disabled={descartado} className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Número do processo</span>
            <input
              className={cn(CAMPO, 'tabular-nums')}
              value={form.numero}
              onChange={(e) => setForm({ ...form, numero: e.target.value })}
              placeholder="0000000-00.0000.5.00.0000"
              inputMode="numeric"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Reclamante</span>
            <input className={CAMPO} value={form.reclamante} onChange={(e) => setForm({ ...form, reclamante: e.target.value })} />
          </label>
          <CampoEmpresa form={form} setForm={setForm} />
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Tipo de processo</span>
            <select aria-label="Tipo de processo" className={CAMPO} value={form.tipoId} onChange={(e) => setForm({ ...form, tipoId: e.target.value })}>
              <option value="">—</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
              {processo?.tipoId && !tipos.some((t) => t.id === processo.tipoId) && (
                <option value={processo.tipoId}>{processo.tipoNome} (removido)</option>
              )}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Etapa</span>
            <select aria-label="Etapa" className={CAMPO} value={form.etapaId} onChange={(e) => setForm({ ...form, etapaId: e.target.value })}>
              {etapas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
              {etapaRemovida && <option value={processo.etapaId}>{processo.etapaNome} (removida)</option>}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Prazo</span>
            <input type="date" className={CAMPO} value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="flex items-baseline justify-between text-xs font-medium text-muted-foreground">
              Responsável
              {eu && form.responsavel !== eu && (
                <button type="button" className="font-semibold text-accent-strong hover:underline" onClick={() => setForm({ ...form, responsavel: eu })}>
                  Atribuir a mim
                </button>
              )}
            </span>
            <input
              type="email"
              list="dp-processos-responsaveis"
              className={CAMPO}
              value={form.responsavel}
              onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
              placeholder="nome@example.com"
            />
            <datalist id="dp-processos-responsaveis">
              {responsaveis.map((r) => (
                <option key={r} value={r}>
                  {nomeDoResponsavel(r)}
                </option>
              ))}
            </datalist>
          </label>
        </fieldset>

        {processo && (
          <>
            {processo.numero && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Andamento no tribunal</h3>
                <AndamentoTribunal andamento={processo.andamento} />
              </section>
            )}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linha do tempo dos e-mails</h3>
              <LinhaDoTempo processo={processo} onVisto={() => onVisto?.()} />
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h3>
              <Historico id={processo.id} recarga={recarga} />
            </section>
          </>
        )}
      </div>
    </Dialogo>
  );
};
