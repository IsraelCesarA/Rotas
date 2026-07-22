const API_ITINERARIO = "https://info-bus-fortaleza.vercel.app/api/pontos-itinerarios/";
let map, rotaDesenhada = null, marcadorUsuario = null, watchId = null;

let isForaDaRota = false;
const LIMITE_DISTANCIA_METROS = 60; 
const MAX_TENTATIVAS = 5;
const TEMPO_ESPERA = 1000; 
let wakeLock = null;


// ✅ Inicializa o mapa logo no início
function inicializarMapa() {
    try {
        map = L.map('map').setView([-3.7319, -38.5267], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);
        console.log("✅ Mapa inicializado com sucesso");
    } catch (e) {
        console.error("❌ Erro ao inicializar mapa:", e);
    }
}


// 🔄 Trata diferentes formatos de retorno da API
async function buscarComTentativas(url, tentativa = 1) {
    try {
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error(`Erro HTTP: ${resposta.status}`);
        
        const texto = await resposta.text();
        let dados;

        try {
            const json = JSON.parse(texto);
            // Se vier do proxy allorigins
            if (json.contents) {
                try { dados = JSON.parse(json.contents); } 
                catch { dados = json.contents; }
            } else {
                // Se vier direto o array da API
                dados = json;
            }

            // Normaliza para pegar o array real
            if (Array.isArray(dados)) return dados;
            if (Array.isArray(dados?.data)) return dados.data;
            if (Array.isArray(dados?.itinerario)) return dados.itinerario;
            if (Array.isArray(dados?.pontos)) return dados.pontos;

            throw new Error("Formato de dados não reconhecido");

        } catch (erroParse) {
            throw new Error("Conteúdo inválido recebido");
        }

    } catch (erro) {
        if (tentativa < MAX_TENTATIVAS) {
            console.log(`Tentativa ${tentativa} falhou... tentando novamente`);
            await new Promise(resolve => setTimeout(resolve, TEMPO_ESPERA));
            return buscarComTentativas(url, tentativa + 1);
        }
        throw new Error(`Falhou após ${MAX_TENTATIVAS} tentativas: ${erro.message}`);
    }
}


function alternarTelaCheia() {
    const elem = document.getElementById('map');
    if (!document.fullscreenElement) elem.requestFullscreen().catch(err => console.log("Tela cheia:", err));
    else document.exitFullscreen();
}

document.addEventListener('fullscreenchange', () => {
    const btnPrincipal = document.getElementById('btnTelaCheia');
    const btnSair = document.getElementById('btnSairTela');
    
    if (document.fullscreenElement) {
        btnPrincipal.textContent = "⛶ Sair da Tela Cheia";
        btnSair.style.display = "block";
    } else {
        btnPrincipal.textContent = "⛶ Mapa em Tela Cheia";
        btnSair.style.display = "none";
    }
    if (map) map.invalidateSize();
});

document.getElementById('btnSairTela').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
});


function falar(texto) {
    const checkboxVoz = document.getElementById("vozAtiva");
    if (!checkboxVoz || !checkboxVoz.checked) return;
    window.speechSynthesis.cancel();
    const voz = new SpeechSynthesisUtterance(texto);
    voz.lang = 'pt-BR';
    voz.rate = 1.0; 
    window.speechSynthesis.speak(voz);
}


async function carregarRota(forcarInternet = false) {
    if (!map) { alert("Mapa ainda não carregado, aguarde um instante"); return; }

    const numLinha = document.getElementById("linha").value.trim();
    const sentido = document.getElementById("sentido").value;
    const botaoC = document.getElementById("btnCarregar");
    const botaoA = document.getElementById("btnAtualizar");
    const infoDiv = document.getElementById("infoRota");

    if (!numLinha) { alert("⚠️ Digite o número da linha!"); return; }

    botaoC.disabled = true;
    botaoA.disabled = true;
    infoDiv.style.display = "none";
    infoDiv.className = "card";
    isForaDaRota = false;

    const chaveCache = `rota_frotas_${numLinha}_${sentido}`;
    let dados, mensagemOrigem = "";

    try {
        const cacheSalvo = localStorage.getItem(chaveCache);

        if (cacheSalvo && !forcarInternet) {
            dados = JSON.parse(cacheSalvo);
            mensagemOrigem = `<p class="aviso" style="color:#0284c7;">⚡ Rota carregada da memória do celular</p>`;
        } else {
            if (forcarInternet) botaoA.textContent = "⏳ Baixando...";
            else botaoC.textContent = "⏳ Consultando rota...";

            // Tenta direto primeiro, usa proxy se precisar
            try {
                dados = await buscarComTentativas(API_ITINERARIO + numLinha);
            } catch {
                console.log("Usando proxy...");
                dados = await buscarComTentativas(`https://api.allorigins.win/get?url=${encodeURIComponent(API_ITINERARIO + numLinha)}`);
            }

            localStorage.setItem(chaveCache, JSON.stringify(dados));
            mensagemOrigem = `<p class="aviso" style="color:#16a34a;">🌐 Rota baixada e salva no celular</p>`;
        }

        // Filtro adaptado exatamente ao formato que você enviou
        const pontosFiltrados = dados.filter(ponto => {
            if (!ponto.latitude || !ponto.longitude || !ponto.sentido) return false;
            return ponto.sentido.trim().toLowerCase() === sentido.trim().toLowerCase();
        });

        if (pontosFiltrados.length === 0) {
            infoDiv.innerHTML = `<p class="erro">ℹ️ Nenhum ponto encontrado para linha ${numLinha} - ${sentido}.</p>`;
            infoDiv.style.display = "block";
            return;
        }

        const coordenadas = pontosFiltrados.map(ponto => [
            parseFloat(ponto.latitude), 
            parseFloat(ponto.longitude)
        ]);

        if (rotaDesenhada) map.removeLayer(rotaDesenhada);
        rotaDesenhada = L.polyline(coordenadas, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map);
        map.fitBounds(rotaDesenhada.getBounds(), { padding: [25, 25] });

        infoDiv.innerHTML = `
            <h3>Linha ${numLinha} - Sentido ${sentido}</h3>
            ${mensagemOrigem}
            <p>Pontos mapeados: ${pontosFiltrados.length}</p>
        `;
        infoDiv.style.display = "block";

    } catch (erro) {
        infoDiv.innerHTML = `<p class="erro">❌ Erro: ${erro.message}</p>`;
        infoDiv.style.display = "block";
        console.error("Detalhes:", erro);
    } finally {
        botaoC.textContent = "🚀 Carregar Rota";
        botaoA.textContent = "🔄 Baixar rota atualizada";
        botaoC.disabled = botaoA.disabled = false;
    }
}


async function controlarTela(manterAcesa) {
    if ('wakeLock' in navigator) {
        try {
            if (manterAcesa) wakeLock = await navigator.wakeLock.request('screen');
            else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
        } catch (err) { console.error("WakeLock:", err); }
    }
}


function localizarUsuario() {
    if (!map) { alert("Mapa ainda não carregado"); return; }

    const infoLocal = document.getElementById("localizacaoInfo");
    const botao = document.getElementById("btnLocalizar");
    const checkboxNavegacao = document.getElementById("modoNavegacao");

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
        controlarTela(false);
        return;
    }

    botao.textContent = "🔄 Rastreando...";
    botao.style.background = "#d97706"; 
    infoLocal.style.display = "none";
    falar("Rastreamento iniciado.");
    if (checkboxNavegacao.checked) controlarTela(true);

    let primeiraVez = true;
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const latLng = L.latLng(pos.coords.latitude, pos.coords.longitude);
            const precisao = (pos.coords.accuracy / 1000).toFixed(2);

            if (marcadorUsuario) marcadorUsuario.setLatLng(latLng);
            else marcadorUsuario = L.marker(latLng, {
                icon: L.icon({
                    iconUrl:'https://cdn-icons-png.flaticon.com/32/149/149060.png',
                    iconSize:[32,32], iconAnchor:[16,32]
                })
            }).addTo(map).bindPopup(`<strong>Você está aqui</strong>`);

            if (primeiraVez) { map.setView(latLng,16); primeiraVez=false; }
            else if (checkboxNavegacao.checked) map.setView(latLng,18);

            let status = "";
            if (rotaDesenhada) {
                const pontos = rotaDesenhada.getLatLngs();
                let menor = Math.min(...pontos.map(p => latLng.distanceTo(p)));

                if (menor > LIMITE_DISTANCIA_METROS && !isForaDaRota) {
                    isForaDaRota = true;
                    falar("Atenção! Você saiu da rota da linha.");
                } else if (menor <= LIMITE_DISTANCIA_METROS && isForaDaRota) {
                    isForaDaRota = false;
                    falar("Você retornou à rota correta.");
                }

                status = isForaDaRota 
                    ? `<br><strong style="color:#dc2626;">⚠️ Fora da rota (${Math.round(menor)}m)</strong>` 
                    : `<br><strong style="color:#16a34a;">✅ Na rota correta</strong>`;
            }

            infoLocal.innerHTML = `<p class="localizacao">📍 Rastreamento Ativo<br>Precisão: ~${precisao} metros ${status}</p>`;
            infoLocal.style.display = "block";
        },
        (erro) => {
            infoLocal.innerHTML = `<p class="erro">⚠️ Sinal de GPS fraco ou permissão negada.</p>`;
            infoLocal.style.display = "block";
            watchId = null;
            botao.textContent = "📍 Iniciar Rastreamento";
            botao.style.background = "#16a34a";
            controlarTela(false);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}


window.onload = () => {
    inicializarMapa();
    
    document.getElementById("btnCarregar").addEventListener("click", () => carregarRota(false));
    document.getElementById("btnAtualizar").addEventListener("click", () => carregarRota(true));
    document.getElementById("btnLocalizar").addEventListener("click", localizarUsuario);
    document.getElementById("btnTelaCheia").addEventListener("click", alternarTelaCheia);
    document.getElementById("modoNavegacao").addEventListener("change", e => {
        if (watchId) controlarTela(e.target.checked);
        if (e.target.checked && marcadorUsuario) map.setView(marcadorUsuario.getLatLng(),18);
    });
};
