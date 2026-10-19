'use client';
import { useEffect, useState } from 'react';
import { publicDownloadUrl, type CommunicatorDownloads } from '@/lib/simulation/communicatorDownloads';

export function CommunicatorDownload() {
  const [downloads, setDownloads] = useState<CommunicatorDownloads | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetch('/api/fea-downloads', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('download metadata unavailable');
        const data = await response.json();
        if (!controller.signal.aborted) setDownloads({
          windows: publicDownloadUrl(typeof data.windows === 'string' ? data.windows : undefined),
          linux: publicDownloadUrl(typeof data.linux === 'string' ? data.linux : undefined),
        });
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  return <section aria-label="Instalar o comunicador FEA" className="mt-3 rounded border border-chrome-border bg-chrome-surface p-3">
    <h3 className="font-semibold">Instalar ou atualizar o comunicador</h3>
    <p className="mt-1">Instale o emekaengCommunicator em cada computador que vai executar as simulações.</p>
    <div className="my-2 flex flex-wrap gap-2">
      {downloads ? (['windows', 'linux'] as const).map(system => {
        const name = system === 'windows' ? 'Windows' : 'Linux';
        const url = downloads[system];
        return url
          ? <a key={system} href={url} target="_blank" rel="noopener noreferrer" className="rounded border bg-white px-3 py-2 font-semibold text-slate-800">{system === 'windows' ? 'Instalar no Windows' : `Baixar para ${name}`}</a>
          : <span key={system} className="rounded border px-3 py-2">{name}: download ainda não disponibilizado</span>;
      }) : <p role="status">{failed ? 'Não foi possível consultar os downloads.' : 'Consultando downloads…'}</p>}
      {failed && <button type="button" className="rounded border px-3 py-1" onClick={() => setAttempt(v => v + 1)}>Tentar novamente</button>}
    </div>
    {downloads && !downloads.windows && <p>O instalador Windows ainda precisa ser publicado pelo responsável por esta instalação. O botão Conectar não instala o comunicador.</p>}
    <ol className="mt-2 list-decimal space-y-1 pl-5">
      <li>No Windows, baixe e execute o instalador. Mantenha a conexão com a internet: os componentes são baixados e verificados automaticamente. Depois, confirme a instalação.</li>
      <li>No Ubuntu/Debian, baixe o arquivo .deb e abra com o instalador de aplicativos do sistema. Confirme a instalação e abra “emekaengCommunicator” no menu de aplicativos.</li>
      <li>No Windows, ao concluir, mantenha marcada a opção “Abrir comunicador”.</li>
      <li>Aguarde “Pronto”, volte a esta página e clique em “Conectar ao meu computador”.</li>
      <li>Aceite a solicitação no comunicador e a permissão de acesso local, se o navegador pedir.</li>
    </ol>
    <p className="mt-2">Para atualizar, aguarde os cálculos terminarem, feche o comunicador e instale o novo pacote. Depois abra novamente. Suas preferências são mantidas.</p>
    <p className="mt-2">Marque “Abrir automaticamente ao entrar no Windows/Linux” no comunicador para dispensar a abertura manual nas próximas sessões. Mantenha-o aberto ou minimizado durante os cálculos.</p>
    <p className="mt-2">Não é necessário instalar Python ou configurar o motor de cálculo. Se o download Linux for um .zip, extraia a pasta completa e abra emekaengCommunicator; o instalador .deb atende Ubuntu, Debian e derivados.</p>
  </section>;
}
