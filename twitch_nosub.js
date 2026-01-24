const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// --- OUTILS ---
function safeText(str) {
    if (!str) return "";
    return str.replace(/"/g, "'").replace(/[\r\n]+/g, " ").trim();
}

function formatDate(isoString) {
    if (!isoString) return "Inconnu";
    const d = new Date(isoString);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

// --- 1. RECHERCHE (Inspiré de Purstream : on renvoie des items avec un ID unique) ---
async function searchResults(keyword) {
    try {
        const cleanKeyword = keyword.trim().toLowerCase();
        
        // On récupère le profil ET les vidéos pour tout afficher d'un coup
        const query = {
            query: `query {
                user(login: "${cleanKeyword}") {
                    login
                    videos(first: 20) {
                        edges {
                            node {
                                id
                                title
                                publishedAt
                                previewThumbnailURL(height: 360, width: 640)
                            }
                        }
                    }
                    stream {
                        id
                        title
                        game { name }
                        previewImage { url }
                    }
                }
            }`
        };

        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;
        
        const results = [];

        // A. SI LIVE EN COURS (Traité comme un "Film" en vedette)
        if (user?.stream) {
            const stream = user.stream;
            let img = stream.previewImage?.url 
                ? stream.previewImage.url.replace("{width}", "1280").replace("{height}", "720")
                : "https://pngimg.com/uploads/twitch/twitch_PNG13.png";

            results.push({
                title: "🔴 EN DIRECT : " + safeText(stream.title),
                image: img,
                // Format ID spécial : "LIVE/login"
                href: `LIVE/${user.login}`
            });
        }

        // B. LISTE DES VODS (Traitées comme des films individuels)
        const edges = user?.videos?.edges || [];
        edges.forEach(edge => {
            const video = edge.node;
            const dateStr = formatDate(video.publishedAt);
            
            let title = safeText(video.title);
            if (!title) title = `VOD du ${dateStr}`;

            let img = video.previewThumbnailURL;
            if (img && !img.includes("404_preview")) {
                img = img.replace("{width}", "1280").replace("{height}", "720");
            } else {
                img = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            }

            results.push({
                title: title,
                image: img,
                // Format ID spécial : "VOD/videoId"
                href: `VOD/${video.id}`
            });
        });

        return JSON.stringify(results);
    } catch (error) { return JSON.stringify([]); }
}

// --- 2. DÉTAILS (Inspiré de Purstream : on parse l'URL pour charger la bonne fiche) ---
async function extractDetails(url) {
    try {
        // url est du type "VOD/123456" ou "LIVE/pseudo"
        const parts = url.split('/');
        const type = parts[0];
        const id = parts[1];

        if (type === "LIVE") {
            // Fiche pour le Live
            return JSON.stringify([{
                description: "Diffusion en direct sur Twitch. Le stream est actuellement en ligne.",
                aliases: "Live Twitch",
                airdate: "Aujourd'hui"
            }]);
        } 
        else if (type === "VOD") {
            // Fiche pour une VOD spécifique (On récupère les infos détaillées)
            const query = {
                query: `query {
                    video(id: "${id}") {
                        title
                        description
                        publishedAt
                        viewCount
                        lengthSeconds
                    }
                }`
            };

            const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
            const json = await responseText.json();
            const video = json.data?.video;

            let desc = safeText(video?.description || "Aucune description");
            const dateStr = formatDate(video?.publishedAt);
            const duration = Math.floor((video?.lengthSeconds || 0) / 60);
            const views = video?.viewCount || 0;

            const fullDesc = `📅 Date: ${dateStr}\n⏱ Durée: ${duration} min\n👁 Vues: ${views}\n\n${desc}`;

            return JSON.stringify([{
                description: fullDesc,
                aliases: `${duration} min`, // Affiche la durée à la place des alias
                airdate: `Diffusé le: ${dateStr}`
            }]);
        }
        
        throw new Error("Format Inconnu");

    } catch (error) { 
        return JSON.stringify([{ description: 'Info indisponible', aliases: '', airdate: '' }]); 
    }
}

// --- 3. ÉPISODES (Inspiré de Purstream : on crée un faux épisode unique) ---
async function extractEpisodes(url) {
    try {
        const parts = url.split('/');
        const type = parts[0];
        const id = parts[1];
        
        // Comme c'est un "Film", on renvoie un seul item pour lancer la lecture
        const title = (type === "LIVE") ? "Regarder le Direct" : "Lancer la VOD";

        return JSON.stringify([
            { 
                // On passe le même ID à extractStreamUrl
                href: url, 
                number: 1, 
                title: title 
            }
        ]);
    } catch (error) { return JSON.stringify([]); }
}

// --- 4. STREAM (Gère les 2 types) ---
async function extractStreamUrl(url) {
    try {
        let streams = [];
        
        const parts = url.split('/');
        const type = parts[0];
        const id = parts[1]; // C'est soit le Login (si Live), soit l'ID Video (si VOD)

        // CAS A : LIVE (Officiel uniquement)
        if (type === "LIVE") {
            const login = id;
            try {
                const tokenQuery = {
                    operationName: "PlaybackAccessToken_Template",
                    query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } }",
                    variables: { isLive: true, login: login, isVod: false, vodID: "", playerType: "site" }
                };
                const tokenResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(tokenQuery) });
                const tokenJson = await tokenResp.json();
                const tokenData = tokenJson.data?.streamPlaybackAccessToken;
                if (tokenData) {
                    const safeToken = encodeURIComponent(tokenData.value);
                    const safeSig = encodeURIComponent(tokenData.signature);
                    streams.push({
                        title: "Live (Source)",
                        streamUrl: `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?token=${safeToken}&sig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch (e) {}
        } 
        
        // CAS B : VOD (Priorité NoSub)
        else if (type === "VOD") {
            const videoId = id;
            
            // 1. Essai NoSub (Storyboard Hack)
            try {
                const storyboardQuery = { query: `query { video(id: "${videoId}") { seekPreviewsURL } }` };
                const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(storyboardQuery) });
                const sbJson = await sbResp.json();
                const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;
                if (seekPreviewsURL) {
                    const urlParts = seekPreviewsURL.split('/storyboards/');
                    if (urlParts.length > 0) {
                        streams.push({
                            title: "VOD (NoSub - Sans Pub)",
                            streamUrl: `${urlParts[0]}/chunked/index-dvr.m3u8`,
                            headers: { "Referer": "https://www.twitch.tv/" }
                        });
                    }
                }
            } catch (e) {}

            // 2. Essai Officiel (Si NoSub échoue ou pour complément)
            try {
                const tokenQuery = {
                    operationName: "PlaybackAccessToken_Template",
                    query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }",
                    variables: { isLive: false, login: "", isVod: true, vodID: videoId, playerType: "site" }
                };
                const tokenResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(tokenQuery) });
                const tokenJson = await tokenResp.json();
                const tokenData = tokenJson.data?.videoPlaybackAccessToken;
                if (tokenData) {
                    const safeToken = encodeURIComponent(tokenData.value);
                    const safeSig = encodeURIComponent(tokenData.signature);
                    streams.push({
                        title: "VOD (Officiel)",
                        streamUrl: `https://usher.ttvnw.net/vod/${videoId}.m3u8?nauth=${safeToken}&nauthsig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch (e) {}
        }

        return JSON.stringify({ streams: streams, subtitles: [] });
    } catch (error) { return JSON.stringify({ streams: [], subtitles: [] }); }
}

// --- UTILITAIRE SORA ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
        else return await fetch(url, options);
    } catch (e) { try { return await fetch(url, options); } catch (error) { return null; } }
}
