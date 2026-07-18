require("dotenv").config();

const express = require("express");
const SpotifyWebApi = require("spotify-web-api-node");
const session = require("express-session");
const axios = require("axios");

const app = express();

app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: "playlistmove",
  resave: false,
  saveUninitialized: false
}));

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

app.get("/", (req, res) => {

  res.send(`
  
  <h1>PlaylistMove</h1>

  <a href="/login">
    Conectar Spotify
  </a>

  `);

});

app.get("/login", (req, res) => {

  const scopes = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read"
];

  const authorizeURL =
  spotifyApi.createAuthorizeURL(
    scopes,
    "origin"
  );

console.log("AUTHORIZE URL:", authorizeURL);

res.redirect(authorizeURL);

});

app.get("/login-destination", (req, res) => {

  const scopes = [
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-public",
    "playlist-modify-private",
    "user-library-read"
  ];

  const authorizeURL =
  spotifyApi.createAuthorizeURL(
    scopes,
    "destination"
  ) + "&show_dialog=true";

  res.redirect(authorizeURL);

});

app.get("/callback", async (req, res) => {

  const code = req.query.code;

  const state = req.query.state;

  try {

    const data =
      await spotifyApi.authorizationCodeGrant(code);

      console.log(
  "SCOPES:",
  data.body.scope
);

      if (state === "destination") {

  req.session.destinationAccessToken =
    data.body.access_token;

  req.session.destinationRefreshToken =
    data.body.refresh_token;

  spotifyApi.setAccessToken(
    data.body.access_token
  );

  const me =
    await spotifyApi.getMe();

  req.session.destinationUserId =
    me.body.id;

  return res.send(`
    <h1>Cuenta destino conectada</h1>

    <p>
      Usuario: ${me.body.display_name}
    </p>

    <a href="/transfer">
      Iniciar transferencia
    </a>
  `);

}

    spotifyApi.setAccessToken(
      data.body.access_token
    );

    spotifyApi.setRefreshToken(
      data.body.refresh_token
    );

    req.session.accessToken =
      data.body.access_token;

    req.session.refreshToken =
      data.body.refresh_token;

    res.redirect("/playlists");

  } catch (err) {

    console.log(err);

    res.send("Error");

  }

});



app.get("/playlists", async (req, res) => {

  try {

    if (!req.session.accessToken) {
      return res.redirect("/");
    }

    spotifyApi.setAccessToken(
      req.session.accessToken
    );

    const data =
      await spotifyApi.getUserPlaylists();

      const likedSongs =
  await spotifyApi.getMySavedTracks({
    limit: 1
  });

    let html = `
  <h1>Mis Playlists</h1>

  <form action="/selected" method="post">

    <label>
      <input
        type="checkbox"
        name="playlist"
        value="liked"
      >
      ❤️ Canciones que te gustan
      (${likedSongs.body.total})
    </label>

    <br><br>

    <ul>
`;

    data.body.items.forEach(p => {

  html += `
    <li>
      <input
        type="checkbox"
        name="playlist"
        value="${p.id}"
      >
      ${p.name}
    </li>
  `;

});

    html += `
  </ul>

  <br>

  <button type="submit">
    Continuar
  </button>

  </form>
`;

    res.send(html);

  } catch (err) {

    console.log(err);

    res.send("Error cargando playlists");

  }

});

app.post("/selected", (req, res) => {

  req.session.selectedPlaylists =
    req.body.playlist;

  res.send(`
    <h1>Playlists seleccionadas</h1>

    <p>
      ${Array.isArray(req.body.playlist)
        ? req.body.playlist.length
        : 1}
      elementos seleccionados
    </p>

    <a href="/connect-destination">
      Conectar cuenta destino
    </a>
  `);

});

const PORT = process.env.PORT || 3000;
app.get("/connect-destination", (req, res) => {

  res.send(`
    <h1>Cuenta destino</h1>

    <p>
      Aquí conectaremos la segunda cuenta Spotify.
    </p>

    <a href="/login-destination">
      Conectar cuenta destino
    </a>
  `);

});

app.get("/transfer", async (req, res) => {

  try {

    const selected = Array.isArray(req.session.selectedPlaylists)
      ? req.session.selectedPlaylists
      : [req.session.selectedPlaylists];

    spotifyApi.setAccessToken(req.session.accessToken);

    const destinationApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI
    });

    destinationApi.setAccessToken(
      req.session.destinationAccessToken
    );

    let resultado = "";

    for (const playlistId of selected) {

  resultado += `Procesando ${playlistId}<br>`;

  // Saltaremos "liked" por ahora
  if (playlistId === "liked") {
    resultado += "❤️ Canciones que te gustan (se implementará después)<br><br>";
    continue;
  }

  // Leer la playlist de origen
  const sourcePlaylist =
    await spotifyApi.getPlaylist(playlistId);

  // Obtener las URIs de las canciones
  const trackUris =
    sourcePlaylist.body.tracks.items
      .filter(t => t.track)
      .map(t => t.track.uri);

  // Crear la playlist en la cuenta destino
  const newPlaylist =
    await destinationApi.createPlaylist(
      sourcePlaylist.body.name,
      {
        description: sourcePlaylist.body.description || "",
        public: sourcePlaylist.body.public
      }
    );

  // Agregar las canciones
  if (trackUris.length > 0) {

    await axios.post(
      `https://api.spotify.com/v1/playlists/${newPlaylist.body.id}/tracks`,
      {
        uris: trackUris
      },
      {
        headers: {
          Authorization: `Bearer ${req.session.destinationAccessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

  }

  resultado += `✅ Copiada: ${sourcePlaylist.body.name}<br><br>`;

}

    res.send(`
      <h1>Transferencia iniciada</h1>
      ${resultado}
    `);

  } catch (err) {

  console.log("===== ERROR EN /transfer =====");
  console.log(err);

  if (err.body) {
    console.log("BODY:");
    console.log(JSON.stringify(err.body, null, 2));
  }

  if (err.response && err.response.data) {
    console.log("RESPONSE:");
    console.log(JSON.stringify(err.response.data, null, 2));
  }

  res.send("<pre>" + (err.stack || err.message || String(err)) + "</pre>");

}

});

app.get("/debug", (req, res) => {

  res.send(`
    <pre>
${JSON.stringify({
  sourceToken:
    !!req.session.accessToken,

  destinationToken:
    !!req.session.destinationAccessToken,

  destinationUserId:
    req.session.destinationUserId,

  selected:
    req.session.selectedPlaylists
}, null, 2)}
    </pre>
  `);

});

app.get("/create-test-playlist", async (req, res) => {

  try {

    const destinationApi =
      new SpotifyWebApi({
        clientId:
          process.env.SPOTIFY_CLIENT_ID,
        clientSecret:
          process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri:
          process.env.SPOTIFY_REDIRECT_URI
      });


      
    destinationApi.setAccessToken(
      req.session.destinationAccessToken
    );

    const playlist =
  await destinationApi.createPlaylist(
    "PlaylistMove Test",
    {
      description:
        "Prueba de transferencia",
      public: false
    }
  );

console.log(
  "DESTINATION USER:",
  req.session.destinationUserId
);

console.log(
  "TOKEN:",
  !!req.session.destinationAccessToken
);

console.log(
  JSON.stringify(
    playlist.body,
    null,
    2
  )
);

    res.send(`
      Playlist creada ✅

      <br><br>

      ${playlist.body.name}
    `);

  } catch (err) {

  console.log("ERROR COMPLETO:");
  console.log(err);

  if (err.body) {
    console.log("ERROR BODY:");
    console.log(JSON.stringify(err.body, null, 2));
  }

  res.send(
    "<pre>" +
    JSON.stringify(err.body || err, null, 2) +
    "</pre>"
  );

}

});

app.get("/test-read", async (req, res) => {

  try {

    spotifyApi.setAccessToken(
      req.session.accessToken
    );

    const playlistId =
      "1XBaKyBtSyRv6SJD4bD02G";

    const playlist =
      await spotifyApi.getPlaylist(
        playlistId
      );

    res.send(`
      <pre>
${JSON.stringify(
  playlist.body,
  null,
  2
)}
      </pre>
    `);

  } catch (err) {

    console.log("ERROR:");
    console.log(err.body || err);

    res.send(
      "<pre>" +
      JSON.stringify(
        err.body || err,
        null,
        2
      ) +
      "</pre>"
    );

  }

});

app.get("/copy-one", async (req, res) => {

  try {

    console.log("PASO 1");

    spotifyApi.setAccessToken(
      req.session.accessToken
    );

    console.log("PASO 2");

    const sourcePlaylist =
      await spotifyApi.getPlaylist(
        "1XBaKyBtSyRv6SJD4bD02G"
      );

    console.log("PASO 3");

    const trackUris =
      sourcePlaylist.body.items.items
        .map(t => t.item.uri);

    console.log("TRACKS:", trackUris);

    const destinationApi =
      new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI
      });

    console.log("PASO 4");

    destinationApi.setAccessToken(
      req.session.destinationAccessToken
    );

    console.log("PASO 5");

    const me =
      await destinationApi.getMe();

    console.log("DESTINO:", me.body.display_name);

    console.log("PASO 6");

    const newPlaylist =
  await destinationApi.createPlaylist(
    "Copia Alegria",
    { public: false }
  );

console.log("PASO 7");

console.log(
  "PLAYLIST ID:",
  newPlaylist.body.id
);

console.log(
  "PLAYLIST OWNER:",
  newPlaylist.body.owner.id
);

console.log(
  JSON.stringify(
    newPlaylist.body,
    null,
    2
  )
);

console.log("PASO 7.5");

console.log("TRACKS:", trackUris);

const result = await axios.post(
  `https://api.spotify.com/v1/playlists/${newPlaylist.body.id}/tracks`,
  {
    uris: trackUris
  },
  {
    headers: {
      Authorization:
        `Bearer ${req.session.destinationAccessToken}`,
      "Content-Type":
        "application/json"
    }
  }
);

console.log("AXIOS RESULT:");

console.log(
  JSON.stringify(
    result.data,
    null,
    2
  )
);

console.log("PASO 8");

console.log(
  JSON.stringify(
    result.body,
    null,
    2
  )
);

res.send(`
  Playlist copiada ✅

  <br><br>

  ${newPlaylist.body.name}
`);

    console.log("PASO 8");

    res.send("OK");

  } catch (err) {

  console.log("ERROR COMPLETO:");
  console.log(err);

  if (err.body) {
    console.log(
      JSON.stringify(
        err.body,
        null,
        2
      )
    );
  }

  res.send(
    "<pre>" +
    JSON.stringify(
      err.body || err,
      null,
      2
    ) +
    "</pre>"
  );

}

});


app.get("/me", async (req, res) => {

  try {

    const destinationApi =
      new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI
      });

    destinationApi.setAccessToken(
      req.session.destinationAccessToken
    );

    const me =
      await destinationApi.getMe();

    res.send(`
      <pre>
${JSON.stringify(
  me.body,
  null,
  2
)}
      </pre>
    `);

  } catch (err) {

    res.send(
      "<pre>" +
      JSON.stringify(
        err.body || err,
        null,
        2
      ) +
      "</pre>"
    );

  }

});

app.get("/test-add-own-track", async (req, res) => {

  try {

    const destinationApi =
      new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI
      });

    destinationApi.setAccessToken(
      req.session.destinationAccessToken
    );

    const playlist =
      await destinationApi.createPlaylist(
        "Test Directo",
        { public: false }
      );

    await destinationApi.addTracksToPlaylist(
      playlist.body.id,
      [
        "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
      ]
    );

    res.send("OK");

  } catch (err) {

    console.log(
      JSON.stringify(
        err.body || err,
        null,
        2
      )
    );

    res.send(
      "<pre>" +
      JSON.stringify(
        err.body || err,
        null,
        2
      ) +
      "</pre>"
    );

  }

});

app.get("/test-empty-add", async (req, res) => {

  try {

    const destinationApi =
      new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI
      });

    destinationApi.setAccessToken(
      req.session.destinationAccessToken
    );

    const playlist =
      await destinationApi.createPlaylist(
        "Test Empty",
        { public: false }
      );

    const result =
      await destinationApi.addTracksToPlaylist(
        playlist.body.id,
        []
      );

    res.send(
      JSON.stringify(result.body, null, 2)
    );

  } catch (err) {

    res.send(
      "<pre>" +
      JSON.stringify(
        err.body || err,
        null,
        2
      ) +
      "</pre>"
    );

  }

});

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto " + PORT);
});