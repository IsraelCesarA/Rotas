// Link para puxar as coordenadas (lat/lng)
const API_ITINERARIO = "COLOQUE_SEU_LINK_AQUI"; 
// Link da sua API no Vercel (usada apenas para pegar o NOME da rota)
const API_NOMES = "https://api-transporte-rose.vercel.app/api/programacao/dia/2026-07-13";

let map, rotaDesenhada = null, marcadorUsuario = null, watchId = null;
let isForaDaRota = false;
const LIMITE_DISTANCIA_METROS = 60; 

function inicializarMapa() {
    map = L.map('map').setView([-3.7319, -38.5267], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
}

function falar(texto) {
    const checkboxVoz = document.getElementById("vozAtiva");
    if (!checkboxVoz || !checkboxVoz.checked) return;

    window.speechSynthesis.cancel();
    const voz = new SpeechSynthesisUtterance(texto);
    voz.lang = 'pt-BR';
    voz.rate = 1.0; 
    window.speechSynthesis.speak(voz);
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

    botao.textContent = "⏳ Carregando Trajeto...";
    botao.disabled = true;
    infoDiv.innerHTML = "<p>Buscando informações da rota...</p>";
    infoDiv.style.display = "block";
    isForaDaRota = false;

    // 1. Busca apenas o Nome Oficial da Rota na sua API do Vercel
    let nomeDaRota = "Nome da rota não encontrado";
    try {
        const resNome = await fetch(API_NOMES);
        const dadosNome = await resNome.json();
        const info = dadosNome.viagens.find(v => v.id_linha == numLinha);
        if (info) {
            nomeDaRota = info.nome_linha;
        }
    } catch (e) {
        console.log("Erro ao buscar nome da rota no Supabase.");
    }

    // 2. Avisa caso o link do trajeto ainda não tenha sido colocado
    if (API_ITINERARIO === "COLOQUE_SEU_LINK_AQUI") {
        infoDiv.innerHTML = `
            <h3 style="color:#003366; margin: 0;">🚌 Linha ${numLinha}</h3>
            <p style="font-size: 16px; font-weight: bold; margin: 5px 0;">${nomeDaRota}</p>
            <p class="erro" style="margin-top: 10px;">⚠️ Adicione o link da API de coordenadas no código para desenhar o trajeto.</p>
        `;
        botao.textContent = "🚀 Carregar e Desenhar Rota";
        botao.disabled = false;
        return;
    }

    // 3. Busca as Coordenadas e Desenha o Trajeto no Mapa
    try {
        const resposta = await fetch(API_ITINERARIO + numLinha);
        if (!resposta.ok) throw new Error("Erro ao buscar coordenadas.");
        
        const dados = await resposta.json();
        const listaPontos = Array.isArray(dados) ? dados : (dados.data || dados.itinerario || dados.pontos || []);

        const pontosFiltrados = listaPontos.filter(ponto => 
            ponto.sentido && ponto.sentido.toLowerCase() === sentido.toLowerCase()
        );

        if (pontosFiltrados.length === 0) {
            throw new Error(`Nenhum ponto encontrado para o sentido ${sentido}.`);
        }

        const coordenadas = pontosFiltrados.map(ponto => [parseFloat(ponto.latitude), parseFloat(ponto.longitude)]);

        if (rotaDesenhada) map.removeLayer(rotaDesenhada);

        rotaDesenhada = L.polyline(coordenadas, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map);
        map.fitBounds(rotaDesenhada.getBounds(), { padding: [20, 20] });

        // Exibe o painel limpo com Linha, Nome e Confirmação do Trajeto
        infoDiv.innerHTML = `
            <h3 style="color:#003366; margin: 0; font-size: 22px;">🚌 Linha ${numLinha}</h3>
            <p style="font-size: 16px; font-weight: bold; color: #333; margin: 5px 0;">${nomeDaRota}</p>
            <p class="aviso" style="margin-top: 10px;">✅ Trajeto desenhado no mapa.</p>
        `;

    } catch (erro) {
        infoDiv.innerHTML = `
            <h3 style="color:#003366; margin: 0;">🚌 Linha ${numLinha}</h3>
            <p style="font-size: 16px; font-weight: bold; margin: 5px 0;">${nomeDaRota}</p>
            <p class="erro" style="margin-top: 10px;">❌ Erro no trajeto: ${erro.message}</p>
        `;
    } finally {
        botao.textContent = "🚀 Carregar e Desenhar Rota";
        botao.disabled = false;
    }
}

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

window.onload = () => {
    inicializarMapa();
    document.getElementById("btnCarregar").addEventListener("click", carregarRota);
    document.getElementById("btnLocalizar").addEventListener("click", localizarUsuario);
};
