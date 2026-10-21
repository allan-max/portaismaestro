/* Painel do servidor (servidor.html): CPU, RAM, GPU e VRAM lidos pelo winserver.py e repassados pelo gerenciador. Só leitura. */
(function (global) {
    'use strict';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = v => Number(v || 0).toFixed(1).replace('.', ',');
    const fmtGb = v => Number(v || 0).toFixed(1).replace('.', ',') + ' GB';
    const cor = p => p >= 90 ? 'vermelho' : p >= 75 ? 'amarelo' : 'verde';
    const HEX = { vermelho: '#fb8585', amarelo: '#fbbf24', verde: '#34d399' };

    const SERIES = [
        { chave: 'cpu', nome: 'CPU', cor: '#38bdf8' },
        { chave: 'ram', nome: 'RAM', cor: '#a78bfa' },
        { chave: 'gpu', nome: 'GPU', cor: '#34d399' },
        { chave: 'vram', nome: 'VRAM', cor: '#fbbf24' },
    ];

    function cartao(rotulo, pct, detalhe, i) {
        const c = cor(pct);
        return `<div class="card-num entra" style="--i:${i}"><small>${esc(rotulo)}</small>
            <strong style="color:${HEX[c]}">${fmt(pct)}%</strong>
            <div class="barra-trilho" style="margin:6px 0 4px"><i class="${c}" style="--w:${Math.min(100, Math.max(0, pct))}%"></i></div>
            <em>${esc(detalhe)}</em></div>`;
    }

    function grafico(hist, visiveis) {
        const W = 760, H = 220, pl = 36, pr = 12, pt = 12, pb = 24;
        const pw = W - pl - pr, ph = H - pt - pb;
        const n = hist.length;
        const x = i => +(pl + (n <= 1 ? pw : (i * pw) / (n - 1))).toFixed(1);
        const y = v => +(pt + ph - (Math.min(100, Math.max(0, v)) / 100) * ph).toFixed(1);
        const grade = [0, 25, 50, 75, 100].map(v => `<line x1="${pl}" y1="${y(v)}" x2="${W - pr}" y2="${y(v)}" stroke="#2a3649" stroke-width="1"/><text x="${pl - 6}" y="${y(v) + 3}" fill="#8da0b6" font-size="9" text-anchor="end">${v}%</text>`).join('');
        const hora = i => (hist[i] && hist[i].t ? hist[i].t.slice(11, 16) : '');
        const marcas = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1].map(i => `<text x="${x(i)}" y="${H - 6}" fill="#8da0b6" font-size="9" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(hora(i))}</text>`).join('') : '';
        const linhas = SERIES.filter(s => visiveis[s.chave]).map(s =>
            `<polyline fill="none" stroke="${s.cor}" stroke-width="1.8" stroke-linejoin="round" points="${hist.map((p, i) => `${x(i)},${y(p[s.chave])}`).join(' ')}"/>`).join('');
        return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Consumo do servidor ao longo do tempo">${grade}${marcas}${linhas}</svg>`;
    }

    function fmtUptime(s) {
        s = Number(s) || 0;
        const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
        return d ? `${d}d ${h}h ${m}min` : h ? `${h}h ${m}min` : `${m}min`;
    }
    const fmtKbs = v => Number(v || 0) >= 1024 ? `${(v / 1024).toFixed(1).replace('.', ',')} MB/s` : `${Number(v || 0).toFixed(0)} KB/s`;
    const corTemp = (t, aviso, critico) => t >= critico ? 'vermelho' : t >= aviso ? 'amarelo' : 'verde';

    function cartaoTemp(rotulo, temp, detalhe, aviso, critico, i) {
        if (temp == null) return `<div class="card-num entra" style="--i:${i}"><small>${esc(rotulo)}</small><strong>—</strong><em>${esc(detalhe)}</em></div>`;
        const c = corTemp(temp, aviso, critico);
        return `<div class="card-num entra" style="--i:${i}"><small>${esc(rotulo)}</small>
            <strong style="color:${HEX[c]}">${fmt(temp)}°C</strong>
            <div class="barra-trilho" style="margin:6px 0 4px"><i class="${c}" style="--w:${Math.min(100, Math.max(0, temp))}%"></i></div>
            <em>${esc(detalhe)}</em></div>`;
    }

    function diagnostico(a) {
        const avisos = Array.isArray(a.diagnostico) ? a.diagnostico : [];
        const itens = avisos.length
            ? avisos.map(v => `<li><span class="rotulo">${v.nivel === 'critico' ? 'Crítico' : 'Atenção'}</span><div class="principal"><p>${esc(v.texto)}</p></div><span class="lado"><span class="tag ${v.nivel === 'critico' ? 'vermelho' : 'amarelo'}">${v.nivel === 'critico' ? 'Crítico' : 'Atenção'}</span></span></li>`).join('')
            : '<li><span class="rotulo">Tudo certo</span><div class="principal"><p>Nenhum problema detectado nas leituras atuais.</p></div></li>';
        const discos = (a.discos || []).map(d => `<li><span class="rotulo">Disco ${esc(d.ponto)}</span><div class="principal"><p>${fmtGb(d.usado_gb)} de ${fmtGb(d.total_gb)}</p>
            <div class="barra-trilho" style="margin:4px 0"><i class="${cor(d.percentual)}" style="--w:${Math.min(100, d.percentual)}%"></i></div></div><span class="lado"><b>${fmt(d.percentual)}%</b></span></li>`).join('');
        const proc = (lista, campo, fmtVal) => (lista || []).map(p => `<li><span class="rotulo">${esc(p.nome)}</span><span class="lado"><b>${fmtVal(p[campo])}</b></span></li>`).join('') || '<li><span class="rotulo">Sem dados</span></li>';
        const rede = a.rede || {};
        const info = [
            ['Computador', a.host], ['Sistema', a.sistema], ['Ligado há', fmtUptime(a.uptime_s)],
            ['Processador', a.cpu_nucleos ? `${a.cpu_nucleos} núcleos / ${a.cpu_threads} threads${a.cpu_freq_mhz ? ` · ${a.cpu_freq_mhz} MHz` : ''}` : null],
            ['Memória virtual', a.swap_total_gb ? `${fmtGb(a.swap_usada_gb)} de ${fmtGb(a.swap_total_gb)} (${fmt(a.swap_percentual)}%)` : 'Desativada'],
            ['Rede', `↓ ${fmtKbs(rede.rec_kbs)} · ↑ ${fmtKbs(rede.env_kbs)}`],
        ].filter(i => i[1]).map(i => `<li><span class="rotulo">${esc(i[0])}</span><div class="principal"><p>${esc(i[1])}</p></div></li>`).join('');
        return `<section class="panel bloco entra" style="--i:6"><div class="panel-head"><div><h2>Diagnóstico geral</h2><p>Avisos automáticos com base nas leituras atuais.</p></div></div><ul class="lista">${itens}</ul></section>
            <section class="panel bloco entra" style="--i:7"><div class="panel-head"><div><h2>Informações do servidor</h2></div></div><ul class="lista">${info}</ul></section>
            <section class="panel bloco entra" style="--i:8"><div class="panel-head"><div><h2>Discos</h2></div></div><ul class="lista">${discos || '<li><span class="rotulo">Sem dados</span></li>'}</ul></section>
            <section class="panel bloco entra" style="--i:9"><div class="panel-head"><div><h2>Processos que mais consomem</h2><p>Por CPU e por memória RAM.</p></div></div>
                <ul class="lista">${proc((a.processos || {}).cpu, 'cpu', v => fmt(v) + '% CPU')}</ul><ul class="lista">${proc((a.processos || {}).ram, 'ram_mb', v => Math.round(v) + ' MB')}</ul></section>`;
    }

    function pagina(dados, ctx, visiveis) {
        const a = dados.atual || {};
        const hist = Array.isArray(dados.historico) ? dados.historico : [];
        const gpuOk = a.gpu_disponivel !== false;
        const cards = cartao('CPU', a.cpu, 'Processador', 0) + cartao('RAM', a.ram, `${fmtGb(a.ram_usada_gb)} de ${fmtGb(a.ram_total_gb)}`, 1)
            + (gpuOk ? cartao('GPU', a.gpu, a.gpu_nome || 'Placa de vídeo', 2)
                + cartao('VRAM', a.vram, `${fmtGb(a.vram_usada_gb)} de ${fmtGb(a.vram_total_gb)}`, 3)
                : '<div class="card-num entra" style="--i:2"><small>GPU / VRAM</small><strong>—</strong><em>GPU NVIDIA não detectada no servidor</em></div>')
            + cartaoTemp('Temperatura CPU', a.cpu_temp, a.cpu_temp != null ? `Fonte: ${a.cpu_temp_origem}` : 'Sensor indisponível (abra o LibreHardwareMonitor no servidor)', 80, 90, 4)
            + (a.gpu_temp != null ? cartaoTemp('Temperatura GPU', a.gpu_temp, a.gpu_nome || 'Placa de vídeo', 75, 85, 5) : '');
        const maximo = k => hist.length ? Math.max(...hist.map(p => Number(p[k]) || 0)) : 0;
        const media = k => hist.length ? hist.reduce((s, p) => s + (Number(p[k]) || 0), 0) / hist.length : 0;
        const chips = SERIES.filter(s => s.chave === 'cpu' || s.chave === 'ram' || gpuOk).map(s =>
            `<button type="button" class="tag${visiveis[s.chave] ? ' azul' : ''}" data-acao="serie" data-serie="${s.chave}" aria-pressed="${!!visiveis[s.chave]}"><i style="width:8px;height:8px;border-radius:50%;background:${s.cor};display:inline-block"></i>${s.nome}</button>`).join(' ');
        const resumo = SERIES.filter(s => s.chave === 'cpu' || s.chave === 'ram' || gpuOk).map(s =>
            `<li><span class="rotulo">${s.nome}</span><div class="principal"><p>Média ${fmt(media(s.chave))}% · Pico ${fmt(maximo(s.chave))}%</p></div><span class="lado"><b>${fmt(a[s.chave])}%</b></span></li>`).join('');
        const temp = a.gpu_temp != null ? ` · GPU ${esc(a.gpu_temp)}°C` : '';
        return `<div class="cards">${cards}</div>
            <section class="panel bloco entra" style="--i:4"><div class="panel-head"><div><h2>Consumo ao longo do tempo</h2>
                <p>Últimas ${hist.length} leituras (~${Math.round(hist.length * 4.5 / 60)} min)${temp}. Atualiza a cada 5 s.</p></div><div>${chips}</div></div>
                <div class="panel-body">${hist.length > 1 ? grafico(hist, visiveis) : '<p class="vazio">Coletando leituras…</p>'}</div></section>
            <section class="panel bloco entra" style="--i:5"><div class="panel-head"><div><h2>Resumo do período</h2></div></div>
                <ul class="lista">${resumo}</ul></section>${diagnostico(a)}`;
    }

    const api = { pagina, cor };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.DashServidor = api;

    if (typeof document !== 'undefined' && document.body && document.body.dataset.dashboard === 'servidor') {
        const visiveis = { cpu: true, ram: true, gpu: true, vram: true };
        const painel = global.Dash.iniciar({
            pagina: 'servidor', fonte: 'servidor', titulo: 'Monitoramento do servidor',
            subtitulo: 'Consumo de CPU, RAM, GPU e VRAM do servidor, lido pelo winserver.py através do gerenciador.',
            extrair: r => r.painel,
            render: (d, ctx) => pagina(d, ctx, visiveis),
            acoes: { serie: el => { visiveis[el.dataset.serie] = !visiveis[el.dataset.serie]; } },
        });
        setInterval(() => painel.atualizar(), 5000);   // painel ao vivo (a base só atualiza a cada 60 s)
    }
})(typeof window !== 'undefined' ? window : globalThis);
