


    // 🔒 BARREIRA DE SEGURANÇA: Só entra quem for Admin!
    if (localStorage.getItem('maestro_admin') !== 'true') {
        window.location.href = 'index.html';
    }

    const sessionAtual = localStorage.getItem('maestro_session');

// Só tenta conectar enviando o crachá real
const socket = io({ 
    auth: { sessionId: sessionAtual },
    transports: ['websocket'],
    upgrade: false
});

// Se o servidor derrubar a conexão (ex: Admin baniu o usuário ou a sessão expirou)
socket.on("connect_error", (err) => {
    console.error("Conexão recusada pelo Servidor:", err.message);
    localStorage.clear();
    window.location.href = "index.html"; // Chuta o hacker de volta pra rua
});
    let dadosMarcas = [];
    let dadosVendedores = [];
    
    let totalCotacoes = 0, totalRespondidas = 0, totalPendentes = 0, totalNaoRespondidas = 0;
    let percRespondidas = 0, percNaoRespondidas = 0, percPendentes = 0;

    // Assim que a página abre, pede os dados à Nuvem
    window.onload = function() {
        atualizarDashboard();
    }

    // =========================================================================
    // AS SUAS FUNÇÕES ORIGINAIS DE GRÁFICO (MANTIDAS EXATAMENTE COMO VOCÊ FEZ)
    // =========================================================================

    function renderStats() {
      const statsGrid = document.getElementById("statsGrid");
      statsGrid.innerHTML = '';
      const stats = [
        { label: "Total de Cotações", value: totalCotacoes, percentage: "100%", type: "total", trend: "neutral" },
        { label: "Respondidas", value: totalRespondidas, percentage: percRespondidas + "%", type: "respondidas", trend: "up" },
        { label: "Não Respondidas", value: totalNaoRespondidas, percentage: percNaoRespondidas + "%", type: "nao-respondidas", trend: "down" },
        { label: "Pendentes", value: totalPendentes, percentage: percPendentes + "%", type: "pendentes", trend: "neutral" }
      ];

      stats.forEach(stat => {
        const card = document.createElement('div');
        card.className = `stat-card ${stat.type}`;
        
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = stat.label;
        
        const value = document.createElement('div');
        value.className = 'value';
        value.textContent = stat.value.toLocaleString();
        
        const percentage = document.createElement('div');
        percentage.className = `percentage ${stat.trend}`;
        percentage.textContent = `${stat.percentage} do total`;
        
        card.appendChild(label);
        card.appendChild(value);
        card.appendChild(percentage);
        statsGrid.appendChild(card);
      });
    }

    function renderBrands() {
      const marcasComTaxa = dadosMarcas.map(m => ({
        ...m,
        taxa: m.total > 0 ? (m.respondidas / m.total) * 100 : 0
      }));

      const topBrands = [...marcasComTaxa].sort((a, b) => b.respondidas - a.respondidas).slice(0, 5);
      const lowBrands = [...marcasComTaxa].sort((a, b) => b.nao_respondidas - a.nao_respondidas).slice(0, 5);

      const renderBrandList = (brands, containerId) => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        brands.forEach(brand => {
          const item = document.createElement('div');
          item.className = 'brand-item';
          
          const info = document.createElement('div');
          info.className = 'brand-info';
          
          const name = document.createElement('span');
          name.className = 'brand-name';
          name.textContent = brand.nome;
          
          const stats = document.createElement('span');
          stats.className = 'brand-stats';
          stats.textContent = `${brand.respondidas}/${brand.total} (${brand.taxa.toFixed(1)}%)`;
          
          const bar = document.createElement('div');
          bar.className = 'progress-bar';
          const fill = document.createElement('div');
          fill.className = `progress-fill ${brand.taxa >= 80 ? "high" : brand.taxa >= 50 ? "medium" : "low"}`;
          fill.style.width = `${brand.taxa}%`;
          
          info.appendChild(name);
          info.appendChild(stats);
          bar.appendChild(fill);
          item.appendChild(info);
          item.appendChild(bar);
          container.appendChild(item);
        });
      };

      renderBrandList(topBrands, "topBrands");
      renderBrandList(lowBrands, "lowBrands");
    }

    function renderSellers() {
      const sellersGrid = document.getElementById("sellersGrid");
      sellersGrid.innerHTML = '';
      const sortedSellers = [...dadosVendedores].sort((a, b) => b.respostas - a.respostas);

      sortedSellers.forEach((seller, i) => {
        const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "normal";
        const taxa = seller.total > 0 ? ((seller.respostas / seller.total) * 100).toFixed(1) : 0;
        
        const card = document.createElement('div');
        card.className = 'seller-card';
        
        const rank = document.createElement('div');
        rank.className = `seller-rank ${rankClass}`;
        rank.textContent = i + 1;
        
        const info = document.createElement('div');
        info.className = 'seller-info';
        const name = document.createElement('div');
        name.className = 'seller-name';
        name.textContent = seller.nome;
        const resp = document.createElement('div');
        resp.className = 'seller-responses';
        resp.textContent = `${seller.respostas} de ${seller.total} cotações`;
        
        const perc = document.createElement('div');
        perc.className = 'seller-percentage';
        const val = document.createElement('div');
        val.className = 'value';
        val.textContent = `${taxa}%`;
        const lbl = document.createElement('div');
        lbl.className = 'label';
        lbl.textContent = 'taxa';
        
        info.appendChild(name);
        info.appendChild(resp);
        perc.appendChild(val);
        perc.appendChild(lbl);
        card.appendChild(rank);
        card.appendChild(info);
        card.appendChild(perc);
        sellersGrid.appendChild(card);
      });
    }

    let exibirTodasMarcas = false;

    function toggleExibirMais() {
      exibirTodasMarcas = !exibirTodasMarcas;
      const btn = document.getElementById('btnExibirMais');
      if (exibirTodasMarcas) {
          btn.textContent = "EXIBIR MENOS";
      } else {
          btn.textContent = "EXIBIR MAIS";
      }
      renderTable();
    }

    function renderTable() {
      const tbody = document.getElementById("brandTableBody");
      tbody.innerHTML = '';
      
      const termo = document.getElementById('pesquisaMarca') ? document.getElementById('pesquisaMarca').value.toLowerCase() : "";
      
      let marcasFiltradas = dadosMarcas.filter(m => m.nome.toLowerCase().includes(termo));
      
      // Ordenar por respondidas (maior para o menor)
      marcasFiltradas.sort((a, b) => b.respondidas - a.respondidas);

      const btn = document.getElementById('btnExibirMais');
      if (btn) {
          if (marcasFiltradas.length > 7 && !termo) {
              btn.style.display = 'inline-block';
              if (!exibirTodasMarcas) {
                  marcasFiltradas = marcasFiltradas.slice(0, 7);
              }
          } else {
              btn.style.display = 'none';
          }
      }
      
      marcasFiltradas.forEach(marca => {
        const naoRespondidas = marca.nao_respondidas || 0;
        const pendentes = marca.pendentes || 0;
        const taxa = marca.total > 0 ? ((marca.respondidas / marca.total) * 100).toFixed(1) : 0;
        const statusClass = taxa >= 80 ? "high" : taxa >= 50 ? "medium" : "low";
        
        const tr = document.createElement('tr');
        
        const tdName = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = marca.nome;
        tdName.appendChild(strong);
        
        const tdTotal = document.createElement('td');
        tdTotal.textContent = marca.total;
        
        const tdResp = document.createElement('td');
        tdResp.style.color = "#34d399";
        tdResp.textContent = marca.respondidas;
        
        const tdNao = document.createElement('td');
        tdNao.style.color = "#f87171";
        tdNao.textContent = naoRespondidas;
        
        const tdPend = document.createElement('td');
        tdPend.style.color = "#fbbf24";
        tdPend.textContent = pendentes;
        
        const tdTaxa = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `status-badge ${statusClass}`;
        badge.textContent = `${taxa}%`;
        tdTaxa.appendChild(badge);
        
        tr.appendChild(tdName);
        tr.appendChild(tdTotal);
        tr.appendChild(tdResp);
        tr.appendChild(tdNao);
        tr.appendChild(tdPend);
        tr.appendChild(tdTaxa);
        tbody.appendChild(tr);
      });
    }

    
    let donutChartInst = null;
    let barChartInst = null;

    function drawDonutChart() {
      const ctx = document.getElementById('donutChart');
      if (!ctx) return;
      
      if (donutChartInst) donutChartInst.destroy();
      
      donutChartInst = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Respondidas', 'Não Respondidas', 'Pendentes'],
          datasets: [{
            data: [totalRespondidas, totalNaoRespondidas, totalPendentes],
            backgroundColor: ['#34d399', '#f87171', '#fbbf24'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '75%',
          plugins: {
            legend: { display: false }
          }
        }
      });
      
      const centerLabel = document.getElementById('totalDonut');
      if(centerLabel) centerLabel.textContent = totalCotacoes;
      
      const legendContainer = document.getElementById('donutLegend');
      if(legendContainer) {
          legendContainer.innerHTML = `
            <div class="legend-item">
              <div class="legend-color" style="background: #34d399"></div>
              <div class="legend-label">Respondidas</div>
              <div class="legend-value">${totalRespondidas}</div>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #f87171"></div>
              <div class="legend-label">Não Respondidas</div>
              <div class="legend-value">${totalNaoRespondidas}</div>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #fbbf24"></div>
              <div class="legend-label">Pendentes</div>
              <div class="legend-value">${totalPendentes}</div>
            </div>
          `;
      }
    }

    function drawBarChart() {
      const ctx = document.getElementById('barChart');
      if (!ctx) return;
      
      if (barChartInst) barChartInst.destroy();
      
      // Top 7 marcas que mais responderam para n ficar muito sujo
      const topMarcas = [...dadosMarcas].sort((a, b) => b.respondidas - a.respondidas).slice(0, 7);
      
      barChartInst = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: topMarcas.map(m => m.nome),
          datasets: [{
            label: 'Respondidas',
            data: topMarcas.map(m => m.respondidas),
            backgroundColor: 'rgba(129, 140, 248, 0.8)',
            borderColor: '#818cf8',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a1a1aa' } },
            x: { grid: { display: false }, ticks: { color: '#a1a1aa' } }
          }
        }
      });
    }

    function init() {

      renderStats();
      drawDonutChart();
      drawBarChart();
      renderBrands();
      renderSellers();
      renderTable();
    }

    window.addEventListener("resize", () => {
      drawBarChart();
    });

  
   // Função para solicitar a atualização
function atualizarDashboard() {
    // Coloca a mensagem de espera
    document.getElementById('statsGrid').innerHTML = '<h3 style="color:#fff; padding: 20px;">A extrair dados do Excel, aguarde...</h3>';
    console.log("Solicitando dados ao servidor...");
    
    const dataInicio = document.getElementById('dataInicio') ? document.getElementById('dataInicio').value : null;
    const dataFim = document.getElementById('dataFim') ? document.getElementById('dataFim').value : null;
    
    socket.emit('pedir_dados_dashboard', { dataInicio, dataFim });
}

socket.on('receber_dados_dashboard', (res) => {
    console.log("Dados recebidos:", res);
    if (!res.sucesso) {
        document.getElementById('statsGrid').innerHTML = '<h3 style="color:#ff4d4d; padding: 20px;">Erro: ' + res.erro + '</h3>';
        return;
    }

    const t = res.totais || { total: 0, respondidas: 0, pendentes: 0, nao_respondidas: 0 };
    
    // Atualiza variáveis globais para as funções originais
    totalCotacoes = t.total;
    totalRespondidas = t.respondidas;
    totalPendentes = t.pendentes;
    totalNaoRespondidas = t.nao_respondidas;
    
    percRespondidas = totalCotacoes > 0 ? ((totalRespondidas / totalCotacoes) * 100).toFixed(1) : 0;
    percNaoRespondidas = totalCotacoes > 0 ? ((totalNaoRespondidas / totalCotacoes) * 100).toFixed(1) : 0;
    percPendentes = totalCotacoes > 0 ? ((totalPendentes / totalCotacoes) * 100).toFixed(1) : 0;

    dadosMarcas = res.marcas || [];
    dadosVendedores = res.vendedores || [];

    // REINICIALIZA GRÁFICOS E TABELAS USANDO SUAS FUNÇÕES ORIGINAIS
    if (typeof init === "function") init();
});



