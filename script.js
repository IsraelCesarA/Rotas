const API_ITINERARIO = "https://info-bus-fortaleza.vercel.app/api/pontos-itinerarios/";
let map, rotaDesenhada = null, marcadorUsuario = null;
const MAX_TENTATIVAS = 6;
const TEMPO_ESPERA = 1200; 

// Inicializa o mapa focado em Fortaleza
function inicializarMapa() {
    map = L.map('map').setView([-3.7319, -38.5267], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
}

// Função de busca adaptada para ler a resposta encapsulada do allOrigins (/get)
async function buscarComTentativas(url, tentativa = 1) {
    try {
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error(`Erro HTTP: ${resposta.status}`);
        
        const jsonAllOrigins = await resposta.json();
        
        try {
            // O conteúdo real retornado pela API original fica dentro de .contents
            return JSON.parse(jsonAllOrigins.contents);
        } catch (e) {
            throw new Error("A API não retornou um JSON válido dentro do payload.");
        }
    } catch (erro) {
        if (tentativa < MAX_TENTATIVAS) {
            console.log(`Tentativa ${tentativa} falhou, tentando novamente...`);
            await new Promise(resolve => setTimeout(resolve, TEMPO_ESPERA));
            return buscarComTentativas(url, tentativa + 1);
        }
        throw new Error(`Falhou após ${MAX_TENTATIVAS} tentativas. Verifique a conexão com a API.`);
    }
}

// Carregar e desenhar rota no mapa
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

    try {
        // Utilizando o endpoint /get para evitar completamente problemas de CORS no GitHub Pages
        const urlProxy = `https://api.allorigins.win/get?url=${encodeURIComponent(API_ITINERARIO + numLinha)}`;
        const dados = await buscarComTentativas(urlProxy);
        
        console.log("Dados brutos recebidos:", dados);

        // Tratamento para encontrar a lista de pontos dentro do objeto retornado
        const listaPontos = Array.isArray(dados) ? dados : (dados.data || dados.itinerario || dados.pontos || []);

        if (!Array.isArray(listaPontos)) {
            throw new Error("O formato dos dados não é uma lista válida de itinerários.");
        }

        // Filtro condicional por sentido (Ida/Volta) tolerante a maiúsculas
        const pontosFiltrados = listaPontos.filter(ponto => 
            ponto.sentido && ponto.sentido.toLowerCase() === sentido.toLowerCase()
        );

        if (pontosFiltrados.length === 0) {
            infoDiv.innerHTML = `<p class="erro">ℹ️ Nenhum ponto encontrado para a linha ${numLinha} no sentido ${sentido}. Verifique se a linha informada está correta.</p>`;
            infoDiv.style.display = "block";
            return;
        }

        // Mapeamento e parsing das coordenadas geográficas
        const coordenadas = pontosFiltrados.map(ponto => [
            parseFloat(ponto.latitude), 
            parseFloat(ponto.longitude)
        ]);

        // Remove a rota anterior se ela já existir no mapa
        if (rotaDesenhada) map.removeLayer(rotaDesenhada);

        // Desenha a nova linha de trajeto
        rotaDesenhada = L.polyline(coordenadas, {
            color: '#2563eb',
            weight: 5,
            opacity: 0.9
        }).addTo(map);

        // Ajusta o zoom do mapa para enquadrar a rota inteira perfeitamente
        map.fitBounds(rotaDesenhada.getBounds(), { padding: [20, 20] });

        // Cálculo analítico da distância acumulada em quilômetros (Fórmula de Haversine)
        let distanciaKm = 0;
        const raioTerra = 6371;
        for (let i = 1; i < coordenadas.length; i++) {
            const [lat1, lon1] = coordenadas[i-1];
            const [lat2, lon2] = coordenadas[i];
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
            distanciaKm += raioTerra * 2 * Math.atan2(Math.sqrt(Math.abs(a)), Math.sqrt(Math.abs(1-a)));
        }

        infoDiv.innerHTML = `
            <h3>Linha ${numLinha} - Sentido ${sentido}</h3>
            <p>Total de pontos: ${pontosFiltrados.length}</p>
            <p>Distância aproximada: ${distanciaKm.toFixed(2)} km</p>
            <p class="aviso">✅ Rota carregada com sucesso!</p>
        `;
        infoDiv.style.display = "block";

    } catch (erro) {
        console.error("Erro capturado:", erro);
        infoDiv.innerHTML = `<p class="erro">❌ ${erro.message}</p>`;
        infoDiv.style.display = "block";
    } finally {
        botao.textContent = "🚀 Carregar e Desenhar Rota";
        botao.disabled = false;
    }
}

// Obtém a geolocalização atual do usuário via GPS do dispositivo
function localizarUsuario() {
    const infoLocal = document.getElementById("localizacaoInfo");
    const botao = document.getElementById("btnLocalizar");

    if (!navigator.geolocation) {
        infoLocal.innerHTML = `<p class="erro">❌ GPS não suportado no seu navegador.</p>`;
        infoLocal.style.display = "block";
        return;
    }

    botao.textContent = "⏳ Obtendo localização...";
    botao.disabled = true;
    infoLocal.style.display = "none";

    navigator.geolocation.getCurrentPosition(
        (posicao) => {
            const lat = posicao.coords.latitude.toFixed(5);
            const lng = posicao.coords.longitude.toFixed(5);
            const precisao = (posicao.coords.accuracy / 1000).toFixed(2);

            if (marcadorUsuario) map.removeLayer(marcadorUsuario);

            marcadorUsuario = L.marker([lat, lng], {
                title: "Você está aqui",
                icon: L.icon({
                    iconUrl: 'https://cdn-icons-png.flaticon.com/32/149/149060.png',
                    iconSize: [32, 32],
                    iconAnchor: [16, 32]
                })
            }).addTo(map).bindPopup(`<strong>Você está aqui</strong><br>Lat: ${lat}<br>Lon: ${lng}`).openPopup();

            map.setView([lat, lng], 15);

            infoLocal.innerHTML = `
                <p class="localizacao">📍 <strong>Sua localização:</strong><br>
                Latitude: ${lat} | Longitude: ${lng}<br>
                Precisão: ~${precisao} metros</p>
            `;
            infoLocal.style.display = "block";
        },
        (erro) => {
            let mensagem = "Não foi possível obter sua localização.";
            if (erro.code === 1) mensagem = "⚠️ Permissão negada. Ative a localização no navegador.";
            if (erro.code === 2) mensagem = "⚠️ Sinal de GPS indisponível.";
            if (erro.code === 3) message = "⚠️ Tempo esgotado. Tente novamente.";
            infoLocal.innerHTML = `<p class="erro">${mensagem}</p>`;
            infoLocal.style.display = "block";
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
    );

    setTimeout(() => {
        botao.textContent = "📍 Me Localizar";
        botao.disabled = false;
    }, 1500);
}

// Inicializa os escutadores de eventos ao carregar a janela
window.onload = () => {
    inicializarMapa();
    document.getElementById("btnCarregar").addEventListener("click", carregarRota);
    document.getElementById("btnLocalizar").addEventListener("click", localizarUsuario);
};
