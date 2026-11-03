import { CheckCircle2, Inbox, Mail, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { cn } from '../../lib/cn';
import { Dialogo } from '../importacao-xml/Dialogo';
import {
  adicionarCompartilhada,
  concluirConexaoEmail,
  desconectarEmail,
  iniciarConexaoEmail,
  removerCompartilhada,
  testarConexaoEmail,
  usePainelEmail,
  type ConexaoEmail,
  type LeituraCaixa,
} from './api';
import type { RetornoEmail } from './retornoEmail';
import { contar, nomeDoResponsavel } from './rotulos';

const CAMPO =
  'h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent-strong))]';

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const quando = (iso: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

type Aviso = { tom: 'ok' | 'erro'; texto: string };

/** Situação de uma caixa: lendo (com o total da Caixa de Entrada) ou o erro, e a última passada do robô. */
const Situacao = ({
  total,
  erro,
  testadoEm,
  leitura,
}: {
  total: number | null;
  erro: string | null;
  testadoEm: string | null;
  leitura: LeituraCaixa | undefined;
}) => (
  <>
    {erro ? (
      <p className="text-[12px] text-red-700">{erro}</p>
    ) : (
      <p className="text-[12px] text-emerald-700">
        Lendo{total != null && <> · {contar(total, 'e-mail', 'e-mails')} na Caixa de Entrada</>}
        {testadoEm && <span className="text-muted-foreground"> · conferido {quando(testadoEm)}</span>}
      </p>
    )}
    {leitura ? (
      <p className={cn('text-[12px]', leitura.erro ? 'text-red-700' : 'text-muted-foreground')}>
        Robô passou {quando(leitura.varridoEm)}
        {leitura.erro
          ? ` e falhou: ${leitura.erro}. Tenta de novo na próxima hora.`
          : ` · ${contar(leitura.emails, 'e-mail olhado', 'e-mails olhados')}, ${contar(leitura.comProcesso, 'com processo', 'com processo')}`}
      </p>
    ) : (
      <p className="text-[12px] text-muted-foreground">O robô ainda não leu esta caixa (passa de hora em hora).</p>
    )}
  </>
);

const Conexao = ({
  c,
  leituras,
  onAlterada,
  onAviso,
}: {
  c: ConexaoEmail;
  leituras: Map<string, LeituraCaixa>;
  onAlterada: () => void;
  onAviso: (a: Aviso | null) => void;
}) => {
  const [ocupado, setOcupado] = useState(false);
  const [endereco, setEndereco] = useState('');

  const fazer = async (p: () => Promise<unknown>, ok?: string) => {
    setOcupado(true);
    onAviso(null);
    try {
      await p();
      if (ok) onAviso({ tom: 'ok', texto: ok });
      onAlterada();
      return true;
    } catch (e) {
      onAviso({ tom: 'erro', texto: mensagemDe(e) });
      return false;
    } finally {
      setOcupado(false);
    }
  };

  return (
    <li className={cn('space-y-2 px-3 py-3', !c.conectada && 'opacity-70')}>
      <div className="flex flex-wrap items-start gap-2">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-semibold text-foreground">
            {c.caixa}
            {c.nome && <span className="font-normal text-muted-foreground"> · {c.nome}</span>}
          </p>
          {c.conectada ? (
            <Situacao total={c.totalCaixaEntrada} erro={c.ultimoErro} testadoEm={c.testadoEm} leitura={leituras.get(c.caixa)} />
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Desconectada{c.desconectadoEm && ` em ${quando(c.desconectadoEm)}`}
              {c.desconectadoPor && ` por ${nomeDoResponsavel(c.desconectadoPor)}`}
            </p>
          )}
          <p className="text-[12px] text-muted-foreground">
            Conectada por {nomeDoResponsavel(c.conectadoPor)} em {quando(c.conectadoEm)}
          </p>
        </div>
        {c.conectada && (
          <div className="ml-6 flex w-full gap-1 sm:ml-0 sm:w-auto">
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void fazer(() => testarConexaoEmail(c.id))}>
              <RefreshCw className={cn('h-3.5 w-3.5', ocupado && 'animate-spin')} aria-hidden />
              Testar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={ocupado}
              onClick={() => {
                if (window.confirm(`Desconectar ${c.caixa}? O robô para de ler essa caixa e das compartilhadas dela.`))
                  void fazer(() => desconectarEmail(c.id), `${c.caixa} desconectada.`);
              }}
            >
              <Unplug className="h-3.5 w-3.5" aria-hidden />
              Desconectar
            </Button>
          </div>
        )}
      </div>

      {c.conectada && (
        <div className="ml-6 space-y-2">
          {c.compartilhadas.length > 0 && (
            <ul className="space-y-1">
              {c.compartilhadas.map((s) => (
                <li key={s.id} className="flex items-start gap-2 rounded-lg bg-background px-2 py-1.5">
                  <Inbox className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">{s.endereco}</p>
                    <Situacao total={s.totalCaixaEntrada} erro={s.ultimoErro} testadoEm={s.testadoEm} leitura={leituras.get(s.endereco)} />
                  </div>
                  <button
                    type="button"
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-30"
                    aria-label={`Parar de ler ${s.endereco}`}
                    disabled={ocupado}
                    onClick={() => void fazer(() => removerCompartilhada(s.id), `${s.endereco} removida.`)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!endereco.trim()) return;
              void fazer(() => adicionarCompartilhada(c.id, endereco), `${endereco.trim().toLowerCase()} adicionada.`).then(
                (ok) => ok && setEndereco(''),
              );
            }}
          >
            <input
              className={CAMPO}
              type="email"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="Caixa compartilhada (ex. dp@example.com)"
              aria-label={`Caixa compartilhada lida por ${c.caixa}`}
            />
            <Button type="submit" size="sm" variant="outline" className="h-9" disabled={ocupado || !endereco.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              Incluir
            </Button>
          </form>
        </div>
      )}
    </li>
  );
};

/**
 * Caixas que o robô dos processos lê. "Conectar meu e-mail" leva ao login da Microsoft; na volta
 * (`retorno`) a conexão é concluída aqui. Caixa compartilhada (ex. dp@) entra pela conexão de quem a lê.
 */
export const EmailDialogo = ({ eu, retorno, onFechar }: { eu: string | null; retorno: RetornoEmail | null; onFechar: () => void }) => {
  const [recarga, setRecarga] = useState(0);
  const estado = usePainelEmail(recarga);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [indo, setIndo] = useState(false);
  const [concluindo, setConcluindo] = useState(retorno?.tipo === 'codigo');
  const tratado = useRef(false);

  useEffect(() => {
    // StrictMode monta duas vezes: o código da Microsoft só pode ser trocado uma vez
    if (!retorno || tratado.current) return;
    tratado.current = true;
    if (retorno.tipo === 'erro') {
      setAviso({ tom: 'erro', texto: retorno.mensagem });
      return;
    }
    concluirConexaoEmail(retorno.code, retorno.state)
      .then((c) => setAviso({ tom: 'ok', texto: `${c.caixa} conectada. O robô já pode ler essa caixa.` }))
      .catch((e: unknown) => setAviso({ tom: 'erro', texto: mensagemDe(e) }))
      .finally(() => {
        setConcluindo(false);
        setRecarga((r) => r + 1);
      });
  }, [retorno]);

  const conectar = async () => {
    setIndo(true);
    setAviso(null);
    try {
      window.location.assign(await iniciarConexaoEmail());
    } catch (e) {
      setAviso({ tom: 'erro', texto: mensagemDe(e) });
      setIndo(false);
    }
  };

  const painel = estado.tipo === 'pronto' ? estado.dados : null;
  const minha = painel?.conexoes.find((c) => c.caixa === eu?.toLowerCase() && c.conectada);
  const leituras = new Map((painel?.leituras ?? []).map((l) => [l.caixa, l]));

  return (
    <Dialogo titulo="Caixas de e-mail" onFechar={onFechar} largura="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-body">
          O robô dos processos trabalhistas lê as caixas conectadas aqui (Caixa de Entrada e subpastas) de hora em hora. Cada pessoa autoriza a
          própria caixa na Microsoft; a autorização é só de leitura e pode ser desfeita a qualquer momento.
        </p>

        {concluindo && (
          <p className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-body" aria-busy="true">
            Concluindo a conexão com a Microsoft…
          </p>
        )}
        {aviso && (
          <p
            role={aviso.tom === 'erro' ? 'alert' : 'status'}
            className={cn(
              'flex items-start gap-2 rounded-xl border px-3 py-2 text-sm',
              aviso.tom === 'erro' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800',
            )}
          >
            {aviso.tom === 'ok' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            {aviso.texto}
          </p>
        )}

        {estado.tipo === 'carregando' && <div aria-busy="true" aria-label="Carregando as caixas" className="h-24 animate-pulse rounded-xl bg-background" />}
        {estado.tipo === 'erro' && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            Não foi possível carregar as caixas: {estado.mensagem}
          </p>
        )}

        {painel && !painel.configurado && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A conexão com a Microsoft ainda não foi configurada no servidor. Assim que estiver, o botão aparece aqui.
          </p>
        )}

        {painel?.configurado && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background px-3 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-sm">
              {minha ? (
                <span className="text-body">Sua caixa ({minha.caixa}) está conectada.</span>
              ) : (
                <span className="text-body">Sua caixa ainda não está conectada.</span>
              )}
              <span className="block text-[12px] text-muted-foreground">
                Para conectar outra conta (ex. a do dp@), escolha a conta na tela da Microsoft.
              </span>
            </div>
            <Button size="sm" className="self-start sm:self-auto" onClick={() => void conectar()} disabled={indo || concluindo}>
              <Mail className="h-4 w-4" aria-hidden />
              {indo ? 'Abrindo a Microsoft…' : minha ? 'Conectar outra conta' : 'Conectar meu e-mail'}
            </Button>
          </div>
        )}

        {painel && painel.conexoes.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {painel.conexoes.map((c) => (
              <Conexao key={c.id} c={c} leituras={leituras} onAlterada={() => setRecarga((r) => r + 1)} onAviso={setAviso} />
            ))}
          </ul>
        )}
        {painel?.configurado && painel.conexoes.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">Nenhuma caixa conectada ainda.</p>
        )}
      </div>
    </Dialogo>
  );
};
