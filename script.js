// ==========================================
// 1. CONFIGURAÇÕES E LINKS DAS APIs
// ==========================================
// Insira aqui o seu link oficial que devolve as coordenadas (lat/lng) da rota.
// Deixei vazio por enquanto para evitar o erro 408 do link antigo.
const API_ITINERARIO = "COLOQUE_SEU_LINK_AQUI"; 

// A API Mestra que construímos no Vercel
const API_AUDITORIA = "https://api-transporte-rose.vercel.app/api/auditoria/";
const DATA_TESTE = "2026-07-13"; // A data que possui dados no banco

// ==========================================
// 2. VARIÁVEIS GLOBAIS
// ==========================================
let map, rotaDesenhada = null, marcadorUsuario = null, watchId = null;
let isForaDaRota = false;
const LIMITE_DISTANCIA_METROS = 60; // Margem de desvio (60 metros)

// ==========================================
// 3. INICIALIZAÇÃO DO MAPA
// ==========================================
function inicializarMapa() {
    map = L.map('map').setView([-3.7319, -38.5267], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
}

// ==========================================
// 4. SISTEMA DE VOZ (ALERTAS)
// ==========================================
function falar(texto) {
    const checkboxVoz = document.getElementById("vozAtiva");
    if (!checkboxVoz || !checkboxVoz.checked) return;

    window.speechSynthesis.cancel();
    const voz = new SpeechSynthesisUtterance(texto);
    voz.lang = 'pt-BR';
    voz.rate = 1.0; 
    window.speechSynthesis.speak(voz);
}

// ==========================================
// 5. AUDITORIA OPERACIONAL (A NOSSA API)
// ==========================================
async function carregarAuditoriaOperacional(numLinha) {
    const painelAuditoria = document.getElementById("painelAuditoria");
    if (!painelAuditoria) return; 

    painelAuditoria.innerHTML = "<p>⏳ Consultando inteligência operacional no Supabase...</p>";
    painelAuditoria.style.display = "block";

    try {
        const resposta = await fetch(`${API_AUDITORIA}${DATA_TESTE}`);
        
        if (!resposta.ok) {
            throw new Error(`Erro no servidor (A tabela alocacao_frota precisa ser criada no banco).`);
        }

        const dados = await resposta.json();
        const viagensLinha = dados.auditoria.filter(v => v.id_linha == numLinha);

        if (viagensLinha.length === 0) {
            painelAuditoria.innerHTML = `<p class="erro">ℹ️ Nenhum carro ou horário planejado para a linha ${numLinha} no dia ${DATA_TESTE}.</p>`;
            return;
        }

        const nomeRota = viagensLinha[0].nome_linha;
        const origem = viagensLinha[0].terminal_saida;
        const destino = viagensLinha[0].terminal_chegada;

        let html = `
            <div style="background: #fff; border-radius: 8px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-top: 15px;">
                <h3 style="margin-top:0; color:#003366;">📋 Operação: ${numLinha} - ${nomeRota}</h3>
                <p style="font-size: 14px; color: #555;"><strong>Rota:</strong> ${origem} ➔ ${destino}</p>
                <div style="max-height: 250px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
                        <thead style="background: #e9ecef; position: sticky; top: 0;">
                            <tr>
                                <th style="padding: 8px; border-bottom: 2px solid #ccc;">Saída Programada</th>
                                <th style="padding: 8px; border-bottom: 2px solid #ccc;">Carro Escalado</th>
                                <th style="padding: 8px; border-bottom: 2px solid #ccc;">Status</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        viagensLinha.forEach(v => {
            let corStatus = "green";
            let txtStatus = "No Horário";

            if (v.carro_realizado === "NÃO ALOCADO") {
                corStatus = "red";
                txtStatus = "Omitido";
            } else if (v.programado_saida !== v.realizado_saida) {
                corStatus = "orange";
                txtStatus = "Divergência";
            }

            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px;">${v.programado_saida || '-'}</td>
                    <td style="padding: 8px;"><strong>${v.carro_realizado}</strong></td>
                    <td style="padding: 8px; color: ${corStatus}; font-weight: bold;">${txtStatus}</td>
                </tr>
            `;
        });

        html += `</tbody></table></div></div>`;
        painelAuditoria.innerHTML = html;

    } catch (erro) {
        painelAuditoria.innerHTML = `<p class="erro">❌ Falha ao carregar auditoria: ${erro.message}. Lembre-se de rodar o arquivo de correção do banco de dados.</p>`;
    }
}

// ==========================================
// 6. DESENHO DA ROTA NO MAPA
// ==========================================
async function carregarRota() {
    const numLinha = document.getElementById("linha").value.trim();
    const sentido = document.getElementById("sentido").value;
    const botao = document.getElementById("btnCarregar");
    const infoDiv = document.getElementById("infoRota");

    if (!numLinha) {
        alert("⚠️ Digite o número da linha!");
        return;
    }

    botao.textContent = "⏳ Processando...";
    botao.disabled = true;
    infoDiv.style.display = "none";

    isForaDaRota = false;

    // Dispara a auditoria na nossa API sem depender do mapa
    carregarAuditoriaOperacional(numLinha);

    // Se o usuário ainda não colocou o link do itinerário, avisa mas não quebra o sistema
    if (API_ITINERARIO === "COLOQUE_SEU_LINK_AQUI") {
        infoDiv.innerHTML = `<p class="aviso">⚠️ Tabela de operação carregada! Para desenhar a linha azul no mapa, insira a URL correta do itinerário no código JavaScript.</p>`;
        infoDiv.style.display = "block";
        botao.textContent = "🚀 Carregar Rota";
        botao.disabled = false;
        return;
    }

    try {
        // Requisição direta (sem proxies problemáticos)
        const resposta = await fetch(API_ITINERARIO + numLinha);
        if (!resposta.ok) throw new Error("Erro ao buscar coordenadas da rota.");
        
        const dados = await resposta.json();
        const listaPontos = Array.isArray(dados) ? dados : (dados.data || dados.itinerario || dados.pontos || []);

        const pontosFiltrados = listaPontos.filter(ponto => 
            ponto.sentido && ponto.sentido.toLowerCase() === sentido.toLowerCase()
        );

        if (pontosFiltrados.length === 0) {
            infoDiv.innerHTML = `<p class="erro">ℹ️ Nenhum ponto encontrado para o sentido ${sentido}.</p>`;
            infoDiv.style.display = "block";
            return;
        }

        const coordenadas = pontosFiltrados.map(ponto => [parseFloat(ponto.latitude), parseFloat(ponto.longitude)]);

        if (rotaDesenhada) map.removeLayer(rotaDesenhada);

        rotaDesenhada = L.polyline(coordenadas, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map);
        map.fitBounds(rotaDesenhada.getBounds(), { padding: [20, 20] });

        infoDiv.innerHTML = `<h3>Linha ${numLinha}</h3><p class="aviso">✅ Rota desenhada com sucesso.</p>`;
        infoDiv.style.display = "block";

    } catch (erro) {
        infoDiv.innerHTML = `<p class="erro">❌ Erro no mapa: ${erro.message}</p>`;
        infoDiv.style.display = "block";
    } finally {
        botao.textContent = "🚀 Carregar Rota";
        botao.disabled = false;
    }
}

// ==========================================
// 7. RASTREAMENTO GPS (USUÁRIO)
// ==========================================
function localizarUsuario() {
    const infoLocal = document.getElementById("localizacaoInfo");
    const botao = document.getElementById("btnLocalizar");

    if (!navigator.geolocation) {
        infoLocal.innerHTML = `<p class="erro">❌ GPS não suportado.</p>`;
        infoLocal.style.display = "block";
        return;
    }

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        botao.textContent = "📍 Iniciar Rastreamento";
        botao.style.background = "#16a34a";
        infoLocal.innerHTML += `<p class="aviso">🛑 Rastreamento pausado.</p>`;
        falar("Rastreamento pausado.");
        return;
    }

    botao.textContent = "🔄 Rastreando... (Clique para Parar)";
    botao.style.background = "#d97706"; 
    infoLocal.style.display = "none";
    falar("Rastreamento iniciado.");

    watchId = navigator.geolocation.watchPosition(
        (posicao) => {
            const lat = posicao.coords.latitude;
            const lng = posicao.coords.longitude;
            const precisao = (posicao.coords.accuracy / 1000).toFixed(2);
            const latLngAtual = L.latLng(lat, lng);

            if (marcadorUsuario) {
                marcadorUsuario.setLatLng(latLngAtual);
            } else {
                marcadorUsuario = L.marker(latLngAtual).addTo(map).bindPopup(`<strong>Você está aqui</strong>`).openPopup();
            }

            map.setView(latLngAtual, 16);

            let statusRotaHtml = "";

            if (rotaDesenhada) {
                const pontosRota = rotaDesenhada.getLatLngs();
                let menorDistancia = Infinity;

                for (let i = 0; i < pontosRota.length; i++) {
                    let distanciaPonto = latLngAtual.distanceTo(pontosRota[i]);
                    if (distanciaPonto < menorDistancia) menorDistancia = distanciaPonto;
                }

                if (menorDistancia > LIMITE_DISTANCIA_METROS && !isForaDaRota) {
                    isForaDaRota = true;
                    falar("Atenção. Você saiu da rota da linha.");
                } else if (menorDistancia <= LIMITE_DISTANCIA_METROS && isForaDaRota) {
                    isForaDaRota = false;
                    falar("Você retornou à rota correta.");
                }

                statusRotaHtml = isForaDaRota 
                    ? `<br><strong style="color:#dc2626;">⚠️ Fora da rota (${Math.round(menorDistancia)}m de distância)</strong>` 
                    : `<br><strong style="color:#16a34a;">✅ Na rota correta</strong>`;
            }

            infoLocal.innerHTML = `<p class="localizacao">📍 <strong>Rastreamento Ativo:</strong><br>Precisão: ~${precisao} metros ${statusRotaHtml}</p>`;
            infoLocal.style.display = "block";
        },
        (erro) => {
            infoLocal.innerHTML = `<p class="erro">⚠️ Erro de GPS.</p>`;
            infoLocal.style.display = "block";
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            botao.textContent = "📍 Iniciar Rastreamento";
            botao.style.background = "#16a34a";
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

// ==========================================
// 8. EVENTOS INICIAIS
// ==========================================
window.onload = () => {
    inicializarMapa();
    document.getElementById("btnCarregar").addEventListener("click", carregarRota);
    document.getElementById("btnLocalizar").addEventListener("click", localizarUsuario);
};
