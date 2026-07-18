const API_ITINERARIO = "https://info-bus-fortaleza.vercel.app/api/pontos-itinerarios/";
const API_AUDITORIA = "https://api-transporte-rose.vercel.app/api/auditoria/";
const DATA_TESTE = "2026-07-13"; // Dia que contém a operação no banco

let map, rotaDesenhada = null, marcadorUsuario = null, watchId = null;

// Variáveis para o controle de desvio de rota
let isForaDaRota = false;
const LIMITE_DISTANCIA_METROS = 60; // Margem de erro de 60 metros

const MAX_TENTATIVAS = 6;
const TEMPO_ESPERA = 1200; 

function inicializarMapa() {
    map = L.map('map').setView([-3.7319, -38.5267], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
}

// Função responsável por emitir os alertas de voz
function falar(texto) {
    const checkboxVoz = document.getElementById("vozAtiva");
    if (!checkboxVoz || !checkboxVoz.checked) return;

    // Cancela falas anteriores para não sobrepor áudios
    window.speechSynthesis.cancel();
    
    const voz = new SpeechSynthesisUtterance(texto);
    voz.lang = 'pt-BR';
    voz.rate = 1.0; // Velocidade normal
    window.speechSynthesis.speak(voz);
}

// CORREÇÃO: Função atualizada para usar o proxy novo e ler o JSON direto
async function buscarComTentativas(url, tentativa = 1) {
    try {
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error(`Erro HTTP: ${resposta.status}`);
        
        return await resposta.json(); 
        
    } catch (erro) {
        if (tentativa < MAX_TENTATIVAS) {
            console.log(`Tentativa ${tentativa} falhou, tentando novamente...`);
            await new Promise(resolve => setTimeout(resolve, TEMPO_ESPERA));
            return buscarComTentativas(url, tentativa + 1);
        }
        throw new Error(`Falhou após ${MAX_TENTATIVAS} tentativas. Verifique a conexão com a API.`);
    }
}

// Consome a sua API do Vercel e lista a operação
async function carregarAuditoriaOperacional(numLinha) {
    const painelAuditoria = document.getElementById("painelAuditoria");
    if (!painelAuditoria) return; 

    painelAuditoria.innerHTML = "<p>⏳ Consultando escala de frota no servidor operacional...</p>";
    painelAuditoria.style.display = "block";

    try {
        const resposta = await fetch(`${API_AUDITORIA}${DATA_TESTE}`);
        const dados = await resposta.json();

        // Filtra apenas as viagens da linha que o usuário digitou
        const viagensLinha = dados.auditoria.filter(v => v.id_linha == numLinha);

        if (viagensLinha.length === 0) {
            painelAuditoria.innerHTML = `<p class="erro">ℹ️ Nenhuma operação planejada encontrada para a linha ${numLinha} no dia ${DATA_TESTE}.</p>`;
            return;
        }

        const nomeRota = viagensLinha[0].nome_linha;
        const origem = viagensLinha[0].terminal_saida;
        const destino = viagensLinha[0].terminal_chegada;

        // Monta uma tabela visual no projeto
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
        painelAuditoria.innerHTML = `<p class="erro">❌ Falha ao carregar inteligência operacional: ${erro.message}</p>`;
    }
}

async function carregarRota() {
    const numLinha = document.getElementById("linha").value.trim();
    const sentido = document.getElementById("sentido").value;
    const botao = document.getElementById("btnCarregar");
    const infoDiv = document.getElementById("infoRota");

    if (!numLinha) {
        alert("⚠️ Digite o número da linha!");
        return;
    }

    botao.textContent = "⏳ Carregando...";
    botao.disabled = true;
    infoDiv.style.display = "none";
    infoDiv.className = "card";

    // Reseta o status de rota ao carregar uma nova
    isForaDaRota = false;

    // Dispara a consulta à sua nova API em paralelo
    carregarAuditoriaOperacional(numLinha);

    try {
        // CORREÇÃO: Utilizando o corsproxy.io que não sofre timeout facilmente
        const urlProxy = `https://corsproxy.io/?${encodeURIComponent(API_ITINERARIO + numLinha)}`;
        const dados = await buscarComTentativas(urlProxy);
        
        const listaPontos = Array.isArray(dados) ? dados : (dados.data || dados.itinerario || dados.pontos || []);

        if (!Array.isArray(listaPontos)) {
            throw new Error("O formato dos dados não é uma lista válida de itinerários.");
        }

        const pontosFiltrados = listaPontos.filter(ponto => 
            ponto.sentido && ponto.sentido.toLowerCase() === sentido.toLowerCase()
        );

        if (pontosFiltrados.length === 0) {
            infoDiv.innerHTML = `<p class="erro">ℹ️ Nenhum ponto encontrado para a linha ${numLinha} no sentido ${sentido}.</p>`;
            infoDiv.style.display = "block";
            return;
        }

        const coordenadas = pontosFiltrados.map(ponto => [
            parseFloat(ponto.latitude), 
            parseFloat(ponto.longitude)
        ]);

        if (rotaDesenhada) map.removeLayer(rotaDesenhada);

        rotaDesenhada = L.polyline(coordenadas, {
            color: '#2563eb',
            weight: 5,
            opacity: 0.9
        }).addTo(map);

        map.fitBounds(rotaDesenhada.getBounds(), { padding: [20, 20] });

        infoDiv.innerHTML = `
            <h3>Linha ${numLinha} - Sentido ${sentido}</h3>
            <p>Total de pontos base: ${pontosFiltrados.length}</p>
            <p class="aviso">✅ Rota carregada. Siga a linha azul no mapa.</p>
        `;
        infoDiv.style.display = "block";

    } catch (erro) {
        infoDiv.innerHTML = `<p class="erro">❌ ${erro.message}</p>`;
        infoDiv.style.display = "block";
    } finally {
        botao.textContent = "🚀 Carregar e Desenhar Rota";
        botao.disabled = false;
    }
}

function localizarUsuario() {
    const infoLocal = document.getElementById("localizacaoInfo");
    const botao = document.getElementById("btnLocalizar");

    if (!navigator.geolocation) {
        infoLocal.innerHTML = `<p class="erro">❌ GPS não suportado no seu navegador.</p>`;
        infoLocal.style.display = "block";
        return;
    }

    if (watchId !== null) {
        // Pausar rastreamento
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        botao.textContent = "📍 Iniciar Rastreamento";
        botao.style.background = "#16a34a";
        infoLocal.innerHTML += `<p class="aviso">🛑 Rastreamento pausado.</p>`;
        falar("Rastreamento pausado.");
        return;
    }

    // Iniciar rastreamento
    botao.textContent = "🔄 Rastreando... (Clique para Parar)";
    botao.style.background = "#d97706"; 
    infoLocal.style.display = "none";
    
    // Desbloqueia o áudio no navegador com uma mensagem inicial
    falar("Rastreamento iniciado.");

    watchId = navigator.geolocation.watchPosition(
        (posicao) => {
            const lat = posicao.coords.latitude;
            const lng = posicao.coords.longitude;
            const precisao = (posicao.coords.accuracy / 1000).toFixed(2);
            const latLngAtual = L.latLng(lat, lng);

            // Atualiza marcador no mapa
            if (marcadorUsuario) {
                marcadorUsuario.setLatLng(latLngAtual);
                marcadorUsuario.getPopup().setContent(`<strong>Você está aqui</strong>`);
            } else {
                marcadorUsuario = L.marker(latLngAtual, {
                    title: "Você está aqui",
                    icon: L.icon({
                        iconUrl: 'https://cdn-icons-png.flaticon.com/32/149/149060.png',
                        iconSize: [32, 32],
                        iconAnchor: [16, 32]
                    })
                }).addTo(map).bindPopup(`<strong>Você está aqui</strong>`).openPopup();
            }

            map.setView(latLngAtual, 16);

            let statusRotaHtml = "";

            // Lógica de desvio de rota usando Web Speech API
            if (rotaDesenhada) {
                const pontosRota = rotaDesenhada.getLatLngs();
                let menorDistancia = Infinity;

                // Calcula a distância do usuário para o ponto mais próximo da rota
                for (let i = 0; i < pontosRota.length; i++) {
                    let distanciaPonto = latLngAtual.distanceTo(pontosRota[i]);
                    if (distanciaPonto < menorDistancia) {
                        menorDistancia = distanciaPonto;
                    }
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

            infoLocal.innerHTML = `
                <p class="localizacao">📍 <strong>Rastreamento Ativo:</strong><br>
                Precisão: ~${precisao} metros ${statusRotaHtml}</p>
            `;
            infoLocal.style.display = "block";
        },
        (erro) => {
            let mensagem = "Não foi possível obter sua localização.";
            if (erro.code === 1) mensagem = "⚠️ Permissão negada. Ative a localização no navegador.";
            if (erro.code === 2) mensagem = "⚠️ Sinal de GPS indisponível.";
            if (erro.code === 3) mensagem = "⚠️ Tempo esgotado. Tente novamente.";
            infoLocal.innerHTML = `<p class="erro">${mensagem}</p>`;
            infoLocal.style.display = "block";
            
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            botao.textContent = "📍 Iniciar Rastreamento";
            botao.style.background = "#16a34a";
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

window.onload = () => {
    inicializarMapa();
    document.getElementById("btnCarregar").addEventListener("click", carregarRota);
    document.getElementById("btnLocalizar").addEventListener("click", localizarUsuario);
};
