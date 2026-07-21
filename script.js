const API_ITINERARIO = "https://info-bus-fortaleza.vercel.app/api/pontos-itinerarios/";
let map, rotaDesenhada = null, marcadorUsuario = null, watchId = null;

let isForaDaRota = false;
const LIMITE_DISTANCIA_METROS = 60; 

const MAX_TENTATIVAS = 6;
const TEMPO_ESPERA = 1200; 

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

async function buscarComTentativas(url, tentativa = 1) {
    try {
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error(`Erro HTTP: ${resposta.status}`);
        
        const jsonAllOrigins = await resposta.json();
        try {
            return JSON.parse(jsonAllOrigins.contents);
        } catch (e) {
            throw new Error("A API não retornou um JSON válido.");
        }
    } catch (erro) {
        if (tentativa < MAX_TENTATIVAS) {
            console.log(`Tentativa ${tentativa} falhou, tentando novamente...`);
            await new Promise(resolve => setTimeout(resolve, TEMPO_ESPERA));
            return buscarComTentativas(url, tentativa + 1);
        }
        throw new Error(`Falhou após ${MAX_TENTATIVAS} tentativas de acesso à rede.`);
    }
}

// O parâmetro "forcarInternet" decide se vai olhar no cache ou se vai ignorar e baixar de novo
async function carregarRota(forcarInternet = false) {
    const numLinha = document.getElementById("linha").value.trim();
    const sentido = document.getElementById("sentido").value;
    const botaoC = document.getElementById("btnCarregar");
    const botaoA = document.getElementById("btnAtualizar");
    const infoDiv = document.getElementById("infoRota");

    if (!numLinha) {
        alert("⚠️ Digite o número da linha!");
        return;
    }

    botaoC.disabled = true;
    botaoA.disabled = true;
    infoDiv.style.display = "none";
    infoDiv.className = "card";
    isForaDaRota = false;

    // Chave única para salvar essa linha no celular
    const chaveCache = `rota_frotas_${numLinha}`;
    let dados;
    let mensagemOrigem = "";

    try {
        const cacheSalvo = localStorage.getItem(chaveCache);

        // LÓGICA DE CACHE: Tem no celular e NÃO é para forçar o download?
        if (cacheSalvo && !forcarInternet) {
            console.log("Carregando rota direto da memória do telefone...");
            dados = JSON.parse(cacheSalvo);
            mensagemOrigem = `<p class="aviso" style="color:#0284c7;">⚡ Rota carregada rapidamente da memória do celular.</p>`;
        } else {
            console.log("Baixando da internet...");
            if (forcarInternet) botaoA.textContent = "⏳ Baixando...";
            else botaoC.textContent = "⏳ Baixando da internet...";

            const urlProxy = `https://api.allorigins.win/get?url=${encodeURIComponent(API_ITINERARIO + numLinha)}`;
            dados = await buscarComTentativas(urlProxy);
            
            // Salva os dados baixados no armazenamento do telefone para as próximas vezes
            localStorage.setItem(chaveCache, JSON.stringify(dados));
            mensagemOrigem = `<p class="aviso" style="color:#16a34a;">🌐 Rota baixada da API e agora está salva neste celular.</p>`;
        }

        const listaPontos = Array.isArray(dados) ? dados : (dados.data || dados.itinerario || dados.pontos || []);

        if (!Array.isArray(listaPontos)) throw new Error("Formato inválido retornado pela API.");

        const pontosFiltrados = listaPontos.filter(ponto => 
            ponto.sentido && ponto.sentido.toLowerCase() === sentido.toLowerCase()
        );

        if (pontosFiltrados.length === 0) {
            infoDiv.innerHTML = `<p class="erro">ℹ️ Nenhum ponto encontrado para o sentido ${sentido}. Se tiver certeza que existe, clique em 'Baixar rota atualizada da Internet'.</p>`;
            infoDiv.style.display = "block";
            return;
        }

        const coordenadas = pontosFiltrados.map(ponto => [parseFloat(ponto.latitude), parseFloat(ponto.longitude)]);

        if (rotaDesenhada) map.removeLayer(rotaDesenhada);

        rotaDesenhada = L.polyline(coordenadas, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map);
        map.fitBounds(rotaDesenhada.getBounds(), { padding: [20, 20] });

        infoDiv.innerHTML = `
            <h3>Linha ${numLinha} - Sentido ${sentido}</h3>
            ${mensagemOrigem}
            <p>Pontos da rota mapeados: ${pontosFiltrados.length}</p>
        `;
        infoDiv.style.display = "block";

    } catch (erro) {
        infoDiv.innerHTML = `<p class="erro">❌ Erro: ${erro.message}</p>`;
        infoDiv.style.display = "block";
    } finally {
        botaoC.textContent = "🚀 Carregar Rota (Usa o celular se já salvo)";
        botaoA.textContent = "🔄 Baixar rota atualizada da Internet";
        botaoC.disabled = false;
        botaoA.disabled = false;
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
                marcadorUsuario = L.marker(latLngAtual, {
                    icon: L.icon({
                        iconUrl: 'https://cdn-icons-png.flaticon.com/32/149/149060.png',
                        iconSize: [32, 32], iconAnchor: [16, 32]
                    })
                }).addTo(map).bindPopup(`<strong>Você está aqui</strong>`).openPopup();
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

            infoLocal.innerHTML = `
                <p class="localizacao">📍 <strong>Rastreamento Ativo:</strong><br>
                Precisão: ~${precisao} metros ${statusRotaHtml}</p>
            `;
            infoLocal.style.display = "block";
        },
        (erro) => {
            infoLocal.innerHTML = `<p class="erro">⚠️ Sinal de GPS fraco ou permissão negada.</p>`;
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
    // O botão principal carrega o cache se existir
    document.getElementById("btnCarregar").addEventListener("click", () => carregarRota(false));
    
    // O botão secundário força o download da internet
    document.getElementById("btnAtualizar").addEventListener("click", () => carregarRota(true));
    
    document.getElementById("btnLocalizar").addEventListener("click", localizarUsuario);
};
