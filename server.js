
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 60 * 1000
    }
  })
);

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI = "https://westcolclipsai.onrender.com/callback";

app.get("/", (req, res) => {
  res.send("WestcolClipsAI: servidor activo.");
});

app.get("/health", (req, res) => {
  res.json({
    estado: "ok",
    app: "WestcolClipsAI",
    oauthConfigured: Boolean(
      CLIENT_KEY && CLIENT_SECRET && process.env.SESSION_SECRET
    )
  });
});

app.get("/auth/tiktok", (req, res) => {
  if (!CLIENT_KEY || !CLIENT_SECRET || !process.env.SESSION_SECRET) {
    return res.status(500).send("Falta configurar el servidor.");
  }

  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_key: CLIENT_KEY,
    response_type: "code",
    scope: "user.info.basic",
    redirect_uri: REDIRECT_URI,
    state
  });

  res.redirect(
    "https://www.tiktok.com/v2/auth/authorize/?" + params.toString()
  );
});

app.get("/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(
      "TikTok no autorizó la solicitud: " +
      String(error_description || error)
    );
  }

  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send(
      "Respuesta OAuth inválida o estado vencido. Intenta iniciar sesión otra vez."
    );
  }

  delete req.session.oauthState;

  try {
    const tokenResponse = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_key: CLIENT_KEY,
          client_secret: CLIENT_SECRET,
          code: String(code),
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.error || !tokenData.access_token) {
      console.error("Falló el intercambio de tokens:", {
        status: tokenResponse.status,
        error: tokenData.error,
        description: tokenData.error_description
      });

      return res.status(400).send(
        "TikTok no permitió completar la autorización. Revisa los registros del servidor."
      );
    }

    // El token se mantiene solo en la sesión actual del usuario.
    req.session.tiktokAccessToken = tokenData.access_token;

    return res.redirect("/tiktok/profile");
  } catch (err) {
    console.error("Error de conexión con TikTok:", err.message);
    return res.status(500).send(
      "No fue posible completar la conexión con TikTok."
    );
  }
});

app.get("/tiktok/profile", async (req, res) => {
  const accessToken = req.session.tiktokAccessToken;

  if (!accessToken) {
    return res.status(401).send(
      'Primero conecta TikTok desde <a href="/auth/tiktok">este enlace</a>.'
    );
  }

  try {
    const profileResponse = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const profileData = await profileResponse.json();

    if (!profileResponse.ok || profileData.error?.code !== "ok") {
      console.error("Falló la consulta del perfil:", {
        status: profileResponse.status,
        error: profileData.error?.code
      });

      return res.status(400).send(
        "TikTok autorizó la conexión, pero no fue posible consultar el perfil. Comprueba los permisos de Sandbox."
      );
    }

    return res.json({
      conectado: true,
      mensaje: "Perfil consultado correctamente.",
      usuario: profileData.data.user
    });
  } catch (err) {
    console.error("Error al consultar el perfil:", err.message);
    return res.status(500).send(
      "No fue posible consultar el perfil de TikTok."
    );
  }
});

const port = process.env.PORT || 8080;

app.listen(port, "0.0.0.0", () => {
  console.log(`WestcolClipsAI escuchando en el puerto ${port}`);
});
