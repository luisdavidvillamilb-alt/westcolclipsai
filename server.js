
const express = require("express");
const session = require("express-session");

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
      maxAge: 10 * 60 * 1000
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

  const crypto = require("crypto");
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_key: CLIENT_KEY,
    response_type: "code",
    scope: "user.info.basic,video.upload",
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
    const response = await fetch(
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

    const data = await response.json();

    if (!response.ok || data.error || !data.access_token) {
      console.error("Error de token TikTok:", {
        status: response.status,
        error: data.error,
        description: data.error_description
      });

      return res.status(400).send(
        "TikTok recibió la autorización, pero no fue posible completar el intercambio de tokens. Revisa el entorno y las credenciales en Render."
      );
    }

    // No mostrar ni guardar los tokens en la respuesta del navegador.
    req.session.tiktokConnected = true;

    return res.status(200).send(
      "Autorización OAuth completada correctamente. WestcolClipsAI recibió los tokens de TikTok."
    );
  } catch (err) {
    console.error("Error de conexión con TikTok:", err.message);
    return res.status(500).send(
      "No se pudo conectar con TikTok para completar la autorización."
    );
  }
});

const port = process.env.PORT || 8080;

app.listen(port, "0.0.0.0", () => {
  console.log(`WestcolClipsAI escuchando en el puerto ${port}`);
});
