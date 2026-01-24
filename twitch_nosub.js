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
    // Force le format Jour/Mois/Année (ex: 24/01/2025)
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

// --- 1. RECHERCHE (Affiche les 20 dernières VODs) ---
async function searchResults(keyword) {
    try {
        const cleanKeyword = keyword.trim().toLowerCase();
        
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
                }
            }`
        };

        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;
        const edges = user?.videos?.edges || [];

        const results = edges.map(edge => {
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

            return {
                title: title,
                image: img,
                // ASTUCE : On ajoute l'ID de la vidéo à l'URL pour la rendre unique
                // L'app affichera donc bien 20 résultats distincts.
                // On sépare par un '|' pour pouvoir retrouver le login après.
                href: `${user.login}|${video.id}` 
            };
        });

        return JSON.stringify(results);
    } catch (error) { return JSON.stringify([]); }
}

// --- 2. DÉTAILS ---
async function extractDetails(idStr) {
    try {
        // On récupère juste le login (avant le '|')
        const login = idStr.split('|')[0];

        const query = { query: `query { user(login: "${login}") { description createdAt } }` };
        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;
        
        const desc = safeText(user?.description || 'Chaine Twitch');
        const creationDate = formatDate(user?.createdAt);

        return JSON.stringify([{
            description: desc,
            aliases: 'Twitch',
            airdate: creationDate // Date de création de la chaîne (info "Série")
        }]);
    } catch (error) { return JSON.stringify([{ description: 'Info indisponible', aliases: '', airdate: '' }]); }
}

// --- 3. ÉPISODES ---
async function extractEpisodes(idStr) {
    try {
        // On récupère juste le login (avant le '|') pour charger TOUTE la liste
        const login = idStr.split('|')[0];
        
        const episodes = [];

        // LIVE
        try {
            const queryLive = { query: `query { user(login: "${login}") { stream { id title game { name } previewImage { url } } } }` };
            const respLive = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(queryLive) });
            const jsonLive = await respLive.json();
            const currentStream = jsonLive.data?.user?.stream;

            if (currentStream) {
                const gameName = safeText(currentStream.game?.name || "Jeu");
                const liveTitle = safeText(currentStream.title || "Live en cours");
                let liveImg = "https://pngimg.com/uploads/twitch/twitch_PNG13.png";
                if (currentStream.previewImage?.url) {
                    liveImg = currentStream.previewImage.url.replace("{width}", "1280").replace("{height}", "720");
                }
                episodes.push({
                    href: "LIVE_" + login,
                    number: 0,
                    season: 1,
                    title: "🔴 LIVE : " + liveTitle,
                    name: "🔴 LIVE : " + liveTitle,
                    image: liveImg,
                    thumbnail: liveImg,
                    duration: "LIVE",
                    description: `Jeu : ${gameName}\n${liveTitle}`
                });
            }
        } catch (e) {}

        // VODS
        try {
            const queryVideos = { query: `query { user(login: "${login}") { videos(first: 20) { edges { node { id, title, publishedAt, lengthSeconds, previewThumbnailURL(height: 360, width: 640) } } } } }` };
            const respVideos = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(queryVideos) });
            const jsonVideos = await respVideos.json();
            const edges = jsonVideos.data?.user?.videos?.edges || [];

            edges.forEach((edge, index) => {
                const video = edge.node;
                const dateStr = formatDate(video.publishedAt);
                
                let realTitle = safeText(video.title);
                if (!realTitle) { realTitle = `VOD du ${dateStr}`; }

                let imgUrl = video.previewThumbnailURL;
                if (!imgUrl || imgUrl.includes("404_preview")) {
                    imgUrl = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
                } else {
                    imgUrl = imgUrl.replace("{width}", "1280").replace("{height}", "720");
                }
                const minutes = Math.floor(video.lengthSeconds / 60);

                episodes.push({
                    href: video.id,
                    number: index + 1,
                    season: 1,
                    title: realTitle,
                    name: realTitle,
                    image: imgUrl,
                    thumbnail: imgUrl,
                    duration: `${minutes} min`,
                    description: `${realTitle}\nDiffusé le : ${dateStr}`
                });
            });
        } catch (e) {}

        return JSON.stringify(episodes);
    } catch (error) { return JSON.stringify([]); }
}

// --- 4. STREAM ---
async function extractStreamUrl(vodId) {
    try {
        let streams = [];
        const isLive = vodId.toString().startsWith("LIVE_");
        let login = "";
        let realVodId = vodId;

        if (isLive) login = vodId.replace("LIVE_", "");
        else realVodId = vodId;

        if (isLive) {
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
                        title: "Live (Officiel)",
                        streamUrl: `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?token=${safeToken}&sig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch (e) {}
        } else {
            try {
                const storyboardQuery = { query: `query { video(id: "${realVodId}") { seekPreviewsURL } }` };
                const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(storyboardQuery) });
                const sbJson = await sbResp.json();
                const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;
                if (seekPreviewsURL) {
                    const urlParts = seekPreviewsURL.split('/storyboards/');
                    if (urlParts.length > 0) {
                        streams.push({
                            title: "Lecture VOD (NoSub)",
                            streamUrl: `${urlParts[0]}/chunked/index-dvr.m3u8`,
                            headers: { "Referer": "https://www.twitch.tv/" }
                        });
                    }
                }
            } catch (e) {}
        }
        return JSON.stringify({ streams: streams, subtitles: [] });
    } catch (error) { return JSON.stringify({ streams: [], subtitles: [] }); }
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
        else return await fetch(url, options);
    } catch (e) { try { return await fetch(url, options); } catch (error) { return null; } }
}
