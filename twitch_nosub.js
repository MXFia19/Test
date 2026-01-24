const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// --- OUTILS (Comme Purstream) ---
function slugify(title) {
    if (!title) return "video";
    return title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
}

function formatDate(isoString) {
    if (!isoString) return "Inconnu";
    const d = new Date(isoString);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    try {
        const cleanKeyword = keyword.trim().toLowerCase();
        
        const query = {
            query: `query {
                user(login: "${cleanKeyword}") {
                    login
                    stream { id title game { name } previewImage { url } }
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

        if (!user) return JSON.stringify([]);

        const transformedResults = [];

        // A. LIVE (Comme un film)
        if (user.stream) {
            const stream = user.stream;
            let img = stream.previewImage?.url 
                ? stream.previewImage.url.replace("{width}", "1280").replace("{height}", "720")
                : "https://pngimg.com/uploads/twitch/twitch_PNG13.png";
            
            const title = "LIVE: " + (stream.title || "Direct");
            
            // On génère une fausse URL type "movie"
            transformedResults.push({
                title: title,
                image: img,
                href: `https://twitch.tv/movie/LIVE_${user.login}-${slugify(title)}`
            });
        }

        // B. VODS (Comme des films)
        const edges = user.videos?.edges || [];
        edges.forEach(edge => {
            const video = edge.node;
            const dateStr = formatDate(video.publishedAt);
            
            let title = video.title || `VOD du ${dateStr}`;
            // Nettoyage basique pour l'affichage
            title = title.replace(/"/g, "'").trim();

            let img = video.previewThumbnailURL;
            if (img && !img.includes("404_preview")) {
                img = img.replace("{width}", "1280").replace("{height}", "720");
            } else {
                img = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            }

            transformedResults.push({
                title: title,
                image: img,
                href: `https://twitch.tv/movie/${video.id}-${slugify(title)}`
            });
        });

        return JSON.stringify(transformedResults);

    } catch (error) {
        console.log('Search error: ' + error);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(url) {
    try {
        // Extraction de l'ID via Regex (compatible format Purstream)
        // Match "movie/ID-slug" ou "movie/LIVE_pseudo-slug"
        const match = url.match(/\/movie\/([a-zA-Z0-9_]+)/);
        if (!match) throw new Error("Invalid URL format");

        const fullId = match[1]; // Ex: "123456" ou "LIVE_nikof"
        
        let desc = "";
        let dateInfo = "";
        let durationInfo = "";

        if (fullId.startsWith("LIVE_")) {
            desc = "Diffusion en direct sur Twitch.";
            dateInfo = "Aujourd'hui";
            durationInfo = "En direct";
        } else {
            // C'est une VOD, on fetch les infos
            const query = {
                query: `query {
                    video(id: "${fullId}") {
                        description
                        publishedAt
                        lengthSeconds
                        viewCount
                    }
                }`
            };
            const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
            const json = await responseText.json();
            const video = json.data?.video;

            const d = formatDate(video?.publishedAt);
            const mins = Math.floor((video?.lengthSeconds || 0) / 60);
            
            dateInfo = `Diffusé le: ${d}`;
            durationInfo = `${mins} min`;
            desc = (video?.description || "Aucune description").replace(/"/g, "'");
            
            // Ajout des vues et date dans la description visible
            desc = `📅 ${d} | 👁 ${video?.viewCount || 0} vues\n\n${desc}`;
        }

        const details = [{
            description: desc,
            aliases: durationInfo,
            airdate: dateInfo
        }];

        return JSON.stringify(details);

    } catch (error) {
        return JSON.stringify([{
            description: 'Description indisponible',
            aliases: 'N/A',
            airdate: 'N/A'
        }]);
    }
}

// --- 3. ÉPISODES (Un seul épisode "Full Movie") ---
async function extractEpisodes(url) {
    try {
        // L'url arrive au format complet, on la garde comme ID pour le stream
        const match = url.match(/\/movie\/([a-zA-Z0-9_]+)/);
        const fullId = match ? match[1] : "video";
        
        const isLive = fullId.startsWith("LIVE_");

        return JSON.stringify([
            { 
                href: url, // On repasse l'URL complète
                number: 1, 
                title: isLive ? "Regarder le Direct" : "Lancer la Vidéo" 
            }
        ]);
    } catch (error) {
        return JSON.stringify([]);
    }    
}

// --- 4. STREAM ---
async function extractStreamUrl(url) {
    try {
        let streams = [];

        // Récupération de l'ID depuis l'URL (comme dans extractDetails)
        const match = url.match(/\/movie\/([a-zA-Z0-9_]+)/);
        if (!match) return JSON.stringify({ streams: [], subtitles: "" });

        const fullId = match[1];
        
        const isLive = fullId.startsWith("LIVE_");
        let login = "";
        let videoId = "";

        if (isLive) {
            login = fullId.replace("LIVE_", "");
        } else {
            videoId = fullId;
        }

        // CAS A : LIVE
        if (isLive) {
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
        } 
        // CAS B : VOD
        else {
            // 1. NoSub (Priorité)
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

            // 2. Officiel (Secours)
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

        const results = {
            streams: streams,
            subtitles: []
        };
        return JSON.stringify(results);

    } catch (error) {
        return JSON.stringify({ streams: [], subtitles: [] });
    }
}

// --- UTILITAIRE SORA ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(
                url,
                options.headers ?? {},
                options.method ?? 'GET',
                options.body ?? null,
                true,
                options.encoding ?? 'utf-8'
            );
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
